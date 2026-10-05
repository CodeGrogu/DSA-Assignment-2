import ballerina/http;
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

// Fetches live JSON array from a peer microservice when configured via environment variable.
isolated function fetchLiveArray(string envVarName, string resourcePath) returns json[] {
    string baseUrl = os:getEnv(envVarName);
    if baseUrl.trim() == "" {
        return [];
    }
    http:Client|error clientEp = new (baseUrl.trim(), {timeout: 1.5});
    if clientEp is error {
        return [];
    }
    json|error resp = clientEp->get(resourcePath);
    if resp is json[] {
        return resp;
    }
    return [];
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

// Convenience: get the "orders" array as json[], merging live order_service records if ORDER_SERVICE_URL is set.
public isolated function loadOrders(string? customPath = ()) returns json[] {
    json seed = loadSeed(customPath);
    json[] baseOrders = [];
    if seed is map<json> && seed.hasKey("orders") {
        json orders = seed["orders"];
        if orders is json[] {
            baseOrders = orders;
        }
    }
    if customPath is () && baseOrders.length() > 0 {
        json[] liveOrders = fetchLiveArray("ORDER_SERVICE_URL", "/orders");
        foreach json item in liveOrders {
            baseOrders.push(item);
        }
    }
    return baseOrders;
}

public isolated function loadPayments(string? customPath = ()) returns json[] {
    json seed = loadSeed(customPath);
    json[] basePayments = [];
    if seed is map<json> && seed.hasKey("payments") {
        json payments = seed["payments"];
        if payments is json[] {
            basePayments = payments;
        }
    }
    if customPath is () && basePayments.length() > 0 {
        json[] livePayments = fetchLiveArray("PAYMENT_SERVICE_URL", "/payments");
        foreach json item in livePayments {
            basePayments.push(item);
        }
    }
    return basePayments;
}

public isolated function loadDeliveries(string? customPath = ()) returns json[] {
    json seed = loadSeed(customPath);
    json[] baseDeliveries = [];
    if seed is map<json> && seed.hasKey("deliveries") {
        json deliveries = seed["deliveries"];
        if deliveries is json[] {
            baseDeliveries = deliveries;
        }
    }
    if customPath is () && baseDeliveries.length() > 0 {
        json[] liveDeliveries = fetchLiveArray("DELIVERY_SERVICE_URL", "/deliveries");
        foreach json item in liveDeliveries {
            baseDeliveries.push(item);
        }
    }
    return baseDeliveries;
}
