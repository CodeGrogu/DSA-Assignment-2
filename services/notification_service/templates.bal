// Renders a message body for a given template and event payload.
// For now we just return a generic sentence per template.
public function renderBody(string template, json data) returns string {
    match template {
        "order_created_customer" => {
            return "We received your order. Hang tight!";
        }
        "order_confirmed_customer" => {
            return "Your order has been confirmed.";
        }
        "order_ready_customer" => {
            return "Your food is ready and waiting for pickup.";
        }
        "pickup_ready_driver" => {
            return "A pickup is ready for you at the restaurant.";
        }
        "payment_receipt_customer" => {
            return "Payment received. Thanks!";
        }
        "payment_failed_customer" => {
            return "Your payment didn't go through. Please try again.";
        }
        "driver_assigned_customer" => {
            return "A driver is on the way to pick up your order.";
        }
        "delivered_customer" => {
            return "Your order has been delivered. Enjoy!";
        }
        "sla_breach_customer" => {
            return "We're sorry — your order is running late.";
        }
        "sla_breach_driver" => {
            return "You've exceeded the SLA on this delivery. Please update status.";
        }
        _ => {
            return "You have a new update on your order.";
        }
    }
}

// Very simple subject lines to go with the body.
public function renderSubject(string template) returns string {
    match template {
        "order_created_customer" => {
            return "Order received";
        }
        "order_confirmed_customer" => {
            return "Order confirmed";
        }
        "order_ready_customer" => {
            return "Order ready";
        }
        "pickup_ready_driver" => {
            return "New pickup";
        }
        "payment_receipt_customer" => {
            return "Payment receipt";
        }
        "payment_failed_customer" => {
            return "Payment failed";
        }
        "driver_assigned_customer" => {
            return "Driver assigned";
        }
        "delivered_customer" => {
            return "Delivered";
        }
        "sla_breach_customer" => {
            return "Order delay";
        }
        "sla_breach_driver" => {
            return "SLA breach";
        }
        _ => {
            return "Order update";
        }
    }
}
