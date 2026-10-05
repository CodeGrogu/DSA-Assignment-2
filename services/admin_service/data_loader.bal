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

// Deduplicates a JSON object array by primary key field, preferring later (live) records.
isolated function mergeAndDeduplicate(json[] seedItems, json[] liveItems, string idKey) returns json[] {
    map<json> byId = {};
    string[] orderedKeys = [];
    json[] unkeyed = [];

    foreach json item in seedItems {
        if item is map<json> && item.hasKey(idKey) && item[idKey] is string {
            string k = <string>item[idKey];
            if !byId.hasKey(k) {
                orderedKeys.push(k);
            }
            byId[k] = item;
        } else {
            unkeyed.push(item);
        }
    }

    foreach json item in liveItems {
        if item is map<json> && item.hasKey(idKey) && item[idKey] is string {
            string k = <string>item[idKey];
            if !byId.hasKey(k) {
                orderedKeys.push(k);
            }
            byId[k] = item;
        } else {
            unkeyed.push(item);
        }
    }

    json[] merged = [];
    foreach string k in orderedKeys {
        merged.push(byId.get(k));
    }
    foreach json item in unkeyed {
        merged.push(item);
    }
    return merged;
}

// Checks whether an existing seed file on disk was explicitly emptied ("" or "{}").
isolated function isSeedFileExplicitlyEmpty(string? customPath = ()) returns boolean {
    string[] candidatePaths = getCandidatePaths(customPath);
    foreach string path in candidatePaths {
        string|error readResult = io:fileReadString(path);
        if readResult is string {
            string trimmed = readResult.trim();
            return trimmed == "" || trimmed == "{}";
        }
    }
    return false;
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
    if customPath is () && !isSeedFileExplicitlyEmpty(customPath) {
        json[] liveOrders = fetchLiveArray("ORDER_SERVICE_URL", "/orders");
        if liveOrders.length() > 0 {
            return mergeAndDeduplicate(baseOrders, liveOrders, "orderId");
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
    if customPath is () && !isSeedFileExplicitlyEmpty(customPath) {
        json[] livePayments = fetchLiveArray("PAYMENT_SERVICE_URL", "/payments");
        if livePayments.length() > 0 {
            return mergeAndDeduplicate(basePayments, livePayments, "orderId");
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
    if customPath is () && !isSeedFileExplicitlyEmpty(customPath) {
        json[] liveDeliveries = fetchLiveArray("DELIVERY_SERVICE_URL", "/deliveries");
        if liveDeliveries.length() > 0 {
            return mergeAndDeduplicate(baseDeliveries, liveDeliveries, "orderId");
        }
    }
    return baseDeliveries;
}
