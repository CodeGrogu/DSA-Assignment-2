import ballerina/http;
import ballerina/time;

import peerpressure/metrics as metrics;

configurable int port = 9096;

isolated map<json> inMemoryDeliveries = {
    "ord_test_1": {
        deliveryId: "del_ord_test_1",
        orderId: "ord_test_1",
        driverId: "drv_001",
        status: "IN_TRANSIT",
        currentLocation: {
            latitude: -22.5609d,
            longitude: 17.0658d
        }
    }
};

@http:ServiceConfig {
    cors: {
        allowOrigins: ["*"],
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowHeaders: ["*"]
    }
}
service / on new http:Listener(port) {
    resource function get health() returns json {
        time:Utc startTime = time:utcNow();
        json response = {
            status: "UP",
            "service": "delivery_service",
            port: port,
            version: "0.1.0",
            contracts: "peerpressure/events:0.1.0"
        };
        time:Utc endTime = time:utcNow();
        decimal durationMs = time:utcDiffSeconds(endTime, startTime) * 1000d;
        metrics:recordHttpRequest("GET", "/health", 200, durationMs, "delivery_service");
        metrics:recordMessageLatency("delivery.status", durationMs, "delivery_service");
        metrics:setConsumerLagMetric("delivery_service_group", "delivery.status", 0);
        return response;
    }

    resource function get metrics() returns http:Response {
        return metrics:getMetricsResponse();
    }

    resource function get delivery/track/[string orderId]() returns json|http:NotFound {
        if orderId.trim() == "" {
            return <http:NotFound>{body: {"error": "Order ID not found"}};
        }
        json? cached = ();
        lock {
            if inMemoryDeliveries.hasKey(orderId) {
                cached = inMemoryDeliveries.get(orderId).cloneReadOnly();
            }
        }
        if cached !is () {
            return cached;
        }

        json defaultDelivery = {
            deliveryId: "del_" + orderId,
            orderId: orderId,
            driverId: "drv_001",
            status: "IN_TRANSIT",
            currentLocation: {
                latitude: -22.5609d,
                longitude: 17.0658d
            }
        };
        return defaultDelivery;
    }

    resource function post deliveries(@http:Payload json payload) returns http:Created|http:BadRequest {
        if payload !is map<json> {
            return <http:BadRequest>{body: {"error": "Invalid request payload, expected JSON object"}};
        }

        json orderIdJson = payload["orderId"];
        if orderIdJson !is string || orderIdJson.trim() == "" {
            return <http:BadRequest>{body: {"error": "Missing or invalid required field 'orderId'"}};
        }
        string orderId = orderIdJson.trim();

        string deliveryId = "del_" + orderId;
        json delIdJson = payload["deliveryId"];
        if delIdJson is string && delIdJson.trim() != "" {
            deliveryId = delIdJson.trim();
        }

        string driverId = "drv_001";
        json driverIdJson = payload["driverId"];
        if driverIdJson is string && driverIdJson.trim() != "" {
            driverId = driverIdJson.trim();
        }

        string status = "IN_TRANSIT";
        json statusJson = payload["status"];
        if statusJson is string && statusJson.trim() != "" {
            status = statusJson.trim();
        }

        json currentLocation = {
            latitude: -22.5609d,
            longitude: 17.0658d
        };
        json locJson = payload["currentLocation"];
        if locJson is map<json> {
            currentLocation = locJson;
        }

        json deliveryRecord = {
            deliveryId: deliveryId,
            orderId: orderId,
            driverId: driverId,
            status: status,
            currentLocation: currentLocation
        };

        lock {
            inMemoryDeliveries[orderId] = deliveryRecord.cloneReadOnly();
            inMemoryDeliveries[deliveryId] = deliveryRecord.cloneReadOnly();
        }

        return <http:Created>{body: deliveryRecord};
    }
}
