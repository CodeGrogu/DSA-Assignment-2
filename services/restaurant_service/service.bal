import ballerina/http;
import ballerina/log;
import ballerina/uuid;
import ballerinax/mongodb;

import peerpressure/events as _;

configurable int port = 9095;

isolated service / on new http:Listener(port) {
    isolated resource function get health() returns json {
        return {
            status: "UP",
            "service": "restaurant_service",
            port: port,
            version: "0.1.0",
            contracts: "peerpressure/events:0.1.0"
        };
    }

    isolated resource function get restaurants(string? category = (), boolean? activeOnly = ())
            returns http:Response {
        mongodb:Collection collection;
        var collectionResult = getRestaurantsCollection();
        if collectionResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        collection = collectionResult;

        var findResult = collection->find({}, projection = {"_id": 0}, targetType = Restaurant);
        if findResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        stream<Restaurant, error?> restaurantStream = findResult;

        Restaurant[] restaurants = [];
        while true {
            var nextRestaurant = restaurantStream.next();
            if nextRestaurant is () {
                break;
            }
            if nextRestaurant is error {
                return jsonResponse(500, {message: "Failed to read restaurants"});
            }
            Restaurant restaurant = nextRestaurant.value;
            if category is string {
                boolean categoryFound = false;
                foreach MenuCategory menuCategory in restaurant.menu {
                    if menuCategory.id == category {
                        categoryFound = true;
                        break;
                    }
                }
                if !categoryFound {
                    continue;
                }
            }
            if activeOnly is boolean && activeOnly {
                boolean hasStock = false;
                foreach MenuCategory menuCategory in restaurant.menu {
                    foreach MenuItem item in menuCategory.items {
                        if item.stock > 0 {
                            hasStock = true;
                            break;
                        }
                    }
                    if hasStock {
                        break;
                    }
                }
                if !hasStock {
                    continue;
                }
            }
            restaurants.push(restaurant);
        }

        return jsonResponse(200, restaurants);
    }

    isolated resource function post restaurants(@http:Payload Restaurant restaurant) returns http:Response {
        if isPlaceholderId(restaurant.id) {
            restaurant.id = uuid:createType1AsString();
        }

        string? validationError = validateRestaurant(restaurant);
        if validationError is string {
            return jsonResponse(400, {message: validationError});
        }

        mongodb:Collection collection;
        var collectionResult = getRestaurantsCollection();
        if collectionResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        collection = collectionResult;

        Restaurant?|error existing = collection->findOne(
            {"id": restaurant.id}, projection = {"_id": 0}, targetType = Restaurant);
        if existing is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        if existing is Restaurant {
            return jsonResponse(409, {message: string `Restaurant ID already exists: ${restaurant.id}`});
        }

        var insertResult = collection->insertOne(restaurant);
        if insertResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        return jsonResponse(201, restaurant);
    }

    isolated resource function get restaurants/[string restaurantId]() returns http:Response {
        Restaurant?|error restaurant = findRestaurant(restaurantId);
        if restaurant is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        if restaurant is () {
            return jsonResponse(404, {message: "Restaurant not found"});
        }
        return jsonResponse(200, restaurant);
    }

    isolated resource function get restaurants/[string restaurantId]/menu(string? categoryId = ())
            returns http:Response {
        Restaurant?|error restaurantResult = findRestaurant(restaurantId);
        if restaurantResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        if restaurantResult is () {
            return jsonResponse(404, {message: "Restaurant not found"});
        }
        Restaurant restaurant = restaurantResult;

        if categoryId is string {
            boolean categoryFound = false;
            foreach MenuCategory category in restaurant.menu {
                if category.id == categoryId {
                    categoryFound = true;
                    break;
                }
            }
            if !categoryFound {
                return jsonResponse(400, {message: "Menu category does not exist"});
            }
        }

        MenuCategory[] categories = [];
        foreach MenuCategory category in restaurant.menu {
            if categoryId is string && category.id != categoryId {
                continue;
            }

            MenuItem[] items = [];
            foreach MenuItem item in category.items {
                items.push({
                    id: item.id,
                    name: item.name,
                    description: item.description,
                    price: item.price,
                    taxRate: item.taxRate,
                    dietaryAttributes: item.dietaryAttributes,
                    stock: item.stock,
                    isAvailable: item.isAvailable && item.stock > 0
                });
            }
            categories.push({id: category.id, name: category.name, items});
        }

        return jsonResponse(200, categories);
    }

    isolated resource function post restaurants/[string restaurantId]/menu/items(
            @http:Payload AddMenuItemRequest request) returns http:Response {
        string? validationError = validateMenuItem(request.item);
        if validationError is string {
            return jsonResponse(400, {message: validationError});
        }

        Restaurant?|error restaurantResult = findRestaurant(restaurantId);
        if restaurantResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        if restaurantResult is () {
            return jsonResponse(404, {message: "Restaurant not found"});
        }
        Restaurant restaurant = restaurantResult;

        boolean categoryFound = false;
        foreach MenuCategory category in restaurant.menu {
            if category.id == request.categoryId {
                categoryFound = true;
            }
        }
        if !categoryFound {
            return jsonResponse(400, {message: "Menu category does not exist"});
        }
        if !isMenuItemIdUniqueAcrossRestaurant(restaurant, request.item.id) {
            return jsonResponse(409, {message: "Menu item ID already exists in the restaurant"});
        }

        mongodb:Collection collection;
        var collectionResult = getRestaurantsCollection();
        if collectionResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        collection = collectionResult;

        mongodb:UpdateResult|error result = collection->updateOne(
            {"id": restaurantId, "menu.id": request.categoryId},
            {"$push": {"menu.$.items": request.item}}
        );
        if result is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        if result.matchedCount == 0 {
            return jsonResponse(404, {message: "Restaurant or menu category not found"});
        }

        MenuItem createdItem = request.item;
        createdItem.isAvailable = createdItem.isAvailable && createdItem.stock > 0;
        return jsonResponse(201, createdItem);
    }

    isolated resource function put restaurants/[string restaurantId]/menu/items/[string itemId]/price(
            @http:Payload record {|decimal price;|} payload) returns http:Response {
        if payload.price < 0.0d {
            return jsonResponse(400, {message: "Menu item price must be non-negative"});
        }
        Restaurant?|error restaurantResult = findRestaurant(restaurantId);
        if restaurantResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        if restaurantResult is () {
            return jsonResponse(404, {message: "Restaurant not found"});
        }
        Restaurant restaurant = restaurantResult;

        boolean itemFound = false;
        foreach MenuCategory category in restaurant.menu {
            foreach MenuItem item in category.items {
                if item.id == itemId {
                    item.price = payload.price;
                    itemFound = true;
                    break;
                }
            }
            if itemFound {
                break;
            }
        }
        if !itemFound {
            return jsonResponse(404, {message: "Menu item not found"});
        }

        mongodb:Collection collection;
        var collectionResult = getRestaurantsCollection();
        if collectionResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        collection = collectionResult;

        map<json>|error restaurantDoc = restaurant.cloneWithType();
        if restaurantDoc is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }

        mongodb:UpdateResult|error updateResult = collection->updateOne({"id": restaurantId}, {"$set": restaurantDoc});
        if updateResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        return jsonResponse(200, restaurant);
    }

    isolated resource function put restaurants/[string restaurantId]/menu/items/[string itemId]/stock(
            @http:Payload record {|int stock;|} payload) returns http:Response {
        if payload.stock < 0 {
            return jsonResponse(400, {message: "Menu item stock must be non-negative"});
        }
        Restaurant?|error restaurantResult = findRestaurant(restaurantId);
        if restaurantResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        if restaurantResult is () {
            return jsonResponse(404, {message: "Restaurant not found"});
        }
        Restaurant restaurant = restaurantResult;

        boolean itemFound = false;
        foreach MenuCategory category in restaurant.menu {
            foreach MenuItem item in category.items {
                if item.id == itemId {
                    item.stock = payload.stock;
                    item.isAvailable = item.isAvailable && item.stock > 0;
                    itemFound = true;
                    break;
                }
            }
            if itemFound {
                break;
            }
        }
        if !itemFound {
            return jsonResponse(404, {message: "Menu item not found"});
        }

        mongodb:Collection collection;
        var collectionResult = getRestaurantsCollection();
        if collectionResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        collection = collectionResult;

        map<json>|error restaurantDoc = restaurant.cloneWithType();
        if restaurantDoc is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }

        mongodb:UpdateResult|error updateResult = collection->updateOne({"id": restaurantId}, {"$set": restaurantDoc});
        if updateResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        return jsonResponse(200, restaurant);
    }

    isolated resource function put restaurants/[string restaurantId]/menu/items/[string itemId](
            @http:Payload MenuItem itemPayload) returns http:Response {
        string? validationError = validateMenuItem(itemPayload);
        if validationError is string {
            return jsonResponse(400, {message: validationError});
        }

        Restaurant?|error restaurantResult = findRestaurant(restaurantId);
        if restaurantResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        if restaurantResult is () {
            return jsonResponse(404, {message: "Restaurant not found"});
        }
        Restaurant restaurant = restaurantResult;

        boolean itemFound = false;
        foreach MenuCategory category in restaurant.menu {
            foreach MenuItem item in category.items {
                if item.id == itemId {
                    item.id = itemPayload.id;
                    item.name = itemPayload.name;
                    item.description = itemPayload.description;
                    item.price = itemPayload.price;
                    item.taxRate = itemPayload.taxRate;
                    item.dietaryAttributes = itemPayload.dietaryAttributes;
                    item.stock = itemPayload.stock;
                    item.isAvailable = itemPayload.isAvailable && itemPayload.stock > 0;
                    itemFound = true;
                    break;
                }
            }
            if itemFound {
                break;
            }
        }
        if !itemFound {
            return jsonResponse(404, {message: "Menu item not found"});
        }

        mongodb:Collection collection;
        var collectionResult = getRestaurantsCollection();
        if collectionResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        collection = collectionResult;

        map<json>|error restaurantDoc = restaurant.cloneWithType();
        if restaurantDoc is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }

        mongodb:UpdateResult|error updateResult = collection->updateOne({"id": restaurantId}, {"$set": restaurantDoc});
        if updateResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        return jsonResponse(200, restaurant);
    }

    isolated resource function post seed() returns http:Response {
        error? err = seedDatabase();
        if err is error {
            return jsonResponse(500, {message: "Failed to seed database", "error": err.message()});
        }
        return jsonResponse(200, {message: "Database seeded successfully"});
    }
}

isolated function isMenuItemIdUniqueAcrossRestaurant(Restaurant restaurant, string itemId, string? excludeCategoryId = ()) returns boolean {
    if excludeCategoryId is string {
        foreach MenuCategory category in restaurant.menu {
            if category.id == excludeCategoryId {
                foreach MenuItem item in category.items {
                    if item.id == itemId {
                        return true;
                    }
                }
                break;
            }
        }
    }

    foreach MenuCategory category in restaurant.menu {
        if excludeCategoryId is string && category.id == excludeCategoryId {
            continue;
        }
        foreach MenuItem item in category.items {
            if item.id == itemId {
                return false;
            }
        }
    }
    return true;
}

isolated function isPlaceholderId(string id) returns boolean {
    string trimmed = id.trim();
    if trimmed.length() == 0 {
        return true;
    }
    string lower = trimmed.toLowerAscii();
    return lower == "placeholder" || lower == "auto" || lower == "<auto>" ||
        lower == "{auto}" || lower == "default" || lower == "new" ||
        lower == "null" || lower == "undefined" || lower == "0" ||
        lower == "string" || lower == "temp" || lower == "none" ||
        lower == "generate" || lower == "generated" || lower == "<placeholder>" ||
        lower == "{placeholder}" || lower == "<generated>" || lower == "{id}";
}

isolated function validateRestaurant(Restaurant restaurant) returns string? {
    if restaurant.id.trim().length() == 0 {
        return "Restaurant ID is required";
    }
    if restaurant.name.trim().length() == 0 {
        return "Restaurant name is required";
    }
    if restaurant.address.trim().length() == 0 {
        return "Restaurant address is required";
    }
    if restaurant.contactNumber.trim().length() == 0 {
        return "Restaurant contact number is required";
    }

    if restaurant.location.'type != "Point" {
        return "Restaurant location must be a GeoJSON Point";
    }

    if restaurant.location.coordinates.length() != 2 {
        return "Restaurant location coordinates must include longitude and latitude";
    }
    decimal longitude = restaurant.location.coordinates[0];
    decimal latitude = restaurant.location.coordinates[1];
    if longitude < -180.0d || longitude > 180.0d {
        return "Restaurant location longitude must be between -180 and 180 degrees";
    }
    if latitude < -90.0d || latitude > 90.0d {
        return "Restaurant location latitude must be between -90 and 90 degrees";
    }

    foreach OperatingHours op in restaurant.operatingHours {
        if op.dayOfWeek.trim().length() == 0 {
            return "Operating hours day of week is required";
        }
        if !op.isClosed && (op.openTime.trim().length() == 0 || op.closeTime.trim().length() == 0) {
            return "Operating hours open and close times are required when not closed";
        }
    }

    foreach HolidayException hex in restaurant.holidayExceptions {
        if hex.date.trim().length() == 0 {
            return "Holiday exception date is required";
        }
    }

    map<boolean> seenCategories = {};
    map<boolean> seenItems = {};
    foreach MenuCategory category in restaurant.menu {
        if category.id.trim().length() == 0 || category.name.trim().length() == 0 {
            return "Menu category ID and name are required";
        }
        if seenCategories.hasKey(category.id) {
            return "duplicate menu category ID '" + category.id + "' found across the restaurant menu";
        }
        seenCategories[category.id] = true;

        foreach MenuItem item in category.items {
            if seenItems.hasKey(item.id) {
                return "duplicate menu item ID '" + item.id + "' found across the restaurant menu";
            }
            seenItems[item.id] = true;

            string? itemError = validateMenuItem(item);
            if itemError is string {
                return itemError;
            }
        }
    }
    return ();
}

isolated function validateMenuItem(MenuItem item) returns string? {
    if item.id.trim().length() == 0 || item.name.trim().length() == 0 {
        return "Menu item ID and name are required";
    }
    if item.price <= 0.0d {
        return "Menu item price must be positive";
    }
    if item.taxRate < 0.0d || item.taxRate > 1.0d {
        return "Menu item tax rate must be between 0 and 1";
    }
    if item.stock < 0 {
        return "Menu item stock cannot be negative";
    }
    if item.isAvailable && item.stock <= 0 {
        return "Item cannot be available when stock is 0 or less";
    }
    return ();
}

isolated function findRestaurant(string restaurantId) returns Restaurant?|error {
    do {
        mongodb:Collection collection = check getRestaurantsCollection();
        return check collection->findOne({"id": restaurantId}, projection = {"_id": 0}, targetType = Restaurant);
    } on fail error err {
        log:printError("Failed to find restaurant with ID " + restaurantId + ": " + err.message(), err);
        return err;
    }
}

isolated function jsonResponse(int statusCode, json payload) returns http:Response {
    http:Response response = new;
    response.statusCode = statusCode;
    response.setJsonPayload(payload);
    return response;
}
