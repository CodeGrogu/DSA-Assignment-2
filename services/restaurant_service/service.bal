import ballerina/http;
import ballerinax/mongodb;

import peerpressure/events as _;

configurable int port = 9095;

service / on new http:Listener(port) {
    resource function get health() returns json {
        return {
            status: "UP",
            "service": "restaurant_service",
            port: port,
            version: "0.1.0",
            contracts: "peerpressure/events:0.1.0"
        };
    }

    resource function post restaurants(@http:Payload Restaurant restaurant) returns http:Response|error {
        string? validationError = validateRestaurant(restaurant);
        if validationError is string {
            return check jsonResponse(400, {message: validationError});
        }

        mongodb:Collection collection = check getRestaurantsCollection();
        Restaurant? existing = check collection->findOne(
            {"id": restaurant.id}, projection = {"_id": 0}, targetType = Restaurant);
        if existing is Restaurant {
            return check jsonResponse(409, {message: "Restaurant ID already exists"});
        }

        check collection->insertOne(restaurant);
        return check jsonResponse(201, restaurant);
    }

    resource function get restaurants/[string restaurantId]() returns http:Response|error {
        Restaurant? restaurant = check findRestaurant(restaurantId);
        if restaurant is () {
            return check jsonResponse(404, {message: "Restaurant not found"});
        }
        return check jsonResponse(200, restaurant);
    }

    resource function get restaurants/[string restaurantId]/menu(string? categoryId = ())
            returns http:Response|error {
        Restaurant? restaurant = check findRestaurant(restaurantId);
        if restaurant is () {
            return check jsonResponse(404, {message: "Restaurant not found"});
        }

        if categoryId is string {
            boolean categoryFound = false;
            foreach MenuCategory category in restaurant.menu {
                if category.id == categoryId {
                    categoryFound = true;
                    break;
                }
            }
            if !categoryFound {
                return check jsonResponse(400, {message: "Menu category does not exist"});
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

        return check jsonResponse(200, categories);
    }

    resource function post restaurants/[string restaurantId]/menu/items(
            @http:Payload AddMenuItemRequest request) returns http:Response|error {
        string? validationError = validateMenuItem(request.item);
        if validationError is string {
            return check jsonResponse(400, {message: validationError});
        }

        Restaurant? restaurant = check findRestaurant(restaurantId);
        if restaurant is () {
            return check jsonResponse(404, {message: "Restaurant not found"});
        }

        boolean categoryFound = false;
        boolean itemExists = false;
        foreach MenuCategory category in restaurant.menu {
            if category.id == request.categoryId {
                categoryFound = true;
                foreach MenuItem existingItem in category.items {
                    if existingItem.id == request.item.id {
                        itemExists = true;
                        break;
                    }
                }
                break;
            }
        }
        if !categoryFound {
            return check jsonResponse(400, {message: "Menu category does not exist"});
        }
        if itemExists {
            return check jsonResponse(409, {message: "Menu item ID already exists in this category"});
        }

        mongodb:Collection collection = check getRestaurantsCollection();
        mongodb:UpdateResult result = check collection->updateOne(
            {"id": restaurantId, "menu.id": request.categoryId},
            {"$push": {"menu.$.items": request.item}}
        );
        if result.matchedCount == 0 {
            return check jsonResponse(404, {message: "Restaurant or menu category not found"});
        }

        MenuItem createdItem = request.item;
        createdItem.isAvailable = createdItem.isAvailable && createdItem.stock > 0;
        return check jsonResponse(201, createdItem);
    }

    resource function post seed() returns http:Response|error {
        error? err = seedDatabase();
        http:Response res = new;
        if err is error {
            res.statusCode = 500;
            res.setJsonPayload({message: "Failed to seed database", "error": err.message()});
        } else {
            res.statusCode = 200;
            res.setJsonPayload({message: "Database seeded successfully"});
        }
        return res;
    }
}

function validateRestaurant(Restaurant restaurant) returns string? {
    if restaurant.id.trim().length() == 0 || restaurant.name.trim().length() == 0 ||
            restaurant.address.trim().length() == 0 || restaurant.contactNumber.trim().length() == 0 {
        return "Restaurant ID, name, address, and contact number are required";
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

    map<boolean> seenItems = {};
    foreach MenuCategory category in restaurant.menu {
        if category.id.trim().length() == 0 || category.name.trim().length() == 0 {
            return "Menu category ID and name are required";
        }
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

function validateMenuItem(MenuItem item) returns string? {
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
        return "Menu item stock should be at least 1 to be marked available";
    }
    return ();
}

function findRestaurant(string restaurantId) returns Restaurant?|error {
    mongodb:Collection collection = check getRestaurantsCollection();
    return check collection->findOne({"id": restaurantId}, projection = {"_id": 0}, targetType = Restaurant);
}

function jsonResponse(int statusCode, json payload) returns http:Response|error {
    http:Response response = new;
    response.statusCode = statusCode;
    response.setJsonPayload(payload);
    return response;
}
