// Maps an event type to who should be notified and how loud it should be.
// Used by the notification service to decide channels and severity.

// Order lifecycle events
public final SubscriptionRule ORDER_CREATED = {
    eventType: "order.created",
    recipient: CUSTOMER,
    channel: PUSH,
    severity: INFO,
    template: "order_created_customer"
};

public final SubscriptionRule ORDER_CONFIRMED = {
    eventType: "order.confirmed",
    recipient: CUSTOMER,
    channel: PUSH,
    severity: INFO,
    template: "order_confirmed_customer"
};

public final SubscriptionRule ORDER_READY = {
    eventType: "kitchen.order.ready",
    recipient: CUSTOMER,
    channel: PUSH,
    severity: INFO,
    template: "order_ready_customer"
};

public final SubscriptionRule ORDER_READY_FOR_DRIVER = {
    eventType: "kitchen.order.ready",
    recipient: DRIVER,
    channel: PUSH,
    severity: INFO,
    template: "pickup_ready_driver"
};

// Payment events
public final SubscriptionRule PAYMENT_COMPLETED = {
    eventType: "payments.completed",
    recipient: CUSTOMER,
    channel: EMAIL,
    severity: INFO,
    template: "payment_receipt_customer"
};

public final SubscriptionRule PAYMENT_FAILED = {
    eventType: "payments.failed",
    recipient: CUSTOMER,
    channel: SMS,
    severity: WARN,
    template: "payment_failed_customer"
};

// Delivery events
public final SubscriptionRule DELIVERY_ASSIGNED = {
    eventType: "delivery.assigned",
    recipient: CUSTOMER,
    channel: PUSH,
    severity: INFO,
    template: "driver_assigned_customer"
};

public final SubscriptionRule DELIVERY_COMPLETED = {
    eventType: "delivery.completed",
    recipient: CUSTOMER,
    channel: PUSH,
    severity: INFO,
    template: "delivered_customer"
};

// SLA breaches are the loud ones
public final SubscriptionRule SLA_BREACH_CUSTOMER = {
    eventType: "delivery.sla_breach",
    recipient: CUSTOMER,
    channel: SMS,
    severity: CRITICAL,
    template: "sla_breach_customer"
};

public final SubscriptionRule SLA_BREACH_DRIVER = {
    eventType: "delivery.sla_breach",
    recipient: DRIVER,
    channel: SMS,
    severity: CRITICAL,
    template: "sla_breach_driver"
};

// The full matrix. Notification service loops over this.
public final SubscriptionRule[] SUBSCRIPTION_MATRIX = [
    ORDER_CREATED,
    ORDER_CONFIRMED,
    ORDER_READY,
    ORDER_READY_FOR_DRIVER,
    PAYMENT_COMPLETED,
    PAYMENT_FAILED,
    DELIVERY_ASSIGNED,
    DELIVERY_COMPLETED,
    SLA_BREACH_CUSTOMER,
    SLA_BREACH_DRIVER
];

// Quick lookup: give an event type, get every rule that matches.
public function rulesForEvent(string eventType) returns SubscriptionRule[] {
    SubscriptionRule[] matches = [];
    foreach SubscriptionRule rule in SUBSCRIPTION_MATRIX {
        if rule.eventType == eventType {
            matches.push(rule);
        }
    }
    return matches;
}
