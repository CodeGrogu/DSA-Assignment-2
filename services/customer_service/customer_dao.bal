import ballerina/log;
import ballerinax/mongodb;

configurable string mongoHost = "mongodb";
configurable int mongoPort = 27017;
configurable string mongoUser = "customer_user";
configurable string mongoPassword = "customer_password";
configurable string databaseName = "customer_db";
configurable string mongoAuthSource = "customer_db";
configurable string mongoReplicaSet = "rs0";
configurable int mongoServerSelectionTimeoutMs = 2000;

final string mongoConnectionString = string `mongodb://${mongoUser}:${mongoPassword}@${mongoHost}:${mongoPort}/${databaseName}?authSource=${mongoAuthSource}&replicaSet=${mongoReplicaSet}&serverSelectionTimeoutMS=${mongoServerSelectionTimeoutMs}`;

isolated function getMongoClient() returns mongodb:Client|error {
    do {
        return check new ({connection: mongoConnectionString});
    } on fail error err {
        log:printError("Failed to initialize MongoDB client: " + err.message(), err);
        return err;
    }
}

public isolated function getCustomerCollection() returns mongodb:Collection|error {
    do {
        mongodb:Client mongoClient = check getMongoClient();
        mongodb:Database database = check mongoClient->getDatabase(databaseName);
        return check database->getCollection("customers");
    } on fail error err {
        log:printError("Failed to access customer collection: " + err.message(), err);
        return err;
    }
}

public isolated function insertCustomer(Customer customer) returns error? {
    mongodb:Collection|error collection = getCustomerCollection();
    if collection is error {
        return error DatabaseOperationError("Failed to access collection: " + collection.message());
    }

    var result = collection->insertOne(customer);

    if result is error {
        string errorMessage = result.toString();

        if errorMessage.includes("11000") ||
            errorMessage.includes("duplicate key") {
            return error DuplicateEmailError("Customer email already exists");
        }

        return error DatabaseOperationError("Failed to insert customer: " + result.message());
    }

    return;
}

public isolated function getCustomerById(string id) returns Customer|error {
    mongodb:Collection|error collection = getCustomerCollection();
    if collection is error {
        return error DatabaseOperationError("Failed to access collection: " + collection.message());
    }

    record {}|error? result = collection->findOne({id: id});
    if result is error {
        return error DatabaseOperationError("Failed to query customer: " + result.message());
    }

    if result is () {
        return error CustomerNotFoundError("Customer not found");
    }

    Customer|error customer = result.cloneWithType(Customer);
    if customer is error {
        return error DatabaseOperationError("Failed to map customer document: " + customer.message());
    }
    return customer;
}

public isolated function updateCustomerAddress(
        string customerId,
        CustomerAddress address
) returns error? {
    mongodb:Collection|error collection = getCustomerCollection();
    if collection is error {
        return error DatabaseOperationError("Failed to access collection: " + collection.message());
    }

    json|error addressJson = address.cloneWithType(json);
    if addressJson is error {
        return error DatabaseOperationError("Failed to serialize address: " + addressJson.message());
    }

    mongodb:Update update = {
        "push": {
            "addresses": addressJson
        }
    };

    mongodb:UpdateResult|error result = collection->updateOne(
        {id: customerId},
        update
    );
    if result is error {
        return error DatabaseOperationError("Failed to update customer address: " + result.message());
    }

    if result.matchedCount == 0 {
        return error CustomerNotFoundError("Customer not found");
    }

    return;
}

public isolated function deleteCustomer(string id) returns error? {
    mongodb:Collection|error collection = getCustomerCollection();
    if collection is error {
        return error DatabaseOperationError("Failed to access collection: " + collection.message());
    }

    mongodb:DeleteResult|error result = collection->deleteOne({id: id});
    if result is error {
        return error DatabaseOperationError("Failed to delete customer: " + result.message());
    }

    if result.deletedCount == 0 {
        return error CustomerNotFoundError("Customer not found");
    }

    return;
}
