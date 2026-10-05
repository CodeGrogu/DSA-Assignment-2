import ballerina/os;

// All topics the notification service listens to.
// Backward compatibility constants
public const string TOPIC_ORDERS = "orders.events";
public const string TOPIC_PAYMENTS = "payments.events";
public const string TOPIC_KITCHEN = "kitchen.events";
public const string TOPIC_DELIVERY = "delivery.events";

// Platform topics emitted across services
public const string TOPIC_ORDERS_CREATED = "orders.created";
public const string TOPIC_ORDERS_CONFIRMED = "orders.confirmed";
public const string TOPIC_ORDERS_CANCELLED = "orders.cancelled";
public const string TOPIC_PAYMENTS_COMPLETED = "payments.completed";
public const string TOPIC_PAYMENTS_FAILED = "payments.failed";
public const string TOPIC_ORDERS_PREPARING = "orders.preparing";
public const string TOPIC_KITCHEN_ORDERS_READY = "kitchen.orders.ready";
public const string TOPIC_DELIVERY_ASSIGNED = "delivery.assigned";
public const string TOPIC_DELIVERY_STATUS = "delivery.status";

// Subscription list containing all platform topics as well as legacy shared topics
public final string[] SUBSCRIPTION_TOPICS = [
    TOPIC_ORDERS_CREATED,
    TOPIC_ORDERS_CONFIRMED,
    TOPIC_ORDERS_CANCELLED,
    TOPIC_PAYMENTS_COMPLETED,
    TOPIC_PAYMENTS_FAILED,
    TOPIC_ORDERS_PREPARING,
    TOPIC_KITCHEN_ORDERS_READY,
    TOPIC_DELIVERY_ASSIGNED,
    TOPIC_DELIVERY_STATUS,
    TOPIC_ORDERS,
    TOPIC_PAYMENTS,
    TOPIC_KITCHEN,
    TOPIC_DELIVERY
];

public final string[] NOTIFICATION_TOPICS = SUBSCRIPTION_TOPICS;

// Group id — Kafka uses this to know which consumers share the load.
public const string CONSUMER_GROUP = "notification-service";

// Kafka broker address, from env if set, else local default.
public function kafkaBootstrapServers() returns string {
    string envBroker = os:getEnv("KAFKA_BROKER");
    if envBroker != "" {
        return envBroker;
    }
    string envServers = os:getEnv("KAFKA_BOOTSTRAP_SERVERS");
    if envServers != "" {
        return envServers;
    }
    return "localhost:29092";
}

