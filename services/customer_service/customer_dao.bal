import ballerina/log;
import ballerina/os;
import ballerinax/mongodb;

configurable string mongoUri = "";
configurable string mongoHost = "mongodb";
configurable int mongoPort = 27017;
configurable string mongoUser = "customer_user";
configurable string mongoPassword = "customer_password";
configurable string databaseName = "customer_db";
configurable string mongoAuthSource = "customer_db";
configurable string mongoReplicaSet = "rs0";
configurable int mongoServerSelectionTimeoutMs = 2000;

isolated function resolveMongoConnectionString() returns string {
    string envUri = os:getEnv("MONGO_URI");
    if envUri.trim() != "" {
        return envUri.trim();
    }
    if mongoUri.trim() != "" {
        return mongoUri.trim();
    }
    return string `mongodb://${mongoUser}:${mongoPassword}@${mongoHost}:${mongoPort}/${databaseName}?authSource=${mongoAuthSource}&replicaSet=${mongoReplicaSet}&serverSelectionTimeoutMS=${mongoServerSelectionTimeoutMs}`;
}

isolated mongodb:Client? sharedMongoClient = ();

isolated function getMongoClient() returns mongodb:Client|error {
    lock {
        mongodb:Client? existing = sharedMongoClient;
        if existing is mongodb:Client {
            return existing;
        }
        mongodb:Client|error created = new ({connection: resolveMongoConnectionString()});
        if created is mongodb:Client {
            sharedMongoClient = created;
            return created;
        }
        log:printError("Failed to initialize MongoDB client: " + created.message(), created);
        return created;
    }
}

public isolated function listAllCustomers() returns Customer[]|error {
    mongodb:Collection|error collection = getCustomerCollection();
    if collection is error {
        return error DatabaseOperationError("Failed to access collection: " + collection.message());
    }
    stream<Customer, error?>|error customerStream = collection->find({}, projection = {"_id": 0}, targetType = Customer);
    if customerStream is error {
        return error DatabaseOperationError("Failed to query customers: " + customerStream.message());
    }
    Customer[] customers = [];
    while true {
        record {|Customer value;|}|error? nextItem = customerStream.next();
        if nextItem is () {
            break;
        }
        if nextItem is error {
            return error DatabaseOperationError("Failed to read customer stream: " + nextItem.message());
        }
        customers.push(nextItem.value);
    }
    return customers;
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

    record {}|error? result = collection->findOne({id: id}, projection = {"_id": 0});
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

public isolated function setDefaultAddress(
        string customerId,
        string addressId
) returns error? {
    mongodb:Collection|error collection = getCustomerCollection();
    if collection is error {
        return error DatabaseOperationError("Failed to access collection: " + collection.message());
    }

    Customer|error customerResult = getCustomerById(customerId);
    if customerResult is error {
        if customerResult is CustomerNotFoundError {
            return customerResult;
        }
        if customerResult is DatabaseOperationError {
            return customerResult;
        }
        return error DatabaseOperationError("Failed to query customer: " + customerResult.message());
    }

    boolean addressFound = false;
    foreach CustomerAddress addr in customerResult.addresses {
        if addr.id == addressId {
            addr.isDefault = true;
            addressFound = true;
        } else {
            addr.isDefault = false;
        }
    }

    if !addressFound {
        return error AddressNotFoundError("Address not found");
    }

    json|error addressesJson = customerResult.addresses.cloneWithType(json);
    if addressesJson is error {
        return error DatabaseOperationError("Failed to serialize addresses: " + addressesJson.message());
    }

    mongodb:Update update = {
        "set": {
            "addresses": addressesJson
        }
    };

    mongodb:UpdateResult|error result = collection->updateOne(
        {id: customerId},
        update
    );
    if result is error {
        return error DatabaseOperationError("Failed to update default address: " + result.message());
    }

    if result.matchedCount == 0 {
        return error CustomerNotFoundError("Customer not found");
    }

    return;
}

public isolated function updateCustomerProfile(
        string customerId,
        string name,
        string phone
) returns error? {
    mongodb:Collection|error collection = getCustomerCollection();
    if collection is error {
        return error DatabaseOperationError("Failed to access collection: " + collection.message());
    }

    mongodb:Update update = {
        "set": {
            "name": name,
            "phone": phone
        }
    };

    mongodb:UpdateResult|error result = collection->updateOne(
        {id: customerId},
        update
    );
    if result is error {
        return error DatabaseOperationError("Failed to update customer profile: " + result.message());
    }

    if result.matchedCount == 0 {
        return error CustomerNotFoundError("Customer not found");
    }

    return;
}

public isolated function deleteCustomerAddress(
        string customerId,
        string addressId
) returns error? {
    mongodb:Collection|error collection = getCustomerCollection();
    if collection is error {
        return error DatabaseOperationError("Failed to access collection: " + collection.message());
    }

    Customer|error customerResult = getCustomerById(customerId);
    if customerResult is error {
        if customerResult is CustomerNotFoundError {
            return customerResult;
        }
        if customerResult is DatabaseOperationError {
            return customerResult;
        }
        return error DatabaseOperationError("Failed to query customer: " + customerResult.message());
    }

    CustomerAddress[] remainingAddresses = [];
    boolean addressFound = false;
    boolean wasDefault = false;

    foreach CustomerAddress addr in customerResult.addresses {
        if addr.id == addressId {
            addressFound = true;
            if addr.isDefault {
                wasDefault = true;
            }
        } else {
            remainingAddresses.push(addr);
        }
    }

    if !addressFound {
        return error AddressNotFoundError("Address not found");
    }

    if wasDefault && remainingAddresses.length() > 0 {
        remainingAddresses[0].isDefault = true;
    }

    json|error addressesJson = remainingAddresses.cloneWithType(json);
    if addressesJson is error {
        return error DatabaseOperationError("Failed to serialize addresses: " + addressesJson.message());
    }

    mongodb:Update update = {
        "set": {
            "addresses": addressesJson
        }
    };

    mongodb:UpdateResult|error result = collection->updateOne(
        {id: customerId},
        update
    );
    if result is error {
        return error DatabaseOperationError("Failed to update customer addresses: " + result.message());
    }

    if result.matchedCount == 0 {
        return error CustomerNotFoundError("Customer not found");
    }

    return;
}

public isolated function updateExistingCustomerAddress(
        string customerId,
        string addressId,
        CustomerAddress address
) returns error? {
    mongodb:Collection|error collection = getCustomerCollection();
    if collection is error {
        return error DatabaseOperationError("Failed to access collection: " + collection.message());
    }

    Customer|error customerResult = getCustomerById(customerId);
    if customerResult is error {
        if customerResult is CustomerNotFoundError {
            return customerResult;
        }
        if customerResult is DatabaseOperationError {
            return customerResult;
        }
        return error DatabaseOperationError("Failed to query customer: " + customerResult.message());
    }

    boolean addressFound = false;
    CustomerAddress[] updatedAddresses = [];

    foreach CustomerAddress addr in customerResult.addresses {
        if addr.id == addressId {
            addressFound = true;
            updatedAddresses.push(address);
        } else {
            if address.isDefault {
                addr.isDefault = false;
            }
            updatedAddresses.push(addr);
        }
    }

    if !addressFound {
        return error AddressNotFoundError("Address not found");
    }

    json|error addressesJson = updatedAddresses.cloneWithType(json);
    if addressesJson is error {
        return error DatabaseOperationError("Failed to serialize addresses: " + addressesJson.message());
    }

    mongodb:Update update = {
        "set": {
            "addresses": addressesJson
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

