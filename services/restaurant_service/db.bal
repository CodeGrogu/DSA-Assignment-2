import ballerina/io;
import ballerina/log;
import ballerina/os;
import ballerinax/mongodb;

configurable string mongoUri = "";
configurable string mongoHost = "mongodb";
configurable int mongoPort = 27017;
configurable string mongoUser = "restaurant_user";
configurable string mongoPassword = "restaurant_password";
configurable string mongoAuthSource = "restaurant_db";
configurable string mongoReplicaSet = "rs0";
configurable string databaseName = "restaurant_db";
configurable int mongoServerSelectionTimeoutMs = 2000;

isolated function resolveRestaurantMongoUri() returns string {
    string envUri = os:getEnv("MONGO_URI");
    if envUri.trim() != "" {
        return envUri.trim();
    }
    if mongoUri.trim() != "" {
        return mongoUri.trim();
    }
    return string `mongodb://${mongoUser}:${mongoPassword}@${mongoHost}:${mongoPort}/${databaseName}?authSource=${mongoAuthSource}&replicaSet=${mongoReplicaSet}&serverSelectionTimeoutMS=${mongoServerSelectionTimeoutMs}`;
}

isolated mongodb:Client? sharedMongoClient = ();

isolated function getMongoClient() returns mongodb:Client|error {
    lock {
        if sharedMongoClient is mongodb:Client {
            return <mongodb:Client>sharedMongoClient;
        }
        do {
            mongodb:Client created = check new ({connection: resolveRestaurantMongoUri()});
            sharedMongoClient = created;
            return created;
        } on fail error err {
            log:printError("Failed to initialize MongoDB client: " + err.message(), err);
            return err;
        }
    }
}

isolated function getRestaurantsCollection() returns mongodb:Collection|error {
    do {
        mongodb:Client mongoClient = check getMongoClient();
        mongodb:Database restaurantDb = check mongoClient->getDatabase(databaseName);
        return check restaurantDb->getCollection("restaurants");
    } on fail error err {
        log:printError("Failed to access restaurants collection: " + err.message(), err);
        return err;
    }
}

isolated function findMenuItemIndices(Restaurant restaurant, string itemId) returns [int, int]? {
    foreach int catIdx in 0 ..< restaurant.menu.length() {
        foreach int itemIdx in 0 ..< restaurant.menu[catIdx].items.length() {
            if restaurant.menu[catIdx].items[itemIdx].id == itemId {
                return [catIdx, itemIdx];
            }
        }
    }
    return ();
}

isolated function rollbackReservedStock(string restaurantId, [string, int][] reservedItems) {
    foreach [string, int] [itemId, quantity] in reservedItems {
        boolean|error rollbackResult = incrementMenuItemStock(restaurantId, itemId, quantity);
        if rollbackResult is error {
            log:printError("Failed to rollback stock for item " + itemId, rollbackResult);
        }
    }
}

isolated function decrementMenuItemStock(string restaurantId, string itemId, int quantity) returns boolean|error {
    if quantity <= 0 {
        return false;
    }
    Restaurant? restaurant = check findRestaurant(restaurantId);
    if restaurant is () {
        return false;
    }

    [int, int]? indices = findMenuItemIndices(restaurant, itemId);
    if indices is () {
        return false;
    }
    var [catIdx, itemIdx] = indices;
    string itemIdPath = string `menu.${catIdx}.items.${itemIdx}.id`;
    string stockPath = string `menu.${catIdx}.items.${itemIdx}.stock`;
    mongodb:Collection collection = check getRestaurantsCollection();
    map<json> filter = {
        "id": restaurantId,
        [itemIdPath]: itemId,
        [stockPath]: {"$gte": quantity}
    };
    mongodb:Update update = {
        "inc": {[stockPath]: -quantity}
    };
    mongodb:UpdateResult result = check collection->updateOne(filter, update);
    return result.modifiedCount == 1;
}

isolated function incrementMenuItemStock(string restaurantId, string itemId, int quantity) returns boolean|error {
    if quantity <= 0 {
        return false;
    }
    Restaurant? restaurant = check findRestaurant(restaurantId);
    if restaurant is () {
        return false;
    }

    [int, int]? indices = findMenuItemIndices(restaurant, itemId);
    if indices is () {
        return false;
    }
    var [catIdx, itemIdx] = indices;
    string itemIdPath = string `menu.${catIdx}.items.${itemIdx}.id`;
    string stockPath = string `menu.${catIdx}.items.${itemIdx}.stock`;
    string availPath = string `menu.${catIdx}.items.${itemIdx}.isAvailable`;
    mongodb:Collection collection = check getRestaurantsCollection();
    map<json> filter = {
        "id": restaurantId,
        [itemIdPath]: itemId
    };
    mongodb:Update update = {
        "inc": {[stockPath]: quantity},
        "set": {[availPath]: true}
    };
    mongodb:UpdateResult result = check collection->updateOne(filter, update);
    return result.modifiedCount == 1;
}

isolated function getRestaurantSeedCandidatePaths() returns string[] {
    string envPath = os:getEnv("SEED_RESTAURANTS_PATH");
    string[] paths = [];
    if envPath.trim() != "" {
        paths.push(envPath.trim());
    }
    paths.push("data/seed_restaurants.json");
    paths.push("../data/seed_restaurants.json");
    paths.push("../../data/seed_restaurants.json");
    paths.push("seed_restaurants.json");
    paths.push("/app/data/seed_restaurants.json");
    return paths;
}

isolated function loadRestaurantSeedFromFile() returns Restaurant[]|error {
    string[] candidates = getRestaurantSeedCandidatePaths();
    string? foundContent = ();
    foreach string path in candidates {
        string|error content = io:fileReadString(path);
        if content is string {
            foundContent = content;
            break;
        }
    }

    if foundContent is () {
        return error("No seed_restaurants.json file found in candidate paths");
    }

    json parsed = check foundContent.fromJsonString();
    return check parsed.cloneWithType();
}

public isolated function seedDatabase() returns error? {
    do {
        mongodb:Collection restaurantsCollection = check getRestaurantsCollection();

        // Unconditionally override existing restaurants
        _ = check restaurantsCollection->deleteMany({});
        log:printInfo("Seeding restaurant database from external seed file...");

        Restaurant[] seedRestaurants = check loadRestaurantSeedFromFile();

        foreach Restaurant r in seedRestaurants {
            map<json> doc = check r.cloneWithType();
            _ = check restaurantsCollection->insertOne(doc);
        }

        log:printInfo("Database seeded successfully from external seed file.");
    } on fail error err {
        log:printError("Failed to seed database: " + err.message(), err);
        return err;
    }
}
