import ballerina/test;

@test:Config {}
function testSeverityEnumHasThreeLevels() {
    // We rely on these three names everywhere else.
    Severity info = INFO;
    Severity warn = WARN;
    Severity critical = CRITICAL;
    test:assertEquals(info.toString(), "INFO");
    test:assertEquals(warn.toString(), "WARN");
    test:assertEquals(critical.toString(), "CRITICAL");
}

@test:Config {}
function testChannelEnum() {
    test:assertEquals(EMAIL.toString(), "EMAIL");
    test:assertEquals(SMS.toString(), "SMS");
    test:assertEquals(PUSH.toString(), "PUSH");
}

@test:Config {}
function testNotificationPayloadRoundTrip() {
    // Just make sure the record accepts the fields we expect.
    NotificationPayload p = {
        notificationId: "n-1",
        role: CUSTOMER,
        recipientId: "c-100",
        channel: PUSH,
        severity: INFO,
        subject: "Order received",
        body: "We got your order.",
        relatedEventType: "order.created",
        relatedEventId: "o-500",
        createdAt: "2026-10-04T10:00:00Z"
    };
    test:assertEquals(p.role, CUSTOMER);
    test:assertEquals(p.channel, PUSH);
}

@test:Config {}
function testMatrixCoversOrderCreated() {
    SubscriptionRule[] rules = rulesForEvent("order.created");
    test:assertEquals(rules.length(), 1);
    test:assertEquals(rules[0].recipient, CUSTOMER);
    test:assertEquals(rules[0].severity, INFO);
}

@test:Config {}
function testSlaBreachHitsBothCustomerAndDriver() {
    // An SLA breach is a big deal — both parties get told.
    SubscriptionRule[] rules = rulesForEvent("delivery.sla_breach");
    test:assertEquals(rules.length(), 2);

    boolean sawCustomer = false;
    boolean sawDriver = false;
    foreach SubscriptionRule r in rules {
        if r.recipient == CUSTOMER {
            sawCustomer = true;
        }
        if r.recipient == DRIVER {
            sawDriver = true;
        }
        test:assertEquals(r.severity, CRITICAL);
        test:assertEquals(r.channel, SMS);
    }
    test:assertTrue(sawCustomer, "customer should be notified");
    test:assertTrue(sawDriver, "driver should be notified");
}

@test:Config {}
function testUnknownEventReturnsEmpty() {
    SubscriptionRule[] rules = rulesForEvent("something.we.dont.know");
    test:assertEquals(rules.length(), 0);
}

@test:Config {}
function testPlatformOverviewFields() {
    PlatformOverview o = {
        totalOrders: 120,
        grossMerchandiseValue: 45600.50,
        successfulPayments: 115,
        failedPayments: 5,
        activeDeliveries: 7,
        generatedAt: "2026-10-04T12:00:00Z"
    };
    test:assertEquals(o.totalOrders, 120);
    test:assertEquals(o.failedPayments, 5);
}

@test:Config {}
function testRestaurantReportPayoutMath() {
    // gross - commission = net payout
    RestaurantReport r = {
        restaurantId: "r-1",
        restaurantName: "Kasi Kitchen",
        orderCount: 40,
        grossSales: 8000.00,
        commissionAmount: 800.00,
        netPayout: 7200.00
    };
    test:assertEquals(r.grossSales - r.commissionAmount, r.netPayout);
}

@test:Config {}
function testDriverReportSlaBreachCount() {
    DriverReport d = {
        driverId: "d-9",
        driverName: "Tomas",
        completedDeliveries: 32,
        averageTurnaroundMinutes: 24.5,
        slaBreaches: 2
    };
    test:assertEquals(d.completedDeliveries, 32);
    test:assertTrue(d.slaBreaches <= d.completedDeliveries);
}

@test:Config {}
function testDailySnapshotComplianceRate() {
    DailyMetricsSnapshot s = {
        date: "2026-10-03",
        totalOrders: 100,
        deliveredOnTime: 92,
        deliveredLate: 8,
        slaComplianceRate: 0.92
    };
    test:assertEquals(s.deliveredOnTime + s.deliveredLate, s.totalOrders);
    test:assertTrue(s.slaComplianceRate > 0.0d && s.slaComplianceRate <= 1.0d);
}
