import ballerina/lang.'string as strings;

# Safely extracts a byte array from a Kafka consumer record value.
#
# + recordValue - The raw `anydata` value from `kafka:AnydataConsumerRecord`
# + return - The extracted `byte[]` or a `DeserializationError`
public isolated function extractBytes(anydata recordValue) returns byte[]|DeserializationError {
    if recordValue is byte[] {
        return recordValue;
    } else if recordValue is string {
        return recordValue.toBytes();
    }
    return error DeserializationError("Kafka record value must be byte[] or string",
        rawContent = recordValue.toString(),
        reason = "Unsupported payload type: expected byte[] or string"
    );
}

# Safely parses raw bytes or a string into a Ballerina `json` value.
# Traps UTF-8 conversion errors and malformed JSON syntax errors,
# returning a typed `DeserializationError` rather than panicking or crashing the consumer loop.
#
# + payload - The raw `byte[]` or `string` payload received from Kafka
# + return - Parsed `json` value or `DeserializationError`
public isolated function safeParseJson(byte[]|string payload) returns json|DeserializationError {
    string rawText;
    if payload is byte[] {
        string|error decoded = strings:fromBytes(payload);
        if decoded is error {
            return error DeserializationError("Failed to decode UTF-8 byte stream",
                rawContent = payload.toBalString(),
                reason = decoded.message()
            );
        }
        rawText = decoded;
    } else {
        rawText = payload;
    }

    if rawText.trim().length() == 0 {
        return error DeserializationError("Payload is empty or whitespace",
            rawContent = rawText,
            reason = "Empty payload cannot be parsed as JSON"
        );
    }

    json|error parsed = rawText.fromJsonString();
    if parsed is error {
        return error DeserializationError("Invalid JSON syntax in payload",
            rawContent = rawText,
            reason = parsed.message()
        );
    }

    return parsed;
}
