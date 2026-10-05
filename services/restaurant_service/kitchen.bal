import ballerina/lang.runtime as runtime;
import ballerina/log;
import ballerina/os;
import ballerina/time;
import ballerina/uuid;
import ballerinax/kafka;

import peerpressure/events as events;

configurable string kafkaBootstrapServers = "kafka:9092";
configurable decimal kitchenCookingDurationSeconds = 30.0d;

isolated function getEffectiveKitchenKafkaServers() returns string {
    string envBroker = os:getEnv("KAFKA_BROKER");
    if envBroker.trim() != "" {
        return envBroker.trim();
    }
    string envServers = os:getEnv("KAFKA_BOOTSTRAP_SERVERS");
    if envServers.trim() != "" {
        return envServers.trim();
    }
    return kafkaBootstrapServers;
}

final string ordersConfirmedTopic = "orders.confirmed";
final string kitchenReadyTopic = "kitchen.orders.ready";

listener kafka:Listener kitchenListener = new (getEffectiveKitchenKafkaServers(), {
    groupId: "restaurant-kitchen-service",
    topics: [ordersConfirmedTopic],
    offsetReset: kafka:OFFSET_RESET_EARLIEST,
    autoCommit: false
});

final kafka:Producer kitchenProducer = check new (getEffectiveKitchenKafkaServers(), {
    acks: kafka:ACKS_ALL,
    enableIdempotence: true
});

service on kitchenListener {
    remote function onConsumerRecord(kafka:Caller caller, kafka:BytesConsumerRecord[] records) returns error? {
        foreach kafka:BytesConsumerRecord consumerRecord in records {
            do {
                string payloadText = check string:fromBytes(consumerRecord.value);
                json payload = check payloadText.fromJsonString();
                events:OrderConfirmedEvent confirmedOrder = check events:validateOrderConfirmed(payload);
                error? prepErr = startKitchenPreparation(confirmedOrder);
                if prepErr is error {
                    log:printWarn("Kitchen rejected confirmed order; publishing kitchen.rejected", orderId = confirmedOrder.orderId, 'error = prepErr);
                    events:KitchenRejectedEvent rejectionEvt = {
                        eventId: uuid:createType1AsString(),
                        orderId: confirmedOrder.orderId,
                        customerId: confirmedOrder.customerId,
                        restaurantId: confirmedOrder.restaurantId,
                        reason: prepErr.message(),
                        rejectedAt: time:utcToString(time:utcNow())
                    };
                    _ = check kitchenProducer->send({
                        topic: "kitchen.rejected",
                        key: confirmedOrder.orderId.toBytes(),
                        value: events:kitchenRejectedToJson(rejectionEvt).toJsonString().toBytes()
                    });
                }
            } on fail error err {
                log:printError("Failed processing kitchen order record; skipping poison pill", err);
            }
        }
        check caller->commit();
    }
}

function startKitchenPreparation(events:OrderConfirmedEvent confirmedOrder) returns error? {
    string? validationError = validateConfirmedKitchenOrder(confirmedOrder);
    if validationError is string {
        return error(validationError);
    }

    Restaurant? restaurantResult = check findRestaurant(confirmedOrder.restaurantId);
    if restaurantResult is () {
        return error("Restaurant not found for confirmed order");
    }
    Restaurant restaurant = restaurantResult;

    [string, int][] decrementedItems = [];
    foreach events:OrderItem item in confirmedOrder.items {
        if item.quantity <= 0 {
            rollbackReservedStock(confirmedOrder.restaurantId, decrementedItems);
            return error("Confirmed order item quantity must be positive");
        }
        boolean stockDecremented = check decrementMenuItemStock(
                confirmedOrder.restaurantId, item.itemId, item.quantity);
        if !stockDecremented {
            rollbackReservedStock(confirmedOrder.restaurantId, decrementedItems);
            return error("Insufficient stock for menu item " + item.itemId);
        }
        decrementedItems.push([item.itemId, item.quantity]);
    }

    events:OrderPreparingEvent preparingEvent = {
        eventId: uuid:createType1AsString(),
        orderId: confirmedOrder.orderId,
        customerId: confirmedOrder.customerId,
        restaurantId: confirmedOrder.restaurantId,
        preparingStartedAt: time:utcToString(time:utcNow())
    };
    check kitchenProducer->send({
        topic: "orders.preparing",
        key: confirmedOrder.orderId.toBytes(),
        value: events:orderPreparingToJson(preparingEvent).toJsonString().toBytes()
    });

    _ = start runKitchenPreparationJob(confirmedOrder, restaurant.address);
}

isolated function validateConfirmedKitchenOrder(events:OrderConfirmedEvent confirmedOrder) returns string? {
    if confirmedOrder.orderId.trim().length() == 0 || confirmedOrder.restaurantId.trim().length() == 0 {
        return "Confirmed order and restaurant IDs are required";
    }
    if confirmedOrder.items.length() == 0 {
        return "Confirmed order has no items";
    }
    foreach events:OrderItem item in confirmedOrder.items {
        if item.itemId.trim().length() == 0 || item.quantity <= 0 {
            return "Confirmed order items require an ID and positive quantity";
        }
    }
    return ();
}

function runKitchenPreparationJob(events:OrderConfirmedEvent confirmedOrder, string pickupAddress) {
    error? completionError = completeKitchenPreparation(confirmedOrder, pickupAddress);
    if completionError is error {
        log:printError("Kitchen preparation failed for order " + confirmedOrder.orderId, completionError);
    }
}

function completeKitchenPreparation(events:OrderConfirmedEvent confirmedOrder, string pickupAddress) returns error? {
    runtime:sleep(kitchenCookingDurationSeconds);

    events:KitchenReadyEvent readyEvent = {
        eventId: uuid:createType1AsString(),
        orderId: confirmedOrder.orderId,
        customerId: confirmedOrder.customerId,
        restaurantId: confirmedOrder.restaurantId,
        pickupAddress,
        pickupReadyAt: time:utcToString(time:utcNow())
    };
    string serializedPayload = events:kitchenOrderReadyToJson(readyEvent).toJsonString();

    check kitchenProducer->send({
        topic: kitchenReadyTopic,
        key: confirmedOrder.orderId.toBytes(),
        value: serializedPayload.toBytes()
    });
}
