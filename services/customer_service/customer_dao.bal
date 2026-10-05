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

    foreach CustomerAddress addr in customerResult.addresses {
        if addr.id == addressId {
            addressFound = true;
        } else {
            remainingAddresses.push(addr);
        }
    }

    if !addressFound {
        return error AddressNotFoundError("Address not found");
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

public isolated function verifyCustomerAddress(AddressVerificationRequest request)
        returns AddressVerificationResponse|error {

    error? coordValidation = validateNamibiaCoordinates(request.address.location);
    if coordValidation is error {
        return {
            valid: false,
            withinDeliveryRange: false,
            distanceKm: -1.0,
            message: coordValidation.message()
        };
    }

    // Reference point: Central Windhoek (-22.5609, 17.0658)
    float refLng = 17.0658;
    float refLat = -22.5609;
    float targetLng = request.address.location.coordinates[0];
    float targetLat = request.address.location.coordinates[1];

    // Degree to km conversion around Windhoek (lat ~22.5° S)
    float deltaLatKm = (targetLat - refLat) * 111.0;
    float deltaLngKm = (targetLng - refLng) * 102.5;
    float distanceSquared = (deltaLatKm * deltaLatKm) + (deltaLngKm * deltaLngKm);

    float distanceKm = 0.0;
    if distanceSquared > 0.0 {
        float x = distanceSquared > 1.0 ? distanceSquared / 2.0 : 1.0;
        foreach int i in 0 ..< 10 {
            x = (x + distanceSquared / x) / 2.0;
        }
        distanceKm = x;
    }

    boolean withinRange = distanceKm <= 35.0;

    return {
        valid: true,
        withinDeliveryRange: withinRange,
        distanceKm: distanceKm,
        message: withinRange ? "Address is valid and within delivery range" : "Address is outside delivery range"
    };
}
