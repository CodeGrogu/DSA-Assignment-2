import ballerina/log;
import ballerinax/mongodb;

import peerpressure/events as events;

configurable boolean enableMongo = true;
configurable string mongoUri = "mongodb://root:password@localhost:27017/order_db?authSource=admin";
configurable string mongoDatabase = "order_db";

# Persistent data access layer for Order records.
# Automatically synchronizes with MongoDB while providing in-memory fallback for test isolation.
public class OrderStore {
    private final map<Order> inMemoryStore = {};
    private mongodb:Client? clientInstance = ();
    private mongodb:Collection? collectionInstance = ();
    private boolean isConnected = false;

    public function init() {
        if enableMongo {
            mongodb:Client|error mongoClient = new ({connection: mongoUri});
            if mongoClient is mongodb:Client {
                mongodb:Database|error db = mongoClient->getDatabase(mongoDatabase);
                if db is mongodb:Database {
                    mongodb:Collection|error coll = db->getCollection("orders");
                    if coll is mongodb:Collection {
                        self.clientInstance = mongoClient;
                        self.collectionInstance = coll;
                        self.isConnected = true;
                        log:printInfo("OrderStore successfully initialized with MongoDB");
                        return;
                    }
                }
            }
        }
        log:printWarn("OrderStore operating in resilient in-memory mode");
    }

    # Inserts or updates an order document.
    public function save(Order 'order) returns error? {
        lock {
            self.inMemoryStore['order.orderId] = 'order.clone();
        }
        if self.isConnected {
            mongodb:Collection? coll = self.collectionInstance;
            if coll is mongodb:Collection {
                check coll->insertOne('order);
            }
        }
    }

    # Retrieves an order by its unique identifier.
    public function get(string orderId) returns Order?|error {
        lock {
            if self.inMemoryStore.hasKey(orderId) {
                return self.inMemoryStore.get(orderId).clone();
            }
        }
        if self.isConnected {
            mongodb:Collection? coll = self.collectionInstance;
            if coll is mongodb:Collection {
                Order? found = check coll->findOne({orderId: orderId}, targetType = Order);
                if found is Order {
                    lock {
                        self.inMemoryStore[orderId] = found.clone();
                    }
                    return found;
                }
            }
        }
        return ();
    }

    # Updates the lifecycle status of an existing order with atomic FSM transition verification.
    public function updateStatus(string orderId, events:OrderStatus newStatus, string? paymentId = (), string? reason = ()) returns Order|error {
        Order? existing = ();
        lock {
            if self.inMemoryStore.hasKey(orderId) {
                existing = self.inMemoryStore.get(orderId).clone();
            }
        }
        if existing is () && self.isConnected {
            mongodb:Collection? coll = self.collectionInstance;
            if coll is mongodb:Collection {
                existing = check coll->findOne({orderId: orderId}, targetType = Order);
            }
        }

        if existing is () {
            return error(string `Order ${orderId} not found`);
        }

        // Enforce FSM transitions at the storage layer
        StateTransitionResult transitionCheck = validateTransition(existing.status, newStatus);
        if !transitionCheck.allowed {
            return error(transitionCheck.rejectionReason ?: string `Illegal transition from ${existing.status} to ${newStatus}`);
        }

        // Enforce cancellation guard at the storage layer
        if newStatus == events:CANCELLED && !isCancellable(existing.status) {
            return error(string `Order cannot be cancelled in state '${existing.status}'`);
        }

        Order updated = existing;
        updated.status = newStatus;
        updated.updatedAt = currentTimestamp();
        if paymentId is string {
            updated.paymentId = paymentId;
        }
        if reason is string {
            updated.cancellationReason = reason;
        }

        lock {
            self.inMemoryStore[orderId] = updated.clone();
        }

        if self.isConnected {
            mongodb:Collection? coll = self.collectionInstance;
            if coll is mongodb:Collection {
                _ = check coll->updateOne(
                    {orderId: orderId},
                    {
                        "$set": {
                            "status": newStatus,
                            "paymentId": updated.paymentId,
                            "cancellationReason": updated.cancellationReason,
                            "updatedAt": updated.updatedAt
                        }
                    }
                );
            }
        }

        return updated;
    }

    # Returns the count of active unfulfilled orders (not in terminal states DELIVERED or CANCELLED).
    public function getUnfulfilledOrderCount() returns int {
        int count = 0;
        lock {
            foreach Order ord in self.inMemoryStore {
                if ord.status != events:DELIVERED && ord.status != events:CANCELLED {
                    count += 1;
                }
            }
        }
        return count;
    }

    # Clears local in-memory records (useful for test resets).
    public function clearMemory() {
        lock {
            self.inMemoryStore.removeAll();
        }
    }
}

# Global singleton order store instance.
public final OrderStore orderStore = new;
