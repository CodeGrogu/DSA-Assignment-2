import ballerina/log;
import ballerina/uuid;
import ballerinax/kafka;
import peerpressure/events as events;

configurable string kafkaBootstrapServers = "localhost:9092";
configurable boolean enableKafka = true;
configurable string orderCreatedTopic = "orders.created";
configurable string orderCancelledTopic = "orders.cancelled";

# Producer class responsible for publishing order lifecycle events to Kafka topics.
# Provides graceful degradation and in-memory event recording for offline testing.
public class OrderEventProducer {
    private kafka:Producer? producer = ();
    private final events:OrderCreated[] recordedCreatedEvents = [];
    private final events:OrderCancelled[] recordedCancelledEvents = [];

    public function init() {
        if enableKafka {
            kafka:Producer|error prod = new (kafkaBootstrapServers, {
                clientId: "order-service-producer"
            });
            if prod is kafka:Producer {
                self.producer = prod;
                log:printInfo("OrderEventProducer initialized with Kafka broker", bootstrapServers = kafkaBootstrapServers);
            } else {
                log:printWarn("Kafka broker not reachable at startup; events will be recorded in memory only");
            }
        } else {
            log:printInfo("OrderEventProducer operating in test/in-memory mode (enableKafka=false)");
        }
    }

    # Publishes an OrderCreated event to Kafka topic `orders.created` keyed by orderId.
    public function publishOrderCreated(Order 'order) returns error? {
        events:OrderItem[] eventItems = from CreateOrderItem item in 'order.items
            select {
                itemId: item.itemId,
                itemName: item.name,
                quantity: item.quantity,
                unitPrice: item.price,
                subtotal: item.price * <decimal>item.quantity,
                specialInstructions: item.specialInstructions.cloneReadOnly()
            };

        events:OrderCreated event = {
            eventId: uuid:createType4AsString(),
            orderId: 'order.orderId,
            customerId: 'order.customerId,
            restaurantId: 'order.restaurantId,
            items: eventItems.cloneReadOnly(),
            totalAmount: 'order.totalAmount,
            deliveryAddress: 'order.deliveryAddress.cloneReadOnly(),
            status: events:CREATED,
            createdAt: 'order.createdAt
        };

        lock {
            self.recordedCreatedEvents.push(event.cloneReadOnly());
        }

        if enableKafka {
            kafka:Producer? prod = self.producer;
            if prod is () {
                kafka:Producer|error newProd = new (kafkaBootstrapServers, {
                    clientId: "order-service-producer"
                });
                if newProd is kafka:Producer {
                    self.producer = newProd;
                    prod = newProd;
                } else {
                    log:printError("Kafka producer reconnection failed; OrderCreated event recorded in memory only", 'error = newProd);
                    return;
                }
            }

            if prod is kafka:Producer {
                json jsonPayload = event.toJson();
                byte[] valBytes = jsonPayload.toJsonString().toBytes();
                kafka:AnydataProducerRecord rec = {
                    topic: orderCreatedTopic,
                    key: 'order.orderId.toBytes(),
                    value: valBytes
                };
                kafka:Error? sendErr = prod->send(rec);
                if sendErr is kafka:Error {
                    log:printError("Failed to send OrderCreated event to Kafka", 'error = sendErr, topic = orderCreatedTopic, orderId = 'order.orderId);
                } else {
                    log:printInfo("Successfully published OrderCreated event to Kafka", topic = orderCreatedTopic, orderId = 'order.orderId);
                }
            }
        }
    }

    # Publishes an OrderCancelled event to Kafka topic `orders.cancelled` keyed by orderId.
    public function publishOrderCancelled(string orderId, string reason, string cancelledBy, string cancelledAt) returns error? {
        events:OrderCancelled event = {
            eventId: uuid:createType4AsString(),
            orderId: orderId,
            reason: reason,
            cancelledBy: cancelledBy,
            cancelledAt: cancelledAt
        };

        lock {
            self.recordedCancelledEvents.push(event.cloneReadOnly());
        }

        if enableKafka {
            kafka:Producer? prod = self.producer;
            if prod is () {
                kafka:Producer|error newProd = new (kafkaBootstrapServers, {
                    clientId: "order-service-producer"
                });
                if newProd is kafka:Producer {
                    self.producer = newProd;
                    prod = newProd;
                } else {
                    log:printError("Kafka producer reconnection failed; OrderCancelled event recorded in memory only", 'error = newProd);
                    return;
                }
            }

            if prod is kafka:Producer {
                json jsonPayload = event.toJson();
                byte[] valBytes = jsonPayload.toJsonString().toBytes();
                kafka:AnydataProducerRecord rec = {
                    topic: orderCancelledTopic,
                    key: orderId.toBytes(),
                    value: valBytes
                };
                kafka:Error? sendErr = prod->send(rec);
                if sendErr is kafka:Error {
                    log:printError("Failed to send OrderCancelled event to Kafka", 'error = sendErr, topic = orderCancelledTopic, orderId = orderId);
                } else {
                    log:printInfo("Successfully published OrderCancelled event to Kafka", topic = orderCancelledTopic, orderId = orderId);
                }
            }
        }
    }

    # Retrieves recorded OrderCreated events for verification and testing.
    public function getRecordedCreatedEvents() returns events:OrderCreated[] {
        lock {
            return self.recordedCreatedEvents.clone();
        }
    }

    # Retrieves recorded OrderCancelled events for verification and testing.
    public function getRecordedCancelledEvents() returns events:OrderCancelled[] {
        lock {
            return self.recordedCancelledEvents.clone();
        }
    }

    # Clears recorded in-memory events.
    public function clearRecordedEvents() {
        lock {
            self.recordedCreatedEvents.removeAll();
            self.recordedCancelledEvents.removeAll();
        }
    }
}

# Global singleton order event producer instance.
public final OrderEventProducer orderEventProducer = new;

# Helper function to publish OrderCreated via the singleton producer.
public function publishOrderCreated(Order 'order) returns error? {
    return orderEventProducer.publishOrderCreated('order);
}

# Helper function to publish OrderCancelled via the singleton producer.
public function publishOrderCancelled(string orderId, string reason, string cancelledBy, string cancelledAt) returns error? {
    return orderEventProducer.publishOrderCancelled(orderId, reason, cancelledBy, cancelledAt);
}
