import ballerina/http;
import ballerina/log;
import ballerina/time;
import ballerina/uuid;
import ballerinax/mongodb;

import peerpressure/metrics as metrics;

configurable int port = 9095;

@http:ServiceConfig {
    cors: {
        allowOrigins: ["*"],
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowHeaders: ["*"]
    }
}
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
                    isAvailable: item.isAvailable && item.stock > 0,
                    imageUrl: item.imageUrl
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

        map<json>|error itemJson = request.item.cloneWithType();
        if itemJson is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        mongodb:Update update = {
            "push": {"menu.$.items": itemJson}
        };
        mongodb:UpdateResult|error result = collection->updateOne(
            {"id": restaurantId, "menu.id": request.categoryId},
            update
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
        if payload.price <= 0.0d {
            return jsonResponse(400, {message: "Menu item price must be positive"});
        }
        Restaurant?|error restaurantResult = findRestaurant(restaurantId);
        if restaurantResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        if restaurantResult is () {
            return jsonResponse(404, {message: "Restaurant not found"});
        }
        Restaurant restaurant = restaurantResult;

        [int, int]? indices = findMenuItemIndices(restaurant, itemId);
        if indices is () {
            return jsonResponse(404, {message: "Menu item not found"});
        }
        var [catIdx, itemIdx] = indices;
        restaurant.menu[catIdx].items[itemIdx].price = payload.price;

        mongodb:Collection|error collectionResult = getRestaurantsCollection();
        if collectionResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        mongodb:Collection collection = collectionResult;

        string itemIdPath = string `menu.${catIdx}.items.${itemIdx}.id`;
        string pricePath = string `menu.${catIdx}.items.${itemIdx}.price`;
        mongodb:Update update = {
            "set": {[pricePath]: payload.price}
        };
        mongodb:UpdateResult|error updateResult = collection->updateOne({"id": restaurantId, [itemIdPath]: itemId}, update);
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

        [int, int]? indices = findMenuItemIndices(restaurant, itemId);
        if indices is () {
            return jsonResponse(404, {message: "Menu item not found"});
        }
        var [catIdx, itemIdx] = indices;
        restaurant.menu[catIdx].items[itemIdx].stock = payload.stock;
        boolean targetAvail = payload.stock > 0;
        restaurant.menu[catIdx].items[itemIdx].isAvailable = targetAvail;

        mongodb:Collection|error collectionResult = getRestaurantsCollection();
        if collectionResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        mongodb:Collection collection = collectionResult;

        string itemIdPath = string `menu.${catIdx}.items.${itemIdx}.id`;
        string stockPath = string `menu.${catIdx}.items.${itemIdx}.stock`;
        string availPath = string `menu.${catIdx}.items.${itemIdx}.isAvailable`;
        mongodb:Update update = {
            "set": {
                [stockPath]: payload.stock,
                [availPath]: targetAvail
            }
        };
        mongodb:UpdateResult|error updateResult = collection->updateOne({"id": restaurantId, [itemIdPath]: itemId}, update);
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

        [int, int]? indices = findMenuItemIndices(restaurant, itemId);
        if indices is () {
            return jsonResponse(404, {message: "Menu item not found"});
        }
        var [catIdx, itemIdx] = indices;
        restaurant.menu[catIdx].items[itemIdx].stock = restaurant.menu[catIdx].items[itemIdx].stock + payload.quantity;
        restaurant.menu[catIdx].items[itemIdx].isAvailable = restaurant.menu[catIdx].items[itemIdx].stock > 0;

        mongodb:Collection|error collectionResult = getRestaurantsCollection();
        if collectionResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        mongodb:Collection collection = collectionResult;

        string itemIdPath = string `menu.${catIdx}.items.${itemIdx}.id`;
        string stockPath = string `menu.${catIdx}.items.${itemIdx}.stock`;
        string availPath = string `menu.${catIdx}.items.${itemIdx}.isAvailable`;
        mongodb:Update update = {
            "inc": {[stockPath]: payload.quantity},
            "set": {[availPath]: true}
        };
        mongodb:UpdateResult|error updateResult = collection->updateOne({"id": restaurantId, [itemIdPath]: itemId}, update);
        if updateResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        return jsonResponse(200, restaurant);
    }

    isolated resource function put restaurants/[string restaurantId]/menu/items/[string itemId](
            @http:Payload UpdateMenuItemRequest itemPayload) returns http:Response {
        Restaurant?|error restaurantResult = findRestaurant(restaurantId);
        if restaurantResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        if restaurantResult is () {
            return jsonResponse(404, {message: "Restaurant not found"});
        }
        Restaurant restaurant = restaurantResult;

        [int, int]? indices = findMenuItemIndices(restaurant, itemId);
        if indices is () {
            return jsonResponse(404, {message: "Menu item not found"});
        }
        var [catIdx, itemIdx] = indices;
        MenuItem existingItem = restaurant.menu[catIdx].items[itemIdx];

        string resolvedId = itemPayload.id is string && (<string>itemPayload.id).trim().length() > 0 ? (<string>itemPayload.id).trim() : itemId;
        if resolvedId != itemId && !isMenuItemIdUniqueAcrossRestaurant(restaurant, resolvedId) {
            return jsonResponse(409, {message: "duplicate menu item ID '" + resolvedId + "' found across the restaurant menu"});
        }

        int resolvedStock = itemPayload.stock is int ? <int>itemPayload.stock : existingItem.stock;
        int resolvedLowStockThreshold = itemPayload.lowStockThreshold is int ? <int>itemPayload.lowStockThreshold : existingItem.lowStockThreshold;
        boolean requestedAvail = itemPayload.isAvailable is boolean ? <boolean>itemPayload.isAvailable : existingItem.isAvailable;
        boolean resolvedAvail = requestedAvail && resolvedStock > 0;

        MenuItem updatedItem = {
            id: resolvedId,
            name: itemPayload.name is string && (<string>itemPayload.name).trim().length() > 0 ? (<string>itemPayload.name).trim() : existingItem.name,
            description: itemPayload.description is string ? <string>itemPayload.description : existingItem.description,
            price: itemPayload.price is decimal ? <decimal>itemPayload.price : existingItem.price,
            taxRate: itemPayload.taxRate is decimal ? <decimal>itemPayload.taxRate : existingItem.taxRate,
            dietaryAttributes: itemPayload.dietaryAttributes is string[] ? <string[]>itemPayload.dietaryAttributes : existingItem.dietaryAttributes,
            stock: resolvedStock,
            lowStockThreshold: resolvedLowStockThreshold,
            isAvailable: resolvedAvail,
            imageUrl: itemPayload.imageUrl is string ? <string>itemPayload.imageUrl : existingItem.imageUrl
        };

        string? validationError = validateMenuItem(updatedItem);
        if validationError is string {
            return jsonResponse(400, {message: validationError});
        }

        restaurant.menu[catIdx].items[itemIdx] = updatedItem;

        mongodb:Collection|error collectionResult = getRestaurantsCollection();
        if collectionResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        mongodb:Collection collection = collectionResult;

        map<json>|error itemDoc = updatedItem.cloneWithType();
        if itemDoc is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }

        string itemIdPath = string `menu.${catIdx}.items.${itemIdx}.id`;
        string itemPath = string `menu.${catIdx}.items.${itemIdx}`;
        mongodb:Update update = {
            "set": {[itemPath]: itemDoc}
        };
        mongodb:UpdateResult|error updateResult = collection->updateOne({"id": restaurantId, [itemIdPath]: itemId}, update);
        if updateResult is error {
            return jsonResponse(500, {message: "Failed to update menu item"});
        }
        return jsonResponse(200, updatedItem);
    }

    isolated resource function get restaurants/[string restaurantId]/'open\-status(
            string? dayOfWeek = (), string? timeOfDay = (), string? date = ()) returns http:Response {
        Restaurant?|error restaurantResult = findRestaurant(restaurantId);
        if restaurantResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        if restaurantResult is () {
            return jsonResponse(404, {message: "Restaurant not found"});
        }
        Restaurant restaurant = restaurantResult;

        string resolvedDay = dayOfWeek is string ? dayOfWeek : getCurrentDayOfWeek();
        string resolvedTime = timeOfDay is string ? timeOfDay : getCurrentTimeOfDay();
        boolean isOpen = isRestaurantOpenForOrdering(restaurant, dayOfWeek, timeOfDay, date);

        if isOpen {
            return jsonResponse(200, {
                                        restaurantId: restaurantId,
                                        status: "OPEN",
                                        open: true,
                                        dayOfWeek: resolvedDay,
                                        timeOfDay: resolvedTime
                                    });
        }

        return jsonResponse(409, {
                                    restaurantId: restaurantId,
                                    status: "CLOSED",
                                    open: false,
                                    message: "Restaurant is currently closed for ordering",
                                    dayOfWeek: resolvedDay,
                                    timeOfDay: resolvedTime,
                                    operatingHours: restaurant.operatingHours
                                });
    }

    isolated resource function post restaurants/[string restaurantId]/'validate\-order(
            @http:Payload ValidateOrderRequest payload) returns http:Response {
        Restaurant?|error restaurantResult = findRestaurant(restaurantId);
        if restaurantResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        if restaurantResult is () {
            return jsonResponse(404, {message: "Restaurant not found"});
        }
        Restaurant restaurant = restaurantResult;

        OrderValidationResult result = validateRestaurantOrder(restaurant, payload);
        if !result.isValid {
            map<json> errMap = {
                status: result.status,
                message: result.message,
                restaurantId: restaurantId
            };
            if result.failedItemId is string {
                errMap["itemId"] = result.failedItemId;
            }
            if result.availableStock is int {
                errMap["availableStock"] = result.availableStock;
            }
            if result.requestedQuantity is int {
                errMap["requestedQuantity"] = result.requestedQuantity;
            }
            return jsonResponse(result.statusCode, errMap);
        }

        return jsonResponse(200, {
                                    status: "VALID",
                                    restaurantId: restaurantId,
                                    message: result.message
                                });
    }

    isolated resource function post restaurants/[string restaurantId]/orders(
            @http:Payload ValidateOrderRequest payload) returns http:Response {
        Restaurant?|error restaurantResult = findRestaurant(restaurantId);
        if restaurantResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        if restaurantResult is () {
            return jsonResponse(404, {message: "Restaurant not found"});
        }
        Restaurant restaurant = restaurantResult;

        if !isRestaurantOpenForOrdering(restaurant, payload.dayOfWeek, payload.timeOfDay, payload.date) {
            return jsonResponse(400, {
                                        status: "CLOSED",
                                        restaurantId: restaurantId,
                                        message: "Restaurant is currently closed for ordering"
                                    });
        }

        if payload.items.length() == 0 {
            return jsonResponse(400, {message: "Order must contain at least one item"});
        }

        [string, int][] decrementedItems = [];
        foreach ValidateOrderItem item in payload.items {
            if item.quantity <= 0 {
                rollbackReservedStock(restaurantId, decrementedItems);
                return jsonResponse(400, {message: "Item quantity must be greater than zero"});
            }
            boolean|error decremented = decrementMenuItemStock(restaurantId, item.itemId, item.quantity);
            if decremented is error {
                rollbackReservedStock(restaurantId, decrementedItems);
                return jsonResponse(500, {message: "Database connection failed"});
            }
            if !decremented {
                rollbackReservedStock(restaurantId, decrementedItems);
                return jsonResponse(409, {
                                            status: "INSUFFICIENT_STOCK",
                                            message: "Insufficient stock for item " + item.itemId,
                                            itemId: item.itemId
                                        });
            }
            decrementedItems.push([item.itemId, item.quantity]);
        }

        return jsonResponse(201, {
                                    status: "CONFIRMED",
                                    restaurantId: restaurantId,
                                    message: "Order placed successfully"
                                });
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

        [string, int][] reservedSoFar = [];
        foreach OrderItemReservation item in request.items {
            [int, int]? indices = findMenuItemIndices(restaurant, item.itemId);
            if indices is () {
                rollbackReservedStock(restaurantId, reservedSoFar);
                return jsonResponse(409, {"error": "ITEM_NOT_FOUND", itemId: item.itemId, message: string `Item ${item.itemId} not found`});
            }
            var [categoryIndex, itemIndex] = indices;

            string stockPath = string `menu.${categoryIndex}.items.${itemIndex}.stock`;

            // Atomic conditional filter: restaurant exists, menu contains item, and stock >= quantity
            map<json> filter = {
                "id": restaurantId,
                [stockPath]: {"$gte": item.quantity}
            };
            mongodb:Update update = {
                "inc": {[stockPath]: -item.quantity}
            };

            mongodb:UpdateResult|error updateRes = collection->updateOne(filter, update);

            if updateRes is error || updateRes.modifiedCount == 0 {
                rollbackReservedStock(restaurantId, reservedSoFar);
                return jsonResponse(409, {"error": "INSUFFICIENT_STOCK", itemId: item.itemId, message: string `Item ${item.itemId} has insufficient stock or is unavailable`});
            }
            reservedSoFar.push([item.itemId, item.quantity]);
        }

        return jsonResponse(200, {status: "RESERVED", restaurantId: restaurantId, message: "Stock successfully reserved and operating hours validated"});
    }

    isolated resource function post restaurants/[string restaurantId]/orders/[string orderId]/prepare() returns http:Response {
        Restaurant?|error restaurantResult = findRestaurant(restaurantId);
        if restaurantResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        if restaurantResult is () {
            return jsonResponse(404, {message: "Restaurant not found"});
        }
        return jsonResponse(200, {
            orderId: orderId,
            restaurantId: restaurantId,
            status: "PREPARING",
            preparingStartedAt: time:utcToString(time:utcNow())
        });
    }

    isolated resource function post restaurants/[string restaurantId]/orders/[string orderId]/ready() returns http:Response {
        Restaurant?|error restaurantResult = findRestaurant(restaurantId);
        if restaurantResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        if restaurantResult is () {
            return jsonResponse(404, {message: "Restaurant not found"});
        }
        Restaurant restaurant = restaurantResult;
        return jsonResponse(200, {
            orderId: orderId,
            restaurantId: restaurantId,
            status: "READY",
            pickupAddress: restaurant.address,
            pickupReadyAt: time:utcToString(time:utcNow())
        });
    }

    isolated resource function put restaurants/[string restaurantId](
            @http:Payload Restaurant updated) returns http:Response {
        Restaurant?|error restaurantResult = findRestaurant(restaurantId);
        if restaurantResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        if restaurantResult is () {
            return jsonResponse(404, {message: "Restaurant not found"});
        }

        mongodb:Collection|error collectionResult = getRestaurantsCollection();
        if collectionResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        mongodb:Collection collection = collectionResult;

        map<json>|error updatedDoc = updated.cloneWithType();
        if updatedDoc is error {
            return jsonResponse(500, {message: "Failed to serialize restaurant data"});
        }

        map<json> updatedFields = {};
        foreach var [k, v] in updatedDoc.entries() {
            if k != "id" && k != "_id" && k != "balance" && k != "totalEarnings" {
                if k == "menu" {
                    if updated.menu.length() > 0 {
                        string? validationErr = validateRestaurant(updated);
                        if validationErr is string {
                            return jsonResponse(400, {message: validationErr});
                        }
                        updatedFields[k] = v;
                    }
                } else {
                    updatedFields[k] = v;
                }
            }
        }

        mongodb:Update update = {
            "set": updatedFields
        };

        mongodb:UpdateResult|error updateResult = collection->updateOne({"id": restaurantId}, update);
        if updateResult is error {
            return jsonResponse(500, {message: "Database update failed: " + updateResult.message()});
        }

        Restaurant?|error reloaded = findRestaurant(restaurantId);
        if reloaded is Restaurant {
            return jsonResponse(200, reloaded);
        }
        return jsonResponse(200, updated);
    }

    isolated resource function delete restaurants/[string restaurantId]/menu/items/[string itemId]() returns http:Response {
        Restaurant?|error restaurantResult = findRestaurant(restaurantId);
        if restaurantResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        if restaurantResult is () {
            return jsonResponse(404, {message: "Restaurant not found"});
        }
        Restaurant restaurant = restaurantResult;

        [int, int]? indices = findMenuItemIndices(restaurant, itemId);
        if indices is () {
            return jsonResponse(404, {message: "Menu item not found"});
        }
        var [catIdx, _] = indices;

        mongodb:Collection|error collectionResult = getRestaurantsCollection();
        if collectionResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        mongodb:Collection collection = collectionResult;

        string itemsPath = string `menu.${catIdx}.items`;
        mongodb:Update update = {
            "pull": {[itemsPath]: {"id": itemId}}
        };
        mongodb:UpdateResult|error updateResult = collection->updateOne({"id": restaurantId}, update);
        if updateResult is error {
            return jsonResponse(500, {message: "Database deletion failed: " + updateResult.message()});
        }

        return jsonResponse(200, {message: "Menu item removed successfully", itemId: itemId});
    }

    isolated resource function post restaurants/[string restaurantId]/orders/[string orderId]/verify\-handover(
            @http:Payload VerifyHandoverRequest request) returns http:Response {
        Restaurant?|error restaurantResult = findRestaurant(restaurantId);
        if restaurantResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        if restaurantResult is () {
            return jsonResponse(404, {message: "Restaurant not found"});
        }

        string expectedPin = getOrderHandoverPin(orderId);
        if request.pin.trim() != expectedPin {
            return jsonResponse(400, {
                verified: false,
                orderId: orderId,
                status: "REJECTED",
                message: "Invalid handover PIN provided. Courier verification rejected.",
                timestamp: time:utcToString(time:utcNow())
            });
        }

        return jsonResponse(200, {
            verified: true,
            orderId: orderId,
            status: "OUT_FOR_DELIVERY",
            message: "Driver handover authenticated successfully. Order handed to courier.",
            timestamp: time:utcToString(time:utcNow())
        });
    }

    isolated resource function get restaurants/[string restaurantId]/earnings() returns http:Response {
        Restaurant?|error restaurantResult = findRestaurant(restaurantId);
        if restaurantResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        if restaurantResult is () {
            return jsonResponse(404, {message: "Restaurant not found"});
        }
        Restaurant restaurant = restaurantResult;

        return jsonResponse(200, {
            restaurantId: restaurantId,
            restaurantName: restaurant.name,
            balance: restaurant.balance,
            totalEarnings: restaurant.totalEarnings,
            currency: "NAD",
            updatedAt: time:utcToString(time:utcNow())
        });
    }

    isolated resource function post restaurants/[string restaurantId]/earnings/credit(
            @http:Payload CreditEarningsRequest request) returns http:Response {
        if request.amount <= 0.0d {
            return jsonResponse(400, {message: "Credit amount must be greater than zero"});
        }

        Restaurant?|error restaurantResult = findRestaurant(restaurantId);
        if restaurantResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        if restaurantResult is () {
            return jsonResponse(404, {message: "Restaurant not found"});
        }

        mongodb:Collection|error collectionResult = getRestaurantsCollection();
        if collectionResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        mongodb:Collection collection = collectionResult;

        mongodb:Update update = {
            "inc": {
                "balance": request.amount,
                "totalEarnings": request.amount
            }
        };
        mongodb:UpdateResult|error updateResult = collection->updateOne({"id": restaurantId}, update);
        if updateResult is error {
            return jsonResponse(500, {message: "Database credit failed: " + updateResult.message()});
        }

        Restaurant?|error reloaded = findRestaurant(restaurantId);
        decimal newBalance = reloaded is Restaurant ? reloaded.balance : 0.0d;

        return jsonResponse(200, {
            success: true,
            restaurantId: restaurantId,
            creditedAmount: request.amount,
            newBalance: newBalance,
            orderId: request.orderId,
            timestamp: time:utcToString(time:utcNow())
        });
    }

    isolated resource function post restaurants/[string restaurantId]/payout(
            @http:Payload PayoutRequest request) returns http:Response {
        if request.amount <= 0.0d {
            return jsonResponse(400, {message: "Payout withdrawal amount must be greater than zero"});
        }

        Restaurant?|error restaurantResult = findRestaurant(restaurantId);
        if restaurantResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        if restaurantResult is () {
            return jsonResponse(404, {message: "Restaurant not found"});
        }
        Restaurant restaurant = restaurantResult;

        if restaurant.balance < request.amount {
            return jsonResponse(400, {
                message: string `Insufficient balance for payout. Available: N$ ${restaurant.balance}, Requested: N$ ${request.amount}`
            });
        }

        mongodb:Collection|error collectionResult = getRestaurantsCollection();
        if collectionResult is error {
            return jsonResponse(500, {message: "Database connection failed"});
        }
        mongodb:Collection collection = collectionResult;

        mongodb:Update update = {
            "inc": {
                "balance": -request.amount
            }
        };
        mongodb:UpdateResult|error updateResult = collection->updateOne({"id": restaurantId}, update);
        if updateResult is error {
            return jsonResponse(500, {message: "Database withdrawal failed: " + updateResult.message()});
        }

        Restaurant?|error reloaded = findRestaurant(restaurantId);
        decimal remainingBalance = reloaded is Restaurant ? reloaded.balance : 0.0d;

        return jsonResponse(200, {
            success: true,
            restaurantId: restaurantId,
            withdrawnAmount: request.amount,
            remainingBalance: remainingBalance,
            bankAccount: request.bankAccount,
            bankName: request.bankName,
            status: "PAID_OUT",
            referenceId: "PAY-" + uuid:createType1AsString().substring(0, 8).toUpperAscii(),
            timestamp: time:utcToString(time:utcNow())
        });
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

isolated function isRestaurantOpenForOrdering(
        Restaurant restaurant, string? currentDayOfWeek = (), string? currentTime = (), string? currentDate = ()) returns boolean {
    string resolvedDate = currentDate is string ? currentDate : getCurrentDateString();
    foreach HolidayException holiday in restaurant.holidayExceptions {
        if holiday.date == resolvedDate {
            if holiday.isClosed {
                return false;
            }
            if holiday.openTime is string && holiday.closeTime is string {
                string opTime = <string>holiday.openTime;
                string clTime = <string>holiday.closeTime;
                if opTime.trim().length() > 0 && clTime.trim().length() > 0 {
                    string resolvedHolidayTime = currentTime is string ? currentTime : getCurrentTimeOfDay();
                    int curMins = parseTimeStringToMinutes(resolvedHolidayTime);
                    int opMins = parseTimeStringToMinutes(opTime);
                    int clMins = parseTimeStringToMinutes(clTime);
                    if curMins < 0 || opMins < 0 || clMins < 0 {
                        return false;
                    }
                    if clMins < opMins {
                        return curMins >= opMins || curMins <= clMins;
                    }
                    return curMins >= opMins && curMins <= clMins;
                }
            }
        }
    }

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
        if currentMinutes < 0 || openMinutes < 0 || closeMinutes < 0 {
            return false;
        }
        if closeMinutes < openMinutes {
            return currentMinutes >= openMinutes || currentMinutes <= closeMinutes;
        }
        return currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
    }
    return false;
}

isolated function validateRestaurantOpenForOrdering(
        Restaurant restaurant, string? currentDayOfWeek = (), string? currentTime = (), string? currentDate = ()) returns string? {
    if !isRestaurantOpenForOrdering(restaurant, currentDayOfWeek, currentTime, currentDate) {
        return "Restaurant is currently closed for ordering";
    }
    return ();
}

isolated function validateRestaurantOrder(Restaurant restaurant, ValidateOrderRequest request) returns OrderValidationResult {
    boolean isOpen = isRestaurantOpenForOrdering(restaurant, request.dayOfWeek, request.timeOfDay, request.date);
    if !isOpen {
        return {
            isValid: false,
            statusCode: 409,
            status: "CLOSED",
            message: "Restaurant is currently closed for ordering"
        };
    }

    if request.items.length() == 0 {
        return {
            isValid: false,
            statusCode: 400,
            status: "INVALID_REQUEST",
            message: "Order must contain at least one item"
        };
    }

    foreach ValidateOrderItem item in request.items {
        if item.quantity <= 0 {
            return {
                isValid: false,
                statusCode: 400,
                status: "INVALID_QUANTITY",
                message: "Item quantity must be greater than zero",
                failedItemId: item.itemId,
                requestedQuantity: item.quantity
            };
        }

        [int, int]? indices = findMenuItemIndices(restaurant, item.itemId);
        if indices is () {
            return {
                isValid: false,
                statusCode: 404,
                status: "ITEM_NOT_FOUND",
                message: "Menu item '" + item.itemId + "' not found in restaurant menu",
                failedItemId: item.itemId
            };
        }
        var [catIdx, itemIdx] = indices;
        MenuItem matchedItem = restaurant.menu[catIdx].items[itemIdx];

        if !matchedItem.isAvailable || matchedItem.stock < item.quantity {
            return {
                isValid: false,
                statusCode: 409,
                status: "INSUFFICIENT_STOCK",
                message: "Insufficient stock for menu item '" + item.itemId + "'",
                failedItemId: item.itemId,
                availableStock: matchedItem.stock,
                requestedQuantity: item.quantity
            };
        }
    }

    return {
        isValid: true,
        statusCode: 200,
        status: "VALID",
        message: "Order is valid for processing"
    };
}

isolated function getCurrentCatCivil() returns time:Civil {
    return time:utcToCivil(time:utcAddSeconds(time:utcNow(), 7200d));
}

isolated function getCurrentDateString() returns string {
    time:Civil civil = getCurrentCatCivil();
    return string `${civil.year.toString().padStart(4, "0")}-${civil.month.toString().padStart(2, "0")}-${civil.day.toString().padStart(2, "0")}`;
}

isolated function getCurrentDayOfWeek() returns string {
    return getDayOfWeekName(getCurrentCatCivil());
}

isolated function getCurrentTimeOfDay() returns string {
    time:Civil civil = getCurrentCatCivil();
    return string `${civil.hour.toString().padStart(2, "0")}:${civil.minute.toString().padStart(2, "0")}`;
}

isolated function parseTimeStringToMinutes(string timeText) returns int {
    string trimmed = timeText.trim();
    string[] parts = re `:`.split(trimmed);
    if parts.length() != 2 {
        return -1;
    }
    int|error hours = int:fromString(parts[0].trim());
    int|error minutes = int:fromString(parts[1].trim());
    if hours is error || minutes is error {
        return -1;
    }
    if hours < 0 || hours > 23 || minutes < 0 || minutes > 59 {
        return -1;
    }
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
    if item.lowStockThreshold < 0 {
        return "Menu item low stock threshold cannot be negative";
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

isolated function getOrderHandoverPin(string orderId) returns string {
    int hash = 0;
    byte[] bytes = orderId.toBytes();
    foreach byte b in bytes {
        hash = (hash * 31 + <int>b) % 10000;
    }
    if hash < 0 {
        hash = -hash;
    }
    string pin = hash.toString();
    while pin.length() < 4 {
        pin = "0" + pin;
    }
    return pin;
}
