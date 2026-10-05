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
function testBootstrapServers() {
    // Local default until we wire env vars.
    test:assertEquals(kafkaBootstrapServers(), "localhost:29092");
}
