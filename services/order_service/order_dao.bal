import ballerinax/mongodb;

import peerpressure/events as events;

configurable string mongodbConnection =
    "mongodb://root:password@localhost:27017/order_db?authSource=admin";

mongodb:ConnectionConfig mongoConfig = {
    connection: mongodbConnection
};

mongodb:Client mongoClient = checkpanic new (mongoConfig);

public function getOrderCollection() returns mongodb:Collection|error {
    mongodb:Database database = check mongoClient->getDatabase("order_db");
    mongodb:Collection collection = check database->getCollection("orders");

    return collection;
}

public function insertOrder(events:OrderCreatedEvent orderData) returns error? {
    mongodb:Collection collection = check getOrderCollection();

    var result = collection->insertOne(orderData);

    if result is error {
        return error("Failed to insert order");
    }

    return;
}

public function getOrdersByCustomer(string customerId)
        returns record {}[]|error {

    mongodb:Collection collection = check getOrderCollection();

    stream<record {}, error?> orders = check collection->find({
        customerId: customerId
    });

    record {}[] result = check from record {} orderRecord in orders
        select orderRecord;

    return result;
}
