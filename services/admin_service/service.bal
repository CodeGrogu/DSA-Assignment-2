import ballerina/http;
import ballerina/time;

import peerpressure/events as _;

configurable int port = 9098;

service / on new http:Listener(port) {

    resource function get health() returns json {
        return {
            status: "UP",
            "service": "admin_service",
            port: port,
            version: "0.1.0",
            contracts: "peerpressure/events:0.1.0"
        };
    }

    // GET /admin/stats/overview
    resource function get admin/stats/overview() returns json {
        json[] orders = loadOrders();
        json[] payments = loadPayments();
        json[] deliveries = loadDeliveries();

        Overview ov = computeOverview(orders, payments, deliveries);

        // Fill in generatedAt at response time.
        string now = time:utcToString(time:utcNow());

        return {
            totalOrders: ov.totalOrders,
            grossMerchandiseValue: ov.grossMerchandiseValue,
            successfulPayments: ov.successfulPayments,
            failedPayments: ov.failedPayments,
            activeDeliveries: ov.activeDeliveries,
            generatedAt: now
        };
    }
}
