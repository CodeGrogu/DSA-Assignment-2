import ballerina/test;

@test:Config {}
function testComputeOverviewBasics() {
    json[] orders = [
        {"orderId": "o1", "status": "DELIVERED", "totalAmount": 100.00},
        {"orderId": "o2", "status": "DELIVERED", "totalAmount": 50.00},
        {"orderId": "o3", "status": "CANCELLED", "totalAmount": 999.00}
    ];
    json[] payments = [
        {"paymentId": "p1", "status": "COMPLETED"},
        {"paymentId": "p2", "status": "FAILED"}
    ];
    json[] deliveries = [
        {"deliveryId": "d1", "status": "DELIVERED"},
        {"deliveryId": "d2", "status": "IN_TRANSIT"}
    ];

    Overview ov = computeOverview(orders, payments, deliveries);

    test:assertEquals(ov.totalOrders, 3);
    // GMV excludes CANCELLED orders: 100 + 50 = 150
    test:assertEquals(ov.grossMerchandiseValue, 150.00d);
    test:assertEquals(ov.successfulPayments, 1);
    test:assertEquals(ov.failedPayments, 1);
    test:assertEquals(ov.activeDeliveries, 1);
}

@test:Config {}
function testEmptyInputs() {
    Overview ov = computeOverview([], [], []);
    test:assertEquals(ov.totalOrders, 0);
    test:assertEquals(ov.grossMerchandiseValue, 0d);
    test:assertEquals(ov.successfulPayments, 0);
    test:assertEquals(ov.failedPayments, 0);
    test:assertEquals(ov.activeDeliveries, 0);
}

@test:Config {}
function testRestaurantReportBasic() {
    json[] orders = [
        {"orderId": "o1", "restaurantId": "r1", "status": "DELIVERED", "totalAmount": 100.00, "createdAt": "2026-10-01T12:00:00Z"},
        {"orderId": "o2", "restaurantId": "r1", "status": "DELIVERED", "totalAmount": 50.00, "createdAt": "2026-10-02T12:00:00Z"},
        {"orderId": "o3", "restaurantId": "r2", "status": "DELIVERED", "totalAmount": 200.00, "createdAt": "2026-10-02T12:00:00Z"},
        {"orderId": "o4", "restaurantId": "r2", "status": "CANCELLED", "totalAmount": 999.00, "createdAt": "2026-10-02T12:00:00Z"}
    ];

    RestaurantReport[] rows = computeRestaurantReport(orders, "", "");

    test:assertEquals(rows.length(), 2);
    // Find r1
    foreach RestaurantReport r in rows {
        if r.restaurantId == "r1" {
            test:assertEquals(r.orderCount, 2);
            test:assertEquals(r.grossSales, 150.00d);
            test:assertEquals(r.commissionAmount, 15.00d);
            test:assertEquals(r.netPayout, 135.00d);
        }
        if r.restaurantId == "r2" {
            test:assertEquals(r.orderCount, 1);
            test:assertEquals(r.grossSales, 200.00d);
        }
    }
}

@test:Config {}
function testRestaurantReportDateFilter() {
    json[] orders = [
        {"orderId": "o1", "restaurantId": "r1", "status": "DELIVERED", "totalAmount": 100.00, "createdAt": "2026-10-01T12:00:00Z"},
        {"orderId": "o2", "restaurantId": "r1", "status": "DELIVERED", "totalAmount": 50.00, "createdAt": "2026-10-02T12:00:00Z"}
    ];

    RestaurantReport[] rows = computeRestaurantReport(orders, "2026-10-02", "2026-10-02");

    test:assertEquals(rows.length(), 1);
    test:assertEquals(rows[0].orderCount, 1);
    test:assertEquals(rows[0].grossSales, 50.00d);
}

@test:Config {}
function testDriverReportBasic() {
    json[] deliveries = [
        {"deliveryId": "d1", "driverId": "dr1", "driverName": "Tomas", "status": "DELIVERED", "assignedAt": "2026-10-01T12:00:00Z", "deliveredAt": "2026-10-01T12:30:00Z"},
        {"deliveryId": "d2", "driverId": "dr1", "driverName": "Tomas", "status": "DELIVERED", "assignedAt": "2026-10-02T12:00:00Z", "deliveredAt": "2026-10-02T13:00:00Z"}
    ];

    DriverReport[] rows = computeDriverReport(deliveries, "", "");

    test:assertEquals(rows.length(), 1);
    test:assertEquals(rows[0].driverId, "dr1");
    test:assertEquals(rows[0].completedDeliveries, 2);
    // One 30-min delivery + one 60-min delivery = avg 45 min
    test:assertEquals(rows[0].averageTurnaroundMinutes, 45.0d);
    // SLA is 45 min, so the 60-min delivery is 1 breach
    test:assertEquals(rows[0].slaBreaches, 1);
}
