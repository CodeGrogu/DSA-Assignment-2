import ballerinax/mongodb;

configurable string mongodbConnection =
    "mongodb://customer_user:customer_password@localhost:27017/customer_db?authSource=customer_db";

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
            "addresses": check address.cloneWithType(json)
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

public function setDefaultAddress(
        string customerId,
        string addressId
) returns error? {

    mongodb:Collection collection = check getCustomerCollection();

    Customer customer = check getCustomerById(customerId);

    boolean addressFound = false;

    foreach var address in customer.addresses {
        address.isDefault = address.id == addressId;

        if address.id == addressId {
            addressFound = true;
        }
    }

    if !addressFound {
        return error AddressNotFoundError("Address not found");
    }

    mongodb:Update update = {
        "set": {
            "addresses": check customer.addresses.cloneWithType(json)
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

public function updateCustomerProfile(
        string customerId,
        string name,
        string phone
) returns error? {

    mongodb:Collection collection = check getCustomerCollection();

    mongodb:Update update = {
        "set": {
            "name": name,
            "phone": phone
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

public function deleteCustomerAddress(
        string customerId,
        string addressId
) returns error? {

    mongodb:Collection collection = check getCustomerCollection();

    Customer customer = check getCustomerById(customerId);

    CustomerAddress[] remainingAddresses = [];

    boolean addressFound = false;

    foreach var address in customer.addresses {
        if address.id == addressId {
            addressFound = true;
        } else {
            remainingAddresses.push(address);
        }
    }

    if !addressFound {
        return error AddressNotFoundError("Address not found");
    }

    mongodb:Update update = {
        "set": {
            "addresses": check remainingAddresses.cloneWithType(json)
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

public function deleteCustomer(string id) returns error? {
    mongodb:Collection collection = check getCustomerCollection();

    mongodb:DeleteResult result = check collection->deleteOne({id: id});

    if result.deletedCount == 0 {
        return error CustomerNotFoundError("Customer not found");
    }

    return;
}

public function verifyCustomerAddress(AddressVerificationRequest request)
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

    float distanceKm = distanceSquared;
    float x = distanceKm / 2.0;
    if x > 0.0 {
        foreach int i in 0 ..< 10 {
            x = (x + distanceKm / x) / 2.0;
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
