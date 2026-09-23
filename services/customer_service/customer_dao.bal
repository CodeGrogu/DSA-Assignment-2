import ballerinax/mongodb;

public function getCustomerCollection() returns mongodb:Collection|error {
    mongodb:ConnectionConfig config = {
        connection: "mongodb://localhost:27017"
    };

    mongodb:Client mongoClient = check new (config);
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

    return <Customer>result;
}

public function updateCustomerAddress(string customerId, CustomerAddress address) returns error? {
    mongodb:Collection collection = check getCustomerCollection();

    mongodb:Update update = {
        "$push": {
            "addresses": address
        }
    };

    _ = check collection->updateOne(
        {id: customerId},
        update
    );

    return;
}
