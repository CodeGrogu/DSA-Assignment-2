import ballerina/http;
import ballerina/time;
import ballerina/uuid;

import peerpressure/metrics as metrics;

configurable int port = 9093;

service / on new http:Listener(port) {

    resource function get health() returns json {
        time:Utc startTime = time:utcNow();
        json response = {
            status: "UP",
            "service": "customer_service",
            port: port,
            version: "0.1.0",
            contracts: "peerpressure/events:0.1.0"
        };
        time:Utc endTime = time:utcNow();
        decimal durationMs = time:utcDiffSeconds(endTime, startTime) * 1000d;
        metrics:recordHttpRequest("GET", "/health", 200, durationMs, "customer_service");
        metrics:recordMessageLatency("customers.profile", durationMs, "customer_service");
        metrics:setConsumerLagMetric("customer_service_group", "customers.profile", 0);
        return response;
    }

    resource function get metrics() returns http:Response {
        return metrics:getMetricsResponse();
    }

    resource function post customers(@http:Payload json payload)
            returns http:Response {
        time:Utc startTime = time:utcNow();
        string path = "/customers";

        Customer|error customerResult = parseAndValidateCustomer(payload);
        if customerResult is error {
            return respondWithMetric(
                    http:STATUS_BAD_REQUEST,
                    {message: "Payload validation failure: " + customerResult.message()},
                    "POST",
                    path,
                    startTime
            );
        }

        Customer customer = customerResult;

        string? validationErr = validateCustomer(customer);
        if validationErr is string {
            return respondWithMetric(
                    http:STATUS_BAD_REQUEST,
                    {message: validationErr},
                    "POST",
                    path,
                    startTime
            );
        }

        foreach CustomerAddress addr in customer.addresses {
            error? coordErr = validateNamibiaCoordinates(addr.location);
            if coordErr is error {
                return respondWithMetric(
                        http:STATUS_BAD_REQUEST,
                        {message: coordErr.message()},
                        "POST",
                        path,
                        startTime
                );
            }
        }

        error? result = insertCustomer(customer);

        if result is DuplicateEmailError {
            return respondWithMetric(
                    http:STATUS_CONFLICT,
                    {message: "Customer email already exists"},
                    "POST",
                    path,
                    startTime
            );
        }

        if result is error {
            return respondWithMetric(
                    http:STATUS_INTERNAL_SERVER_ERROR,
                    {message: result.message()},
                    "POST",
                    path,
                    startTime
            );
        }

        return respondWithMetric(
                http:STATUS_CREATED,
                customerToJson(customer),
                "POST",
                path,
                startTime
        );
    }

    resource function get customers/[string customerId]()
            returns http:Response {
        time:Utc startTime = time:utcNow();
        string path = string `/customers/${customerId}`;

        if customerId.trim().length() == 0 {
            return respondWithMetric(
                    http:STATUS_BAD_REQUEST,
                    {message: "Customer ID cannot be empty"},
                    "GET",
                    path,
                    startTime
            );
        }

        Customer|error result = getCustomerById(customerId);

        if result is error {
            if result is CustomerNotFoundError || result.message() == "Customer not found" {
                return respondWithMetric(
                        http:STATUS_NOT_FOUND,
                        {message: "Customer not found"},
                        "GET",
                        path,
                        startTime
                );
            }

            return respondWithMetric(
                    http:STATUS_INTERNAL_SERVER_ERROR,
                    {message: result.message()},
                    "GET",
                    path,
                    startTime
            );
        }

        return respondWithMetric(
                http:STATUS_OK,
                customerToJson(result),
                "GET",
                path,
                startTime
        );
    }

    resource function post customers/[string customerId]/addresses(
            @http:Payload json payload)
            returns http:Response {
        time:Utc startTime = time:utcNow();
        string path = string `/customers/${customerId}/addresses`;

        if customerId.trim().length() == 0 {
            return respondWithMetric(
                    http:STATUS_BAD_REQUEST,
                    {message: "Customer ID cannot be empty"},
                    "POST",
                    path,
                    startTime
            );
        }

        CustomerAddress|error addressResult = payload.cloneWithType(CustomerAddress);
        if addressResult is error {
            return respondWithMetric(
                    http:STATUS_BAD_REQUEST,
                    {message: "Payload validation failure: " + addressResult.message()},
                    "POST",
                    path,
                    startTime
            );
        }

        CustomerAddress address = addressResult;

        string? addrValErr = validateCustomerAddress(address);
        if addrValErr is string {
            return respondWithMetric(
                    http:STATUS_BAD_REQUEST,
                    {message: addrValErr},
                    "POST",
                    path,
                    startTime
            );
        }

        error? coordinateResult = validateNamibiaCoordinates(address.location);
        if coordinateResult is error {
            return respondWithMetric(
                    http:STATUS_BAD_REQUEST,
                    {message: coordinateResult.message()},
                    "POST",
                    path,
                    startTime
            );
        }

        error? result = updateCustomerAddress(
                customerId,
                address
        );

        if result is error {
            if result is CustomerNotFoundError || result.message() == "Customer not found" {
                return respondWithMetric(
                        http:STATUS_NOT_FOUND,
                        {message: "Customer not found"},
                        "POST",
                        path,
                        startTime
                );
            }

            return respondWithMetric(
                    http:STATUS_INTERNAL_SERVER_ERROR,
                    {message: result.message()},
                    "POST",
                    path,
                    startTime
            );
        }

        return respondWithMetric(
                http:STATUS_CREATED,
                address,
                "POST",
                path,
                startTime
        );
    }

    resource function put customers/[string customerId]/addresses/default(
            @http:Payload json payload)
            returns http:Response {
        time:Utc startTime = time:utcNow();
        string path = string `/customers/${customerId}/addresses/default`;

        if customerId.trim().length() == 0 {
            return respondWithMetric(
                    http:STATUS_BAD_REQUEST,
                    {message: "Customer ID cannot be empty"},
                    "PUT",
                    path,
                    startTime
            );
        }

        DefaultAddressRequest|error requestResult = payload.cloneWithType(DefaultAddressRequest);
        if requestResult is error {
            return respondWithMetric(
                    http:STATUS_BAD_REQUEST,
                    {message: "Payload validation failure: " + requestResult.message()},
                    "PUT",
                    path,
                    startTime
            );
        }

        DefaultAddressRequest request = requestResult;
        if request.addressId.trim().length() == 0 {
            return respondWithMetric(
                    http:STATUS_BAD_REQUEST,
                    {message: "Address ID cannot be empty"},
                    "PUT",
                    path,
                    startTime
            );
        }

        error? result = setDefaultAddress(
                customerId,
                request.addressId
        );

        if result is error {
            if result is CustomerNotFoundError || result.message() == "Customer not found" {
                return respondWithMetric(
                        http:STATUS_NOT_FOUND,
                        {message: "Customer not found"},
                        "PUT",
                        path,
                        startTime
                );
            }

            if result is AddressNotFoundError || result.message() == "Address not found" {
                return respondWithMetric(
                        http:STATUS_NOT_FOUND,
                        {message: "Address not found"},
                        "PUT",
                        path,
                        startTime
                );
            }

            return respondWithMetric(
                    http:STATUS_INTERNAL_SERVER_ERROR,
                    {message: result.message()},
                    "PUT",
                    path,
                    startTime
            );
        }

        Customer|error customerResult = getCustomerById(customerId);

        if customerResult is error {
            if customerResult is CustomerNotFoundError || customerResult.message() == "Customer not found" {
                return respondWithMetric(
                        http:STATUS_NOT_FOUND,
                        {message: "Customer not found"},
                        "PUT",
                        path,
                        startTime
                );
            }

            return respondWithMetric(
                    http:STATUS_INTERNAL_SERVER_ERROR,
                    {message: customerResult.message()},
                    "PUT",
                    path,
                    startTime
            );
        }

        return respondWithMetric(
                http:STATUS_OK,
                customerToJson(customerResult),
                "PUT",
                path,
                startTime
        );
    }

    resource function put customers/[string customerId](
            @http:Payload json payload)
            returns http:Response {
        time:Utc startTime = time:utcNow();
        string path = string `/customers/${customerId}`;

        if customerId.trim().length() == 0 {
            return respondWithMetric(
                    http:STATUS_BAD_REQUEST,
                    {message: "Customer ID cannot be empty"},
                    "PUT",
                    path,
                    startTime
            );
        }

        CustomerProfileUpdate|error profileResult = payload.cloneWithType(CustomerProfileUpdate);
        if profileResult is error {
            return respondWithMetric(
                    http:STATUS_BAD_REQUEST,
                    {message: "Payload validation failure: " + profileResult.message()},
                    "PUT",
                    path,
                    startTime
            );
        }

        CustomerProfileUpdate profile = profileResult;
        if profile.name.trim().length() == 0 {
            return respondWithMetric(
                    http:STATUS_BAD_REQUEST,
                    {message: "Customer name cannot be empty"},
                    "PUT",
                    path,
                    startTime
            );
        }

        if profile.phone.trim().length() == 0 {
            return respondWithMetric(
                    http:STATUS_BAD_REQUEST,
                    {message: "Customer phone cannot be empty"},
                    "PUT",
                    path,
                    startTime
            );
        }

        error? result = updateCustomerProfile(
                customerId,
                profile.name,
                profile.phone
        );

        if result is error {
            if result is CustomerNotFoundError || result.message() == "Customer not found" {
                return respondWithMetric(
                        http:STATUS_NOT_FOUND,
                        {message: "Customer not found"},
                        "PUT",
                        path,
                        startTime
                );
            }

            return respondWithMetric(
                    http:STATUS_INTERNAL_SERVER_ERROR,
                    {message: result.message()},
                    "PUT",
                    path,
                    startTime
            );
        }

        Customer|error customerResult = getCustomerById(customerId);

        if customerResult is error {
            if customerResult is CustomerNotFoundError || customerResult.message() == "Customer not found" {
                return respondWithMetric(
                        http:STATUS_NOT_FOUND,
                        {message: "Customer not found"},
                        "PUT",
                        path,
                        startTime
                );
            }

            return respondWithMetric(
                    http:STATUS_INTERNAL_SERVER_ERROR,
                    {message: customerResult.message()},
                    "PUT",
                    path,
                    startTime
            );
        }

        return respondWithMetric(
                http:STATUS_OK,
                customerToJson(customerResult),
                "PUT",
                path,
                startTime
        );
    }

    resource function delete customers/[string customerId]/addresses/[string addressId]()
            returns http:Response {
        time:Utc startTime = time:utcNow();
        string path = string `/customers/${customerId}/addresses/${addressId}`;

        if customerId.trim().length() == 0 || addressId.trim().length() == 0 {
            return respondWithMetric(
                    http:STATUS_BAD_REQUEST,
                    {message: "Customer ID and Address ID cannot be empty"},
                    "DELETE",
                    path,
                    startTime
            );
        }

        error? result = deleteCustomerAddress(
                customerId,
                addressId
        );

        if result is error {
            if result is CustomerNotFoundError || result.message() == "Customer not found" {
                return respondWithMetric(
                        http:STATUS_NOT_FOUND,
                        {message: "Customer not found"},
                        "DELETE",
                        path,
                        startTime
                );
            }

            if result is AddressNotFoundError || result.message() == "Address not found" {
                return respondWithMetric(
                        http:STATUS_NOT_FOUND,
                        {message: "Address not found"},
                        "DELETE",
                        path,
                        startTime
                );
            }

            return respondWithMetric(
                    http:STATUS_INTERNAL_SERVER_ERROR,
                    {message: result.message()},
                    "DELETE",
                    path,
                    startTime
            );
        }

        return respondWithMetric(
                http:STATUS_OK,
                {message: "Address deleted successfully"},
                "DELETE",
                path,
                startTime
        );
    }

    resource function post customers/verifyAddress(
            @http:Payload json payload)
            returns http:Response {
        return processVerifyAddress(payload, "/customers/verifyAddress");
    }

    resource function post customers/'verify\-address(
            @http:Payload json payload)
            returns http:Response {
        return processVerifyAddress(payload, "/customers/verify-address");
    }
}

function processVerifyAddress(json payload, string path) returns http:Response {
    time:Utc startTime = time:utcNow();

    AddressVerificationRequest|error reqResult = payload.cloneWithType(AddressVerificationRequest);
    if reqResult is error {
        return respondWithMetric(
                http:STATUS_BAD_REQUEST,
                {message: "Payload validation failure: " + reqResult.message()},
                "POST",
                path,
                startTime
        );
    }

    AddressVerificationRequest req = reqResult;

    string? pointErr = validateGeoJSONPoint(req.address.location);
    if pointErr is string {
        return respondWithMetric(
                http:STATUS_BAD_REQUEST,
                {message: pointErr},
                "POST",
                path,
                startTime
        );
    }

    AddressVerificationResponse|error result = verifyCustomerAddress(req);
    if result is error {
        return respondWithMetric(
                http:STATUS_INTERNAL_SERVER_ERROR,
                {message: result.message()},
                "POST",
                path,
                startTime
        );
    }

    return respondWithMetric(
            http:STATUS_OK,
            result,
            "POST",
            path,
            startTime
    );
}

function respondWithMetric(int statusCode, anydata payload, string method, string path, time:Utc startTime)
        returns http:Response {
    time:Utc endTime = time:utcNow();
    decimal durationMs = time:utcDiffSeconds(endTime, startTime) * 1000d;
    metrics:recordHttpRequest(method, path, statusCode, durationMs, "customer_service");

    http:Response response = new;
    response.statusCode = statusCode;
    response.setPayload(payload);
    return response;
}

isolated function customerToJson(Customer customer) returns json {
    CustomerAddress? defaultAddr = getDefaultAddress(customer);
    json customerJson = {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        addresses: customer.addresses
    };
    if defaultAddr is CustomerAddress {
        map<json> jsonMap = <map<json>>customerJson;
        jsonMap["address"] = defaultAddr;
        return jsonMap;
    }
    return customerJson;
}

isolated function parseAndValidateCustomer(json payload) returns Customer|error {
    if payload !is map<json> {
        return error("Payload must be a JSON object");
    }

    Customer|error direct = payload.cloneWithType(Customer);
    if direct is Customer {
        return direct;
    }

    string id = "";
    if payload.hasKey("id") && payload["id"] is string {
        id = <string>payload["id"];
    }

    string name = "";
    if payload.hasKey("name") && payload["name"] is string {
        name = <string>payload["name"];
    }

    string email = "";
    if payload.hasKey("email") && payload["email"] is string {
        email = <string>payload["email"];
    }

    string phone = "";
    if payload.hasKey("phone") && payload["phone"] is string {
        phone = <string>payload["phone"];
    }

    if id.trim().length() == 0 {
        if email.startsWith("cust_") && email.includes("@") {
            int? atIndex = email.indexOf("@");
            if atIndex is int {
                id = email.substring(0, atIndex);
            } else {
                id = uuid:createType1AsString();
            }
        } else {
            id = uuid:createType1AsString();
        }
    }

    CustomerAddress[] addresses = [];
    if payload.hasKey("addresses") && payload["addresses"] is json[] {
        json[] addrsJson = <json[]>payload["addresses"];
        foreach json item in addrsJson {
            CustomerAddress addr = check item.cloneWithType(CustomerAddress);
            addresses.push(addr);
        }
    } else if payload.hasKey("address") && payload["address"] is map<json> {
        map<json> addrMap = <map<json>>payload["address"];
        string addrId = addrMap.hasKey("id") && addrMap["id"] is string ? <string>addrMap["id"] : uuid:createType1AsString();
        string tag = addrMap.hasKey("tag") && addrMap["tag"] is string ? <string>addrMap["tag"] : "Home";
        string street = addrMap.hasKey("street") && addrMap["street"] is string ? <string>addrMap["street"] : "";
        string city = addrMap.hasKey("city") && addrMap["city"] is string ? <string>addrMap["city"] : "";
        string state = addrMap.hasKey("state") && addrMap["state"] is string ? <string>addrMap["state"] : "";
        string postalCode = addrMap.hasKey("postalCode") && addrMap["postalCode"] is string ? <string>addrMap["postalCode"] : "";
        string deliveryInstructions = addrMap.hasKey("deliveryInstructions") && addrMap["deliveryInstructions"] is string ? <string>addrMap["deliveryInstructions"] : "";
        GeoJSONPoint location;
        if addrMap.hasKey("location") {
            location = check addrMap["location"].cloneWithType(GeoJSONPoint);
        } else {
            location = {
                'type: "Point",
                coordinates: [17.0658, -22.5609]
            };
        }
        CustomerAddress addr = {
            id: addrId,
            tag: tag,
            street: street,
            city: city,
            state: state,
            postalCode: postalCode,
            location: location,
            deliveryInstructions: deliveryInstructions,
            isDefault: true
        };
        addresses.push(addr);
    }

    Customer customer = {
        id: id,
        name: name,
        email: email,
        phone: phone,
        addresses: addresses
    };
    return customer;
}
