import ballerina/http;
import ballerina/time;

import peerpressure/metrics as metrics;

configurable int port = 9098;

service / on new http:Listener(port) {

    resource function get health() returns json {
        time:Utc startTime = time:utcNow();
        json response = {
            status: "UP",
            "service": "admin_service",
            port: port,
            version: "0.1.0",
            contracts: "peerpressure/events:0.1.0"
        };
        time:Utc endTime = time:utcNow();
        decimal durationMs = time:utcDiffSeconds(endTime, startTime) * 1000d;
        metrics:recordHttpRequest("GET", "/health", 200, durationMs, "admin_service");
        metrics:recordMessageLatency("orders.confirmed", durationMs, "admin_service");
        metrics:setConsumerLagMetric("admin_service_group", "orders.confirmed", 0);
        return response;
    }

    resource function get metrics() returns http:Response {
        return metrics:getMetricsResponse();
    }

    // GET /admin/stats/overview
    isolated resource function get admin/stats/overview() returns json {
        json[] orders = loadOrders();
        json[] payments = loadPayments();
        json[] deliveries = loadDeliveries();

        Overview ov = computeOverview(orders, payments, deliveries);
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

    // GET /admin/reports/restaurant?from=YYYY-MM-DD&to=YYYY-MM-DD
    isolated resource function get admin/reports/restaurant(http:Request req) returns json[] {
        string fromDate = req.getQueryParamValue("from") ?: "";
        string toDate = req.getQueryParamValue("to") ?: "";

        json[] orders = loadOrders();
        RestaurantReport[] rows = computeRestaurantReport(orders, fromDate, toDate);

        json[] result = [];
        foreach RestaurantReport r in rows {
            result.push({
                restaurantId: r.restaurantId,
                orderCount: r.orderCount,
                grossSales: r.grossSales,
                commissionAmount: r.commissionAmount,
                netPayout: r.netPayout
            });
        }
        return result;
    }

    // GET /admin/reports/driver?from=YYYY-MM-DD&to=YYYY-MM-DD
    isolated resource function get admin/reports/driver(http:Request req) returns json[] {
        string fromDate = req.getQueryParamValue("from") ?: "";
        string toDate = req.getQueryParamValue("to") ?: "";

        json[] deliveries = loadDeliveries();
        DriverReport[] rows = computeDriverReport(deliveries, fromDate, toDate);

        json[] result = [];
        foreach DriverReport r in rows {
            result.push({
                driverId: r.driverId,
                driverName: r.driverName,
                completedDeliveries: r.completedDeliveries,
                averageTurnaroundMinutes: r.averageTurnaroundMinutes,
                slaBreaches: r.slaBreaches
            });
        }
        return result;
    }
}
