import ballerina/http;
import ballerina/log;
import ballerina/time;
import ballerina/uuid;
import ballerinax/mongodb;

import peerpressure/metrics as metrics;

configurable int port = 9095;

service / on new http:Listener(port) {
    resource function get health() returns json {
        time:Utc startTime = time:utcNow();
        json response = {
            status: "UP",
            "service": "restaurant_service",
            port: port,
            version: "0.1.0",
            contracts: "peerpressure/events:0.1.0"
        };
        time:Utc endTime = time:utcNow();
        decimal durationMs = time:utcDiffSeconds(endTime, startTime) * 1000d;
        recordHttpRequest("GET", "/health", 200, durationMs, "restaurant_service");
        recordMessageLatency("kitchen.orders.ready", durationMs, "restaurant_service");
        setConsumerLagMetric("restaurant-kitchen-service", "orders.confirmed", 0);
        return response;
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

    isolated resource function post restaurants/[string restaurantId]/menu/items/[string itemId]/restock(
            @http:Payload record {|int quantity;|} payload) returns http:Response {
        if payload.quantity <= 0 {
            return jsonResponse(400, {message: "Restock quantity must be greater than zero"});
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
                    item.stock = item.stock + payload.quantity;
                    item.isAvailable = item.stock > 0;
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

    isolated resource function post restaurants/[string restaurantId]/'order/validate\-and\-reserve(
            @http:Payload ValidateAndReserveRequest request) returns http:Response {
        // 1. Fetch restaurant for hours validation
        Restaurant?|error restaurantResult = findRestaurant(restaurantId);
        if restaurantResult is error || restaurantResult is () {
            return jsonResponse(404, {message: "Restaurant not found"});
        }
        Restaurant restaurant = restaurantResult;

        // 2. Validate Operating Hours
        string? hoursError = validateOperatingHours(restaurant, request.orderTimestamp);
        if hoursError is string {
            return jsonResponse(409, {"error": "RESTAURANT_CLOSED", message: hoursError});
        }

        // 3. Atomic Conditional Decrement for each item
        mongodb:Collection collection;
        var collectionResult = getRestaurantsCollection();
        if collectionResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        collection = collectionResult;

        foreach OrderItemReservation item in request.items {
            int? categoryIndex = ();
            int? itemIndex = ();

            foreach int i in 0 ..< restaurant.menu.length() {
                foreach int j in 0 ..< restaurant.menu[i].items.length() {
                    if restaurant.menu[i].items[j].id == item.itemId {
                        categoryIndex = i;
                        itemIndex = j;
                        break;
                    }
                }
                if categoryIndex is int {
                    break;
                }
            }

            if categoryIndex is () || itemIndex is () {
                return jsonResponse(409, {"error": "ITEM_NOT_FOUND", itemId: item.itemId, message: string `Item ${item.itemId} not found`});
            }

            string stockPath = string `menu.${categoryIndex}.items.${itemIndex}.stock`;

            // Atomic conditional filter: restaurant exists, menu contains item, and stock >= quantity
            map<json> filter = {
                "id": restaurantId,
                [stockPath]: {"$gte": item.quantity}
            };
            mongodb:Update update = {
                "$inc": {[stockPath]: -item.quantity}
            };

            mongodb:UpdateResult|error updateRes = collection->updateOne(filter, update);

            if updateRes is error || updateRes.modifiedCount == 0 {
                // Failed atomic check: either item does not exist or insufficient stock
                return jsonResponse(409, {"error": "INSUFFICIENT_STOCK", itemId: item.itemId, message: string `Item ${item.itemId} has insufficient stock or is unavailable`});
            }
        }

        return jsonResponse(200, {status: "RESERVED", restaurantId: restaurantId, message: "Stock successfully reserved and operating hours validated"});
    }

    isolated resource function post seed() returns http:Response {
        error? err = seedDatabase();
        if err is error {
            return jsonResponse(500, {message: "Failed to seed database", "error": err.message()});
        }
        return jsonResponse(200, {message: "Database seeded successfully"});
    }

    resource function get metrics() returns http:Response {
        return metrics:getMetricsResponse();
    }
}

isolated function isMenuItemIdUniqueAcrossRestaurant(Restaurant restaurant, string itemId, string? excludeCategoryId = ()) returns boolean {
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

isolated function isRestaurantOpenForOrdering(Restaurant restaurant, string? currentDayOfWeek = (), string? currentTime = ()) returns boolean {
    string resolvedDay = currentDayOfWeek is string ? currentDayOfWeek : getCurrentDayOfWeek();
    string resolvedTime = currentTime is string ? currentTime : getCurrentTimeOfDay();

    foreach OperatingHours operatingHours in restaurant.operatingHours {
        if operatingHours.isClosed || operatingHours.dayOfWeek != resolvedDay {
            continue;
        }
        if operatingHours.openTime.trim().length() == 0 || operatingHours.closeTime.trim().length() == 0 {
            return false;
        }

        int currentMinutes = parseTimeStringToMinutes(resolvedTime);
        int openMinutes = parseTimeStringToMinutes(operatingHours.openTime);
        int closeMinutes = parseTimeStringToMinutes(operatingHours.closeTime);
        if closeMinutes < openMinutes {
            return currentMinutes >= openMinutes || currentMinutes <= closeMinutes;
        }
        return currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
    }
    return false;
}

isolated function validateRestaurantOpenForOrdering(Restaurant restaurant, string? currentDayOfWeek = (), string? currentTime = ()) returns string? {
    if !isRestaurantOpenForOrdering(restaurant, currentDayOfWeek, currentTime) {
        return "Restaurant is currently closed for ordering";
    }
    return ();
}

isolated function getCurrentDayOfWeek() returns string {
    time:Civil civil = time:utcToCivil(time:utcNow());
    string[] days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    int? dayOfWeek = civil.dayOfWeek;
    if dayOfWeek is () {
        return "Sunday";
    }
    int index = dayOfWeek - 1;
    if index < 0 || index >= days.length() {
        index = 0;
    }
    return days[index];
}

isolated function getCurrentTimeOfDay() returns string {
    time:Civil civil = time:utcToCivil(time:utcNow());
    return string `${civil.hour.toString().padStart(2, "0")}:${civil.minute.toString().padStart(2, "0")}`;
}

isolated function parseTimeStringToMinutes(string timeText) returns int {
    string[] parts = re `:`.split(timeText);
    if parts.length() < 2 {
        return 0;
    }
    int hours = checkpanic int:fromString(parts[0]);
    int minutes = checkpanic int:fromString(parts[1]);
    return (hours * 60) + minutes;
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

public isolated function validateOperatingHours(Restaurant restaurant, string? orderTimestamp) returns string? {
    time:Utc orderUtc = time:utcNow();
    if orderTimestamp is string {
        var parsed = time:utcFromString(orderTimestamp);
        if parsed is error {
            return "Invalid order timestamp format; RFC 3339 expected";
        }
        orderUtc = parsed;
    }
    // Convert to CAT (UTC+2)
    time:Utc catUtc = time:utcAddSeconds(orderUtc, 7200d);
    time:Civil civil = time:utcToCivil(catUtc); // CAT is UTC+02:00
    string currentDate = string `${civil.year}-${civil.month.toString().padStart(2, "0")}-${civil.day.toString().padStart(2, "0")}`;
    string currentTime = string `${civil.hour.toString().padStart(2, "0")}:${civil.minute.toString().padStart(2, "0")}`;

    // 1. Check Holiday Exceptions
    foreach HolidayException hex in restaurant.holidayExceptions {
        if hex.date == currentDate {
            if hex.isClosed {
                return string `Restaurant is closed on holiday exception date: ${currentDate}`;
            }
            if hex.openTime is string && hex.closeTime is string {
                if currentTime < <string>hex.openTime || currentTime > <string>hex.closeTime {
                    return string `Order placed outside holiday operating hours (${<string>hex.openTime} - ${<string>hex.closeTime})`;
                }
            }
        }
    }

    // 2. Determine Day of Week and Validate Weekly Schedule
    // Map civil date to day of week string: "Monday", "Tuesday", etc.
    string dayName = getDayOfWeekName(civil);
    foreach OperatingHours op in restaurant.operatingHours {
        if op.dayOfWeek.toLowerAscii() == dayName.toLowerAscii() {
            if op.isClosed {
                return string `Restaurant is closed on ${op.dayOfWeek}`;
            }
            if currentTime < op.openTime || currentTime > op.closeTime {
                return string `Order placed outside regular operating hours (${op.openTime} - ${op.closeTime} CAT)`;
            }
            return (); // Open and valid
        }
    }
    return "No operating hours configured for this day; restaurant closed";
}

isolated function getDayOfWeekName(time:Civil civil) returns string {
    string[] days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    int? dayOfWeek = civil.dayOfWeek;
    if dayOfWeek is () {
        return "Sunday";
    }
    int index = dayOfWeek - 1;
    if index < 0 || index >= days.length() {
        index = 0;
    }
    return days[index];
}
