import ballerinax/mongodb;

configurable string mongodbConnection = "mongodb://localhost:27017";

mongodb:ConnectionConfig mongoConfig = {
    connection: mongodbConnection
};

mongodb:Client mongoClient = checkpanic new (mongoConfig);

public function getCustomerCollection() returns mongodb:Collection|error {
    mongodb:Database database = check mongoClient->getDatabase("customer_db");
    mongodb:Collection collection = check database->getCollection("customers");

    return collection;
}

public function insertCustomer(Customer customer) returns error? {
    mongodb:Collection collection = check getCustomerCollection();

    _ = check collection->insertOne(customer);

    return;
}

public function getCustomerById(string id) returns Customer|error {
    mongodb:Collection collection = check getCustomerCollection();

    record {}? result = check collection->findOne({id: id});

    if result is () {
        return error("Customer not found");
    }

    _ = result.remove("_id");

    return <Customer>result;
}

public function updateCustomerAddress(string customerId, CustomerAddress address) returns error? {
    mongodb:Collection collection = check getCustomerCollection();

    mongodb:Update update = {
        "$push": {
            "addresses": address
        }
    };

    mongodb:UpdateResult result = check collection->updateOne(
        {id: customerId},
        update
    );

    if result.matchedCount == 0 {
        return error("Customer not found");
    }

    return;
}
