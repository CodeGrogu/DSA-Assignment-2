import ballerina/http;
import ballerina/time;
import ballerina/uuid;
import peerpressure/events as events;
import peerpressure/metrics as metrics;

configurable int port = 9091;
configurable decimal baseDeliveryFee = 0.0;
configurable decimal defaultSurgeMultiplier = 1.0;

service / on new http:Listener(port) {

    # Health check liveness and readiness probe.
    resource function get health() returns json {
        time:Utc startTime = time:utcNow();
        json response = {
            status: "UP",
            "service": "order_service",
            port: port,
            version: "0.1.0",
            contracts: "peerpressure/events:0.1.0"
        };
        time:Utc endTime = time:utcNow();
        decimal durationMs = time:utcDiffSeconds(endTime, startTime) * 1000d;
        metrics:recordHttpRequest("GET", "/health", 200, durationMs, "order_service");
        return response;
    }

    # Prometheus metrics scraping endpoint.
    resource function get metrics() returns http:Response {
        return metrics:getMetricsResponse();
    }

    # Creates a new customer order with validated items and delivery location.
    resource function post orders(@http:Payload CreateOrderRequest payload) returns http:Created|http:BadRequest|http:InternalServerError {
        time:Utc startTime = time:utcNow();

        string? validationErr = validateCreateOrderRequest(payload);
        if validationErr is string {
            ErrorResponse errResp = {
                'error: "BadRequest",
                message: validationErr,
                timestamp: currentTimestamp()
            };
            return <http:BadRequest>{body: errResp};
        }

        decimal itemsTotal = 0.0d;
        foreach CreateOrderItem item in payload.items {
            itemsTotal = itemsTotal + (item.price * <decimal>item.quantity);
        }

        decimal deliveryFee = baseDeliveryFee;
        decimal surgeMultiplier = defaultSurgeMultiplier;
        // Total amount strictly equals sum of item subtotals per peerpressure/events contract specification
        decimal totalAmount = itemsTotal;

        string generatedId = string `ord_${time:utcNow()[0]}_${uuid:createType4AsString()}`;
        string now = currentTimestamp();

        Order newOrder = {
            orderId: generatedId,
            customerId: payload.customerId,
            restaurantId: payload.restaurantId,
            status: events:CREATED,
            items: payload.items,
            itemsTotal: itemsTotal,
            deliveryFee: deliveryFee,
            surgeMultiplier: surgeMultiplier,
            totalAmount: totalAmount,
            deliveryAddress: payload.deliveryAddress,
            paymentId: (),
            cancellationReason: (),
            createdAt: now,
            updatedAt: now
        };

        error? saveResult = orderStore.save(newOrder);
        if saveResult is error {
            ErrorResponse errResp = {
                'error: "InternalServerError",
                message: "Failed to persist order",
                timestamp: now
            };
            return <http:InternalServerError>{body: errResp};
        }

        time:Utc endTime = time:utcNow();
        decimal durationMs = time:utcDiffSeconds(endTime, startTime) * 1000d;
        metrics:recordHttpRequest("POST", "/orders", 201, durationMs, "order_service");

        return <http:Created>{body: newOrder};
    }

    # Retrieves order status and details by order ID.
    resource function get orders/[string orderId]() returns http:Ok|http:NotFound|http:InternalServerError {
        time:Utc startTime = time:utcNow();

        Order?|error orderResult = orderStore.get(orderId);
        if orderResult is error {
            ErrorResponse errResp = {
                'error: "InternalServerError",
                message: "Failed to query order",
                timestamp: currentTimestamp()
            };
            return <http:InternalServerError>{body: errResp};
        }

        if orderResult is () {
            ErrorResponse errResp = {
                'error: "NotFound",
                message: string `Order ${orderId} does not exist`,
                timestamp: currentTimestamp()
            };
            return <http:NotFound>{body: errResp};
        }

        time:Utc endTime = time:utcNow();
        decimal durationMs = time:utcDiffSeconds(endTime, startTime) * 1000d;
        metrics:recordHttpRequest("GET", string `/orders/${orderId}`, 200, durationMs, "order_service");

        return <http:Ok>{body: orderResult};
    }

    # Cancels an active order, subject to state machine transition guards.
    # Rejects cancellation with HTTP 409 Conflict if kitchen preparation has already started.
    resource function post orders/[string orderId]/cancel() returns http:Ok|http:NotFound|http:Conflict|http:InternalServerError {
        time:Utc startTime = time:utcNow();

        Order?|error orderResult = orderStore.get(orderId);
        if orderResult is error {
            ErrorResponse errResp = {
                'error: "InternalServerError",
                message: "Failed to retrieve order for cancellation",
                timestamp: currentTimestamp()
            };
            return <http:InternalServerError>{body: errResp};
        }

        if orderResult is () {
            ErrorResponse errResp = {
                'error: "NotFound",
                message: string `Order ${orderId} not found`,
                timestamp: currentTimestamp()
            };
            return <http:NotFound>{body: errResp};
        }

        Order 'order = orderResult;

        if !isCancellable('order.status) {
            ErrorResponse errResp = {
                'error: "Conflict",
                message: string `Order cannot be cancelled in state '${'order.status}'. Cancellation is disallowed once food preparation has started.`,
                timestamp: currentTimestamp()
            };
            return <http:Conflict>{body: errResp};
        }

        StateTransitionResult transitionCheck = validateTransition('order.status, events:CANCELLED);
        if !transitionCheck.allowed {
            ErrorResponse errResp = {
                'error: "Conflict",
                message: transitionCheck.rejectionReason ?: "Illegal transition to CANCELLED",
                timestamp: currentTimestamp()
            };
            return <http:Conflict>{body: errResp};
        }

        Order|error updated = orderStore.updateStatus(orderId, events:CANCELLED, (), "Customer requested cancellation");
        if updated is error {
            ErrorResponse errResp = {
                'error: "Conflict",
                message: updated.message(),
                timestamp: currentTimestamp()
            };
            return <http:Conflict>{body: errResp};
        }

        CancelOrderResponse cancelResponse = {
            orderId: orderId,
            status: events:CANCELLED,
            message: "Order has been successfully cancelled",
            cancelledAt: currentTimestamp()
        };

        time:Utc endTime = time:utcNow();
        decimal durationMs = time:utcDiffSeconds(endTime, startTime) * 1000d;
        metrics:recordHttpRequest("POST", string `/orders/${orderId}/cancel`, 200, durationMs, "order_service");

        return <http:Ok>{body: cancelResponse};
    }
}
