import ballerina/test;

@test:Config {}
function testSingleBracketHistogramLabels() returns error? {
    MetricsRegistry registry = new ();
    registry.observeLatency(
        "http_request_duration_ms",
        "HTTP latency",
        45.0d,
        {"service": "order_service", "handler": "createOrder"}
    );

    string output = registry.exportPrometheus();

    // Verify valid single bracket exposition format
    test:assertFalse(output.includes("}{"), "Output must not contain doubled braces '}{'");
    test:assertFalse(output.includes("{le=\"10\"}{"), "Output must not concatenate le and extra labels with multiple braces");

    // Verify single label set containing both le and extra labels
    test:assertTrue(output.includes("http_request_duration_ms_bucket{le=\"10\", service=\"order_service\", handler=\"createOrder\"}"),
            "Histogram bucket must format le and extra labels within a single set of braces");
    test:assertTrue(output.includes("http_request_duration_ms_bucket{le=\"+Inf\", service=\"order_service\", handler=\"createOrder\"}"),
            "+Inf bucket must format le=\"+Inf\" and extra labels within a single set of braces");
    test:assertTrue(output.includes("http_request_duration_ms_sum{service=\"order_service\", handler=\"createOrder\"}"),
            "Histogram sum must format labels correctly");
    test:assertTrue(output.includes("http_request_duration_ms_count{service=\"order_service\", handler=\"createOrder\"}"),
            "Histogram count must format labels correctly");
}

@test:Config {}
function testHistogramWithoutLabels() returns error? {
    MetricsRegistry registry = new ();
    registry.observeLatency("simple_latency_ms", "Latency without labels", 15.0d);

    string output = registry.exportPrometheus();

    // Verify buckets have only {le="..."} without doubled braces
    test:assertFalse(output.includes("}{"), "Output must not contain doubled braces");
    test:assertTrue(output.includes("simple_latency_ms_bucket{le=\"10\"}"), "Bucket 10 formatted with single brace");
    test:assertTrue(output.includes("simple_latency_ms_bucket{le=\"+Inf\"}"), "+Inf bucket formatted with single brace");
    test:assertTrue(output.includes("simple_latency_ms_sum 15"), "Sum without labels does not have braces");
    test:assertTrue(output.includes("simple_latency_ms_count 1"), "Count without labels does not have braces");
}

@test:Config {}
function testHistogramCumulativeBucketCalculation() returns error? {
    MetricsRegistry registry = new ();
    // Observe latency 45ms: <= 10 is false (0), <= 50 is true (1), <= 100 is true (1)
    registry.observeLatency("test_latency_ms", "Latency cumulative check", 45.0d);

    string output = registry.exportPrometheus();

    // Bucket 10 should be 0 because 45 > 10 (not <= 10)
    test:assertTrue(output.includes("test_latency_ms_bucket{le=\"10\"} 0"),
            "Bucket 10 should be 0 for sample value 45.0");
    // Bucket 50 should be 1 because 45 <= 50
    test:assertTrue(output.includes("test_latency_ms_bucket{le=\"50\"} 1"),
            "Bucket 50 should be 1 for sample value 45.0");
    // Bucket 100 should be 1 because 45 <= 100
    test:assertTrue(output.includes("test_latency_ms_bucket{le=\"100\"} 1"),
            "Bucket 100 should be 1 for sample value 45.0");
    // Bucket +Inf should be 1
    test:assertTrue(output.includes("test_latency_ms_bucket{le=\"+Inf\"} 1"),
            "Bucket +Inf should be 1");
}

@test:Config {}
function testCounterFormatting() returns error? {
    MetricsRegistry registry = new ();
    registry.incrementCounter("http_requests_total", "Total requests", {"method": "GET", "service": "order_service"});
    registry.incrementCounter("http_requests_total", "Total requests", {"method": "GET", "service": "order_service"});

    string output = registry.exportPrometheus();

    test:assertTrue(output.includes("# HELP http_requests_total Total requests"));
    test:assertTrue(output.includes("# TYPE http_requests_total counter"));
    test:assertTrue(output.includes("http_requests_total{method=\"GET\", service=\"order_service\"} 2"));
    test:assertFalse(output.includes("}{"));
}

@test:Config {}
function testGaugeFormatting() returns error? {
    MetricsRegistry registry = new ();
    registry.setGauge("active_connections", "Active DB connections", 12.0d, {"pool": "primary"});

    string output = registry.exportPrometheus();

    test:assertTrue(output.includes("# HELP active_connections Active DB connections"));
    test:assertTrue(output.includes("# TYPE active_connections gauge"));
    test:assertTrue(output.includes("active_connections{pool=\"primary\"} 12"));
    test:assertFalse(output.includes("}{"));
}

@test:Config {}
function testConsumerLagFormatting() returns error? {
    MetricsRegistry registry = new ();
    registry.setConsumerLag("order_service_group", "orders.created", 42);

    string output = registry.exportPrometheus();

    test:assertTrue(output.includes("# HELP kafka_consumer_lag Consumer lag reported per consumer group and topic"));
    test:assertTrue(output.includes("# TYPE kafka_consumer_lag gauge"));
    test:assertTrue(output.includes("kafka_consumer_lag{group_topic=\"order_service_group:orders.created\"} 42"));
    test:assertFalse(output.includes("}{"));
}

@test:Config {}
function testConvenienceFunctionsAndResponse() returns error? {
    globalMetricsRegistry.reset();
    recordHttpRequest("POST", "/orders", 201, 25.5d, "order_service");
    recordMessageLatency("orders.created", 18.2d, "order_service");
    setConsumerLagMetric("order_service_group", "orders.created", 3);

    var response = getMetricsResponse();
    test:assertEquals(response.statusCode, 200);
    test:assertTrue(response.getContentType().includes("text/plain") && response.getContentType().includes("version=0.0.4"));

    string payload = check response.getTextPayload();
    test:assertFalse(payload.includes("}{"));
    test:assertTrue(payload.includes("http_requests_total{method=\"POST\", path=\"/orders\", status=\"201\", service=\"order_service\"} 1"));
    test:assertTrue(payload.includes("http_request_duration_ms{method=\"POST\", path=\"/orders\", status=\"201\", service=\"order_service\"} 25.5"));
    test:assertTrue(payload.includes("message_processing_latency_ms_bucket{le=\"10\", topic=\"orders.created\", service=\"order_service\"} 0"));
    test:assertTrue(payload.includes("message_processing_latency_ms_bucket{le=\"50\", topic=\"orders.created\", service=\"order_service\"} 1"));
    test:assertTrue(payload.includes("kafka_consumer_lag{group_topic=\"order_service_group:orders.created\"} 3"));
}
