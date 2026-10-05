import ballerina/test;

@test:Config {}
function testTopicNames() {
    test:assertEquals(TOPIC_ORDERS, "orders.events");
    test:assertEquals(TOPIC_PAYMENTS, "payments.events");
    test:assertEquals(TOPIC_KITCHEN, "kitchen.events");
    test:assertEquals(TOPIC_DELIVERY, "delivery.events");
}

@test:Config {}
function testConsumerGroupName() {
    test:assertEquals(CONSUMER_GROUP, "notification-service");
}

@test:Config {}
function testPlatformTopicNames() {
    test:assertEquals(TOPIC_ORDERS_CREATED, "orders.created");
    test:assertEquals(TOPIC_ORDERS_CONFIRMED, "orders.confirmed");
    test:assertEquals(TOPIC_ORDERS_CANCELLED, "orders.cancelled");
    test:assertEquals(TOPIC_PAYMENTS_COMPLETED, "payments.completed");
    test:assertEquals(TOPIC_PAYMENTS_FAILED, "payments.failed");
    test:assertEquals(TOPIC_ORDERS_PREPARING, "orders.preparing");
    test:assertEquals(TOPIC_KITCHEN_ORDERS_READY, "kitchen.orders.ready");
    test:assertEquals(TOPIC_DELIVERY_ASSIGNED, "delivery.assigned");
    test:assertEquals(TOPIC_DELIVERY_STATUS, "delivery.status");
}

@test:Config {}
function testSubscriptionTopics() {
    test:assertTrue(SUBSCRIPTION_TOPICS.indexOf("orders.created") is int);
    test:assertTrue(SUBSCRIPTION_TOPICS.indexOf("orders.confirmed") is int);
    test:assertTrue(SUBSCRIPTION_TOPICS.indexOf("orders.cancelled") is int);
    test:assertTrue(SUBSCRIPTION_TOPICS.indexOf("payments.completed") is int);
    test:assertTrue(SUBSCRIPTION_TOPICS.indexOf("payments.failed") is int);
    test:assertTrue(SUBSCRIPTION_TOPICS.indexOf("orders.preparing") is int);
    test:assertTrue(SUBSCRIPTION_TOPICS.indexOf("kitchen.orders.ready") is int);
    test:assertTrue(SUBSCRIPTION_TOPICS.indexOf("delivery.assigned") is int);
    test:assertTrue(SUBSCRIPTION_TOPICS.indexOf("delivery.status") is int);
    test:assertTrue(SUBSCRIPTION_TOPICS.indexOf("orders.events") is int);
    test:assertTrue(SUBSCRIPTION_TOPICS.indexOf("payments.events") is int);
    test:assertTrue(SUBSCRIPTION_TOPICS.indexOf("kitchen.events") is int);
    test:assertTrue(SUBSCRIPTION_TOPICS.indexOf("delivery.events") is int);
}

@test:Config {}
function testBootstrapServers() {
    // Local default until we wire env vars.
    test:assertEquals(kafkaBootstrapServers(), "localhost:29092");
}

