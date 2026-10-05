import ballerina/http;
import ballerina/log;
import ballerina/time;
import ballerina/uuid;
import peerpressure/events as events;
import peerpressure/metrics as metrics;

configurable int port = 9091;

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

    # Dynamic surge pricing quote endpoint for specified supply and demand parameters.
    resource function get pricing/quote(int unfulfilledOrders, int availableDrivers) returns PricingQuote|http:BadRequest {
        time:Utc startTime = time:utcNow();

        if unfulfilledOrders < 0 || availableDrivers < 0 {
            ErrorResponse errResp = {
                'error: "BadRequest",
                message: "unfulfilledOrders and availableDrivers must be non-negative integers",
                timestamp: currentTimestamp()
            };
            time:Utc endTime = time:utcNow();
            decimal durationMs = time:utcDiffSeconds(endTime, startTime) * 1000d;
            metrics:recordHttpRequest("GET", "/pricing/quote", 400, durationMs, "order_service");
            return <http:BadRequest>{body: errResp};
        }

        PricingQuote quote = pricingEngine.getQuote(unfulfilledOrders, availableDrivers);

        time:Utc endTime = time:utcNow();
        decimal durationMs = time:utcDiffSeconds(endTime, startTime) * 1000d;
        metrics:recordHttpRequest("GET", "/pricing/quote", 200, durationMs, "order_service");

        return quote;
    }

    # Retrieves real-time platform dynamic surge pricing quote for current supply and demand.
    resource function get pricing/current() returns PricingQuote {
        time:Utc startTime = time:utcNow();

        // Refresh unfulfilled orders count from orderStore if store demand exceeds tracked count
        int storeOrders = orderStore.getUnfulfilledOrderCount();
        if storeOrders > pricingEngine.getUnfulfilledOrders() {
            pricingEngine.setSupplyDemand(storeOrders, pricingEngine.getAvailableDrivers());
        }

        PricingQuote quote = pricingEngine.getCurrentQuote();

        time:Utc endTime = time:utcNow();
        decimal durationMs = time:utcDiffSeconds(endTime, startTime) * 1000d;
        metrics:recordHttpRequest("GET", "/pricing/current", 200, durationMs, "order_service");

        return quote;
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

        // Dynamically evaluate quote using live store state
        int activeUnfulfilled = orderStore.getUnfulfilledOrderCount();
        if activeUnfulfilled > pricingEngine.getUnfulfilledOrders() {
            pricingEngine.setSupplyDemand(activeUnfulfilled, pricingEngine.getAvailableDrivers());
        }

        PricingQuote quote = pricingEngine.getCurrentQuote();
        decimal deliveryFee = quote.deliveryFee;
        decimal surgeMultiplier = quote.surgeMultiplier;
        decimal totalAmount = itemsTotal + deliveryFee;

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

        // Dynamically update pricing engine state with live store metrics
        pricingEngine.setSupplyDemand(orderStore.getUnfulfilledOrderCount(), pricingEngine.getAvailableDrivers());

        error? pubErr = orderEventProducer.publishOrderCreated(newOrder);
        if pubErr is error {
            log:printError("Failed to publish OrderCreated event", 'error = pubErr, orderId = newOrder.orderId);
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
    resource function post orders/[string orderId]/cancel(@http:Payload CancelOrderRequest? req = ()) returns http:Ok|http:NotFound|http:Conflict|http:InternalServerError {
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

        string reason = (req is CancelOrderRequest && req.reason.trim().length() > 0) ? req.reason : "Customer requested cancellation";
        Order|error updated = orderStore.updateStatus(orderId, events:CANCELLED, (), reason);
        if updated is error {
            ErrorResponse errResp = {
                'error: "Conflict",
                message: updated.message(),
                timestamp: currentTimestamp()
            };
            return <http:Conflict>{body: errResp};
        }

        // Dynamically update pricing engine state with live store metrics upon cancellation
        pricingEngine.setSupplyDemand(orderStore.getUnfulfilledOrderCount(), pricingEngine.getAvailableDrivers());

        string cancelledAt = currentTimestamp();
        error? pubErr = orderEventProducer.publishOrderCancelled(orderId, reason, "CUSTOMER", cancelledAt);
        if pubErr is error {
            log:printError("Failed to publish OrderCancelled event", 'error = pubErr, orderId = orderId);
        }

        CancelOrderResponse cancelResponse = {
            orderId: orderId,
            status: events:CANCELLED,
            message: "Order has been successfully cancelled",
            cancelledAt: cancelledAt
        };

        time:Utc endTime = time:utcNow();
        decimal durationMs = time:utcDiffSeconds(endTime, startTime) * 1000d;
        metrics:recordHttpRequest("POST", string `/orders/${orderId}/cancel`, 200, durationMs, "order_service");

        return <http:Ok>{body: cancelResponse};
    }
}
