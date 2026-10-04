import ballerina/io;

// Path to the seed file. Relative to the admin_service folder.
final string SEED_FILE = "./seed_data.json";

// Load the whole seed file as json.
public function loadSeed() returns json {
    string content = checkpanic io:fileReadString(SEED_FILE);
    json parsed = checkpanic content.fromJsonString();
    return parsed;
}

// Convenience: get the "orders" array as json[].
public function loadOrders() returns json[] {
    json seed = loadSeed();
    if seed is map<json> && seed.hasKey("orders") {
        json orders = seed["orders"];
        if orders is json[] {
            return orders;
        }
    }
    return [];
}

public function loadPayments() returns json[] {
    json seed = loadSeed();
    if seed is map<json> && seed.hasKey("payments") {
        json payments = seed["payments"];
        if payments is json[] {
            return payments;
        }
    }
    return [];
}

public function loadDeliveries() returns json[] {
    json seed = loadSeed();
    if seed is map<json> && seed.hasKey("deliveries") {
        json deliveries = seed["deliveries"];
        if deliveries is json[] {
            return deliveries;
        }
    }
    return [];
}
