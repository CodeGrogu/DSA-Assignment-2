import ballerina/http;
import ballerina/time;

import peerpressure/metrics as metrics;

configurable int port = 9091;

service / on new http:Listener(port) {
    resource function get health() returns json {
        time:Utc startTime = time:utcNow();
        json response = {
            status: "UP",
            "service": "order_service",
            port: port,
            version: "0.1.0",
            contracts: "peerpressure/events:0.1.0"
        };
        time:Utc endTime = time:utcNow();
        decimal durationMs = time:utcDiffSeconds(endTime, startTime) * 1000d;
        metrics:recordHttpRequest("GET", "/health", 200, durationMs, "order_service");
        metrics:recordMessageLatency("orders.created", durationMs, "order_service");
        metrics:setConsumerLagMetric("order_service_group", "orders.created", 0);
        return response;
    }

    resource function get metrics() returns http:Response {
        return metrics:getMetricsResponse();
    }
}
