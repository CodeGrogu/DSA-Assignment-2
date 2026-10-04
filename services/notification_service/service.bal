import ballerina/http;
import ballerina/time;

import peerpressure/metrics as metrics;

configurable int port = 9097;

service / on new http:Listener(port) {
    resource function get health() returns json {
        time:Utc start = time:utcNow();
        json response = {
            status: "UP",
            "service": "notification_service",
            port: port,
            version: "0.1.0",
            contracts: "peerpressure/events:0.1.0"
        };
        time:Utc end = time:utcNow();
        decimal durationMs = time:utcDiffSeconds(start, end) * 1000d;
        metrics:recordHttpRequest("GET", "/health", 200, durationMs, "notification_service");
        metrics:recordMessageLatency("notifications.dispatched", durationMs, "notification_service");
        metrics:setConsumerLagMetric("notification_service_group", "notifications.dispatched", 0);
        return response;
    }

    resource function get metrics() returns http:Response {
        return metrics:getMetricsResponse();
    }
}
