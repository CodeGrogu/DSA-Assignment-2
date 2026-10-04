import ballerina/http;
import ballerina/time;

import peerpressure/metrics as metrics;

configurable int port = 9093;

service / on new http:Listener(port) {
    resource function get health() returns json {
        time:Utc start = time:utcNow();
        json response = {
            status: "UP",
            "service": "customer_service",
            port: port,
            version: "0.1.0",
            contracts: "peerpressure/events:0.1.0"
        };
        time:Utc end = time:utcNow();
        decimal durationMs = time:utcDiffSeconds(start, end) * 1000d;
        metrics:recordHttpRequest("GET", "/health", 200, durationMs, "customer_service");
        metrics:recordMessageLatency("customers.profile", durationMs, "customer_service");
        metrics:setConsumerLagMetric("customer_service_group", "customers.profile", 0);
        return response;
    }

    resource function get metrics() returns http:Response {
        return metrics:getMetricsResponse();
    }
}
