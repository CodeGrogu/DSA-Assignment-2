import ballerinax/mongodb;

configurable string mongodbConnection =
    "mongodb://root:password@localhost:27017/customer_db?authSource=admin";

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

    var result = collection->insertOne(customer);

    if result is error {
        string errorMessage = result.toString();

        if errorMessage.includes("11000") ||
            errorMessage.includes("duplicate key") {
            return error DuplicateEmailError("Customer email already exists");
        }

        return error DatabaseOperationError("Failed to insert customer");
    }

    return;
}

public function getCustomerById(string id) returns Customer|error {
    mongodb:Collection collection = check getCustomerCollection();

    record {}? result = check collection->findOne({id: id});

    if result is () {
        return error CustomerNotFoundError("Customer not found");
    }

    Customer customer = check result.cloneWithType(Customer);
    return customer;
}

public function updateCustomerAddress(
        string customerId,
        CustomerAddress address
) returns error? {
    mongodb:Collection collection = check getCustomerCollection();

    mongodb:Update update = {
        "push": {
            "addresses": address
        }
    };

    mongodb:UpdateResult result = check collection->updateOne(
        {id: customerId},
        update
    );

    if result.matchedCount == 0 {
        return error CustomerNotFoundError("Customer not found");
    }

    return;
}
