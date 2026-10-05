import ballerina/http;
import ballerina/log;
import ballerina/time;

import peerpressure/metrics as metrics;

configurable int port = 9094;

service / on new http:Listener(port) {
    resource function get health() returns json {
        time:Utc startTime = time:utcNow();
        json response = {
            status: "UP",
            "service": "payment_service",
            port: port,
            version: "0.1.0",
            contracts: "peerpressure/events:0.1.0"
        };
        time:Utc endTime = time:utcNow();
        decimal durationMs = time:utcDiffSeconds(endTime, startTime) * 1000d;
        metrics:recordHttpRequest("GET", "/health", 200, durationMs, "payment_service");
        metrics:recordMessageLatency("payments.completed", durationMs, "payment_service");
        metrics:setConsumerLagMetric("payment_service_group", "payments.completed", 0);
        return response;
    }

    resource function get metrics() returns http:Response {
        return metrics:getMetricsResponse();
    }

    resource function get payments/[string id]() returns http:Response {
        PaymentTransaction?|error result = findTransactionById(id);
        if result is error {
            log:printError("Payment lookup failed", 'error = result);
            return apiError(500, "PAYMENT_LOOKUP_FAILED", "Unable to retrieve payment details");
        }
        if result is () {
            return apiError(404, "PAYMENT_NOT_FOUND", "No payment exists for the requested id");
        }
        http:Response response = new;
        response.statusCode = 200;
        response.setPayload(result);
        return response;
    }

    resource function get payments/'order/[string orderId]() returns http:Response {
        log:printInfo("Payment order lookup started", orderId = orderId);
        PaymentTransaction?|error result = findTransactionByOrder(orderId);
        log:printInfo("Payment order lookup query returned", orderId = orderId);
        if result is error {
            log:printError("Payment status lookup failed", 'error = result);
            return apiError(500, "PAYMENT_LOOKUP_FAILED", "Unable to retrieve payment status");
        }
        if result is () {
            return apiError(404, "PAYMENT_NOT_FOUND", "No payment exists for the requested order");
        }
        http:Response response = new;
        response.statusCode = 200;
        response.setPayload(result);
        return response;
    }
}

function apiError(int statusCode, string code, string message) returns http:Response {
    http:Response response = new;
    response.statusCode = statusCode;
    PaymentApiError body = {'error: {code, message}};
    response.setPayload(body);
    return response;
}
