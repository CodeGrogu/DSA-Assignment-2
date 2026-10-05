import ballerina/test;

@test:Config {}
function testSafeParseJsonValid() returns error? {
    string validJsonStr = "{\"orderId\": \"ord-123\", \"total\": 45.50}";
    json result = check safeParseJson(validJsonStr);
    test:assertEquals(check result.orderId, "ord-123");

    byte[] validBytes = validJsonStr.toBytes();
    json byteResult = check safeParseJson(validBytes);
    test:assertEquals(check byteResult.orderId, "ord-123");
}

@test:Config {}
function testSafeParseJsonMalformedString() {
    string malformed = "{orderId: 123, broken json";
    json|DeserializationError result = safeParseJson(malformed);
    test:assertTrue(result is DeserializationError, "Expected DeserializationError for malformed JSON string");
    if result is DeserializationError {
        test:assertEquals(result.detail().rawContent, malformed);
        test:assertTrue(result.message().includes("Invalid JSON syntax"));
    }
}

@test:Config {}
function testSafeParseJsonEmptyPayload() {
    string emptyStr = "   ";
    json|DeserializationError result = safeParseJson(emptyStr);
    test:assertTrue(result is DeserializationError, "Expected DeserializationError for empty payload");
    if result is DeserializationError {
        test:assertTrue(result.message().includes("empty or whitespace"));
    }
}

@test:Config {}
function testExtractBytesValid() returns error? {
    byte[] inputBytes = [1, 2, 3, 4];
    byte[] resultBytes = check extractBytes(inputBytes);
    test:assertEquals(resultBytes, inputBytes);

    string inputStr = "hello-kafka";
    byte[] resultFromStr = check extractBytes(inputStr);
    test:assertEquals(resultFromStr, inputStr.toBytes());
}

@test:Config {}
function testExtractBytesInvalid() {
    anydata invalidData = 12345;
    byte[]|DeserializationError result = extractBytes(invalidData);
    test:assertTrue(result is DeserializationError, "Expected DeserializationError for non byte[]/string data");
}

@test:Config {}
function testResilientProducerInit() {
    ProducerConfig config = {
        bootstrapServers: "localhost:9092",
        clientId: "test-producer-client",
        maxRetries: 2,
        retryBackoffSeconds: 0.1
    };
    ResilientProducer producer = new (config);
    _ = producer;
    test:assertEquals(config.clientId, "test-producer-client");
    test:assertEquals(config.maxRetries, 2);
}

@test:Config {}
function testResilientProducerOffline() {
    // Fast-failing config with nonexistent broker and 0 retries
    ProducerConfig config = {
        bootstrapServers: "localhost:19092",
        clientId: "offline-test-producer",
        maxRetries: 0,
        retryBackoffSeconds: 0.05
    };
    ResilientProducer producer = new (config);
    json payload = {test: "value"};
    PublishError? publishErr = producer.publishJson("test.topic", payload, "key-1");
    test:assertTrue(publishErr is PublishError, "Expected PublishError when broker is offline");
    if publishErr is PublishError {
        test:assertEquals(publishErr.detail().topic, "test.topic");
    }
}
