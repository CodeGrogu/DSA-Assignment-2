import ballerina/lang.'string as strings;
import ballerina/test;

import peerpressure/kafka_client;

@test:Config {}
function testIsTransientClassification() {
    // Transient errors
    test:assertTrue(isTransient(error("Connection refused by peer")));
    test:assertTrue(isTransient(error("Socket timeout while connecting")));
    test:assertTrue(isTransient(error("Broker unavailable in cluster")));
    test:assertTrue(isTransient(error("503 Service Unavailable")));
    test:assertTrue(isTransient(error("Network failure")));

    // Permanent errors
    kafka_client:DeserializationError desErr = error kafka_client:DeserializationError("Bad JSON", rawContent = "{", reason = "Syntax error");
    test:assertFalse(isTransient(desErr));
    test:assertFalse(isTransient(error("Validation failed: missing customerId")));
    test:assertFalse(isTransient(error("Illegal transition from CREATED to DELIVERED")));
    test:assertFalse(isTransient(error("400 Bad Request")));
    test:assertFalse(isTransient(error("Entity not found: order-999")));
}

@test:Config {}
function testCalculateBackoffProgression() {
    RetryPolicy policy = {
        maxAttempts: 3,
        initialBackoffSeconds: 1.0,
        backoffMultiplier: 2.0,
        maxBackoffSeconds: 10.0
    };

    decimal delay1 = calculateBackoff(1, policy);
    test:assertEquals(delay1, 1.0d);

    decimal delay2 = calculateBackoff(2, policy);
    test:assertEquals(delay2, 2.0d);

    decimal delay3 = calculateBackoff(3, policy);
    test:assertEquals(delay3, 4.0d);

    decimal cappedDelay = calculateBackoff(10, policy);
    test:assertEquals(cappedDelay, 10.0d);
}

// Stateful counter for retry tests
isolated class Counter {
    private int count = 0;

    isolated function increment() returns int {
        lock {
            self.count += 1;
            return self.count;
        }
    }

    isolated function get() returns int {
        lock {
            return self.count;
        }
    }
}

@test:Config {}
function testExecuteWithRetryImmediateSuccess() returns error? {
    final Counter counter = new;
    isolated function () returns error? op = isolated function() returns error? {
        _ = counter.increment();
        return ();
    };

    check executeWithRetry(op, {maxAttempts: 3, initialBackoffSeconds: 0.01});
    test:assertEquals(counter.get(), 1);
}

@test:Config {}
function testExecuteWithRetrySucceedsOnSecondAttempt() returns error? {
    final Counter counter = new;
    isolated function () returns error? op = isolated function() returns error? {
        int attempt = counter.increment();
        if attempt == 1 {
            return error("temporary network timeout");
        }
        return ();
    };

    check executeWithRetry(op, {maxAttempts: 3, initialBackoffSeconds: 0.01});
    test:assertEquals(counter.get(), 2);
}

@test:Config {}
function testExecuteWithRetryBypassesPermanentFailure() {
    final Counter counter = new;
    isolated function () returns error? op = isolated function() returns error? {
        _ = counter.increment();
        return error("Validation failed: invalid syntax");
    };

    error? result = executeWithRetry(op, {maxAttempts: 3, initialBackoffSeconds: 0.01});
    test:assertTrue(result is error);
    test:assertEquals(counter.get(), 1, "Permanent error must not be retried");
}

@test:Config {}
function testExecuteWithRetryExhaustion() {
    final Counter counter = new;
    isolated function () returns error? op = isolated function() returns error? {
        _ = counter.increment();
        return error("persistent connection timeout");
    };

    error? result = executeWithRetry(op, {maxAttempts: 3, initialBackoffSeconds: 0.01});
    test:assertTrue(result is RetryExhaustedError, "Expected RetryExhaustedError");
    test:assertEquals(counter.get(), 3, "Transient error should be retried up to maxAttempts");
}

@test:Config {}
function testDlqTopicResolution() {
    test:assertEquals(resolveDlqTopic("orders.created"), "orders.created.dlq");
    test:assertEquals(resolveDlqTopic("payments.completed"), "payments.completed.dlq");
    test:assertEquals(resolveDlqTopic("orders.events.dlq"), "orders.events.dlq");
}

@test:Config {}
function testBuildDiagnosticHeaders() returns error? {
    DlqContext ctx = {
        sourceTopic: "orders.created",
        originalPartition: 2,
        originalOffset: 1045,
        retryCount: 3,
        exceptionMessage: "Deserialization failed",
        timestamp: "2026-10-05T18:00:00Z"
    };

    map<byte[]> headers = buildDiagnosticHeaders(ctx);
    test:assertEquals(headers.length(), 6);

    byte[]? exMsg = headers["x-exception-message"];
    test:assertTrue(exMsg is byte[]);
    if exMsg is byte[] {
        test:assertEquals(check strings:fromBytes(exMsg), "Deserialization failed");
    }

    byte[]? srcTopic = headers["x-source-topic"];
    test:assertTrue(srcTopic is byte[]);
    if srcTopic is byte[] {
        test:assertEquals(check strings:fromBytes(srcTopic), "orders.created");
    }

    byte[]? retries = headers["x-retry-count"];
    test:assertTrue(retries is byte[]);
    if retries is byte[] {
        test:assertEquals(check strings:fromBytes(retries), "3");
    }

    byte[]? ts = headers["x-timestamp"];
    test:assertTrue(ts is byte[]);
    if ts is byte[] {
        test:assertEquals(check strings:fromBytes(ts), "2026-10-05T18:00:00Z");
    }

    byte[]? partition = headers["x-original-partition"];
    test:assertTrue(partition is byte[]);
    if partition is byte[] {
        test:assertEquals(check strings:fromBytes(partition), "2");
    }

    byte[]? offset = headers["x-original-offset"];
    test:assertTrue(offset is byte[]);
    if offset is byte[] {
        test:assertEquals(check strings:fromBytes(offset), "1045");
    }
}

@test:Config {}
function testDlqRouterInit() {
    DlqRouter router = new ();
    _ = router;
    test:assertEquals(resolveDlqTopic("test.topic"), "test.topic.dlq");
}

