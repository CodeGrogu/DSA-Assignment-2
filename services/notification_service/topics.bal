// All topics the notification service listens to.
public const string TOPIC_ORDERS = "orders.events";
public const string TOPIC_PAYMENTS = "payments.events";
public const string TOPIC_KITCHEN = "kitchen.events";
public const string TOPIC_DELIVERY = "delivery.events";

// Group id — Kafka uses this to know which consumers share the load.
public const string CONSUMER_GROUP = "notification-service";

// Kafka broker address, from env if set, else local default.
public function kafkaBootstrapServers() returns string {
    return "localhost:29092";
}
