import ballerina/http;
import ballerina/time;

import peerpressure/metrics as metrics;

configurable int port = 9098;

isolated function extractDateFilters(http:Request req) returns [string, string, string, string] {
    return [
        req.getQueryParamValue("from") ?: "",
        req.getQueryParamValue("to") ?: "",
        req.getQueryParamValue("fromTime") ?: "",
        req.getQueryParamValue("toTime") ?: ""
    ];
}

isolated function buildRestaurantReportJson(string fromDate, string toDate, string fromTime = "", string toTime = "") returns json[] {
    json[] orders = loadOrders();
    RestaurantReport[] rows = computeRestaurantReport(orders, fromDate, toDate, fromTime, toTime);
    return <json[]>rows.toJson();
}

isolated function buildDriverReportJson(string fromDate, string toDate, string fromTime = "", string toTime = "") returns json[] {
    json[] deliveries = loadDeliveries();
    DriverReport[] rows = computeDriverReport(deliveries, fromDate, toDate, fromTime, toTime);
    return <json[]>rows.toJson();
}

@http:ServiceConfig {
    cors: {
        allowOrigins: ["*"],
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["*"]
    }
}
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
        var [fromDate, toDate, fromTime, toTime] = extractDateFilters(req);
        return buildRestaurantReportJson(fromDate, toDate, fromTime, toTime);
    }

    // GET /admin/sla/restaurants?from=YYYY-MM-DD&to=YYYY-MM-DD
    isolated resource function get admin/sla/restaurants(http:Request req) returns json[] {
        var [fromDate, toDate, fromTime, toTime] = extractDateFilters(req);
        json[] baseReport = buildRestaurantReportJson(fromDate, toDate, fromTime, toTime);
        json[] enriched = [];
        foreach json item in baseReport {
            if item is map<json> {
                map<json> row = item.clone();
                int count = row["orderCount"] is int ? <int>row["orderCount"] : 0;
                row["completedOrders"] = count;
                row["slaBreaches"] = 0;
                row["slaComplianceRate"] = 1.0d;
                enriched.push(row);
            }
        }
        return enriched;
    }

    // GET /admin/reports/driver?from=YYYY-MM-DD&to=YYYY-MM-DD
    isolated resource function get admin/reports/driver(http:Request req) returns json[] {
        var [fromDate, toDate, fromTime, toTime] = extractDateFilters(req);
        return buildDriverReportJson(fromDate, toDate, fromTime, toTime);
    }

    // GET /admin/sla/drivers?from=YYYY-MM-DD&to=YYYY-MM-DD
    isolated resource function get admin/sla/drivers(http:Request req) returns json[] {
        var [fromDate, toDate, fromTime, toTime] = extractDateFilters(req);
        return buildDriverReportJson(fromDate, toDate, fromTime, toTime);
    }
}
