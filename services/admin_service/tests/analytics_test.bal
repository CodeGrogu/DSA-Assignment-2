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
