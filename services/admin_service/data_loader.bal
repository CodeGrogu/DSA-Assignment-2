import ballerina/io;
import ballerina/log;
import ballerina/os;

configurable string seedDataPath = "";

// Resolves candidate paths for the seed data file.
isolated function getCandidatePaths(string? customPath = ()) returns string[] {
    if customPath is string && customPath.trim().length() > 0 {
        return [customPath.trim()];
    }

    string[] paths = [];
    if seedDataPath.trim().length() > 0 {
        paths.push(seedDataPath.trim());
    }
    string envPath = os:getEnv("SEED_DATA_PATH");
    if envPath.trim().length() > 0 {
        paths.push(envPath.trim());
    }
    string envFile = os:getEnv("SEED_FILE");
    if envFile.trim().length() > 0 {
        paths.push(envFile.trim());
    }
    paths.push("./seed_data.json");
    paths.push("services/admin_service/seed_data.json");
    paths.push("admin_service/seed_data.json");
    return paths;
}

// Load the whole seed file as json safely.
public isolated function loadSeed(string? customPath = ()) returns json {
    string[] candidatePaths = getCandidatePaths(customPath);
    string|error content = error("Seed data file not found in any candidate path");
    string loadedPath = "";

    foreach string path in candidatePaths {
        string|error readResult = io:fileReadString(path);
        if readResult is string {
            content = readResult;
            loadedPath = path;
            break;
        }
    }

    if content is error {
        log:printWarn("Could not load seed data: " + content.message());
        return {};
    }

    if content.trim().length() == 0 {
        log:printWarn("Seed data file at " + loadedPath + " is empty");
        return {};
    }

    json|error parsed = content.fromJsonString();
    if parsed is error {
        log:printWarn("Could not parse seed data JSON from " + loadedPath + ": " + parsed.message());
        return {};
    }

    if parsed is map<json> {
        return parsed;
    }

    log:printWarn("Seed data in " + loadedPath + " is not a JSON object");
    return {};
}

// Convenience: get the "orders" array as json[].
public isolated function loadOrders(string? customPath = ()) returns json[] {
    json seed = loadSeed(customPath);
    if seed is map<json> && seed.hasKey("orders") {
        json orders = seed["orders"];
        if orders is json[] {
            return orders;
        }
    }
    return [];
}

public isolated function loadPayments(string? customPath = ()) returns json[] {
    json seed = loadSeed(customPath);
    if seed is map<json> && seed.hasKey("payments") {
        json payments = seed["payments"];
        if payments is json[] {
            return payments;
        }
    }
    return [];
}

public isolated function loadDeliveries(string? customPath = ()) returns json[] {
    json seed = loadSeed(customPath);
    if seed is map<json> && seed.hasKey("deliveries") {
        json deliveries = seed["deliveries"];
        if deliveries is json[] {
            return deliveries;
        }
    }
    return [];
}
