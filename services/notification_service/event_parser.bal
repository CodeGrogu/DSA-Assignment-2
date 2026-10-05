import ballerina/log;

// Wrapper every service puts around its payload so we know what it is.
// Shape: { "eventType": "order.created", "data": { ... } }
public type EventEnvelope record {|
    string eventType;
    json data;
|};

// Result of parsing a raw payload — carries both the type and the typed record.
public type ParsedEvent record {|
    string eventType;
    json data;
|};

// Try to decode bytes into an envelope. Returns nil if it doesn't match.
public function parseEnvelope(byte[] raw) returns ParsedEvent? {
    string text = checkpanic string:fromBytes(raw);
    json payload = checkpanic payloadFromJson(text);
    // Must have eventType and data — otherwise we can't route it.
    if payload is map<json> && payload.hasKey("eventType") && payload.hasKey("data") {
        return {
            eventType: <string>payload["eventType"],
            data: payload["data"]
        };
    }
    log:printWarn("Dropped a message — no eventType/data envelope", payload = text);
    return ();
}

// Parse a JSON string. Small wrapper so we can add logging later.
function payloadFromJson(string text) returns json|error {
    return text.fromJsonString();
}
