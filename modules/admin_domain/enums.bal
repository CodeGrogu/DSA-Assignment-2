// Severity levels decide how urgent a notification is.
// INFO is a normal update, WARN needs attention soon, CRITICAL is an SLA breach or failure.
public enum Severity {
    INFO,
    WARN,
    CRITICAL
}

// Delivery channels we support. Each channel has its own message format.
public enum DeliveryChannel {
    EMAIL,
    SMS,
    PUSH
}

// Alias for backwards compatibility
public type Channel DeliveryChannel;

// Who the notification is going to.
public enum RecipientRole {
    CUSTOMER,
    RESTAURANT,
    DRIVER
}
