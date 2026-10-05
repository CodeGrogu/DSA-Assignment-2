// Renders a message body for a given template and event payload, interpolating order/payment/driver details when present.
public function renderBody(string template, json data) returns string {
    string orderId = extractField(data, "orderId");
    string driverName = extractField(data, "driverName");
    string reason = extractField(data, "reason");
    string suffix = orderId != "" ? string ` (Order #${orderId})` : "";

    match template {
        "order_created_customer" => {
            return string `We received your order${suffix}. Hang tight!`;
        }
        "order_confirmed_customer" => {
            return string `Your order${suffix} has been confirmed.`;
        }
        "order_ready_customer" => {
            return string `Your food${suffix} is ready and waiting for pickup.`;
        }
        "pickup_ready_driver" => {
            return string `A pickup${suffix} is ready for you at the restaurant.`;
        }
        "payment_receipt_customer" => {
            return string `Payment received${suffix}. Thanks!`;
        }
        "payment_failed_customer" => {
            string detail = reason != "" ? string `: ${reason}` : "";
            return string `Your payment${suffix} didn't go through${detail}. Please try again.`;
        }
        "driver_assigned_customer" => {
            string who = driverName != "" ? string `Driver ${driverName}` : "A driver";
            return string `${who} is on the way to pick up your order${suffix}.`;
        }
        "delivered_customer" => {
            return string `Your order${suffix} has been delivered. Enjoy!`;
        }
        "sla_breach_customer" => {
            return string `We're sorry — your order${suffix} is running late.`;
        }
        "sla_breach_driver" => {
            return string `You've exceeded the SLA on this delivery${suffix}. Please update status.`;
        }
        _ => {
            return string `You have a new update on your order${suffix}.`;
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
