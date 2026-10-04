// Severity levels decide how urgent a notification is.
// INFO is a normal update, WARN needs attention soon, CRITICAL is an SLA breach or failure.
public enum Severity {
    INFO,
    WARN,
    CRITICAL
}

// Delivery channels we support. Each channel has its own message format.
public enum Channel {
    EMAIL,
    SMS,
    PUSH
}

// Who the notification is going to.
public enum RecipientRole {
    CUSTOMER,
    RESTAURANT,
    DRIVER
}
