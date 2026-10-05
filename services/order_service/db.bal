import ballerina/log;
import ballerina/os;
import ballerinax/mongodb;

import peerpressure/events as events;

configurable boolean enableMongo = true;
configurable string mongoUri = "mongodb://order_user:order_password@mongodb:27017/order_db?authSource=order_db&replicaSet=rs0";
configurable string mongoDatabase = "order_db";

isolated function getEffectiveMongoUri() returns string {
    string envUri = os:getEnv("MONGO_URI");
    if envUri != "" {
        return envUri;
    }
    return mongoUri;
}

# Persistent data access layer for Order records.
# Automatically synchronizes with MongoDB while providing in-memory fallback for test isolation.
public class OrderStore {
    private final map<Order> inMemoryStore = {};
    private mongodb:Client? clientInstance = ();
    private mongodb:Collection? collectionInstance = ();
    private boolean isConnected = false;

    public function init() {
        if enableMongo {
            string effectiveUri = getEffectiveMongoUri();
            mongodb:Client|error mongoClient = new ({connection: effectiveUri});
            if mongoClient is mongodb:Client {
                mongodb:Database|error db = mongoClient->getDatabase(mongoDatabase);
                if db is mongodb:Database {
                    mongodb:Collection|error coll = db->getCollection("orders");
                    if coll is mongodb:Collection {
                        self.clientInstance = mongoClient;
                        self.collectionInstance = coll;
                        self.isConnected = true;
                        log:printInfo("OrderStore successfully initialized with MongoDB", uri = effectiveUri);
                        return;
                    }
                }
            }
        }
        log:printWarn("OrderStore operating in resilient in-memory mode");
    }

    # Inserts or updates an order document.
    public function save(Order 'order) returns error? {
        Order cloned = 'order.clone();
        lock {
            self.inMemoryStore[cloned.orderId] = cloned;
        }
        if self.isConnected {
            mongodb:Collection? coll = self.collectionInstance;
            if coll is mongodb:Collection {
                _ = start persistOrderInsertAsync(coll, cloned);
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
                Order?|error found = coll->findOne({orderId: orderId}, targetType = Order);
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

    # Retrieves all orders in the store.
    public function listAll() returns Order[] {
        Order[] orders = [];
        lock {
            foreach Order ord in self.inMemoryStore {
                orders.push(ord.clone());
            }
        }
        return orders;
    }

    # Retrieves paginated orders for a specific customer.
    public function getByCustomer(string customerId, int resultLimit = 10, int offset = 0) returns Order[] {
        Order[] allOrders = self.listAll();
        Order[] matching = [];
        foreach Order ord in allOrders {
            if ord.customerId == customerId {
                matching.push(ord);
            }
        }
        int startIdx = offset < 0 ? 0 : offset;
        int maxCount = resultLimit <= 0 ? 10 : resultLimit;
        Order[] paged = [];
        int idx = startIdx;
        while idx < matching.length() && paged.length() < maxCount {
            paged.push(matching[idx]);
            idx += 1;
        }
        return paged;
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
                Order?|error dbFound = coll->findOne({orderId: orderId}, targetType = Order);
                if dbFound is Order {
                    existing = dbFound;
                }
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
                _ = start persistOrderUpdateAsync(coll, orderId, newStatus, updated.paymentId, updated.cancellationReason, updated.updatedAt);
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

function persistOrderInsertAsync(mongodb:Collection coll, Order 'order) {
    error? insertResult = coll->insertOne('order);
    if insertResult is error {
        log:printWarn("Failed to insert order into MongoDB, preserved in memory", 'error = insertResult);
    }
}

function persistOrderUpdateAsync(mongodb:Collection coll, string orderId, events:OrderStatus newStatus, string? paymentId, string? cancellationReason, string updatedAt) {
    mongodb:Update update = {
        "set": {
            "status": newStatus,
            "paymentId": paymentId,
            "cancellationReason": cancellationReason,
            "updatedAt": updatedAt
        }
    };
    mongodb:UpdateResult|error updateRes = coll->updateOne({orderId: orderId}, update);
    if updateRes is error {
        log:printWarn("Failed to update order status in MongoDB, updated in memory", 'error = updateRes);
    }
}

# Global singleton order store instance.
public final OrderStore orderStore = new;
