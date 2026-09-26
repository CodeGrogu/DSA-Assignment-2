import ballerina/http;

import peerpressure/events as _;

configurable int port = 9093;

service / on new http:Listener(port) {

    resource function get health() returns json {
        return {
            status: "UP",
            "service": "customer_service",
            port: port,
            version: "0.1.0",
            contracts: "peerpressure/events:0.1.0"
        };
    }

    resource function post customers(@http:Payload Customer customer)
            returns http:Response|error {

        check insertCustomer(customer);

        http:Response response = new;
        response.statusCode = http:STATUS_CREATED;
        response.setPayload(customer);

        return response;
    }

    resource function get customers/[string customerId]()
            returns http:Response|error {

        Customer customer = check getCustomerById(customerId);

        http:Response response = new;
        response.statusCode = http:STATUS_OK;
        response.setPayload(customer);

        return response;
    }

    resource function post customers/[string customerId]/addresses(
            @http:Payload CustomerAddress address)
            returns http:Response|error {

        check updateCustomerAddress(customerId, address);

        http:Response response = new;
        response.statusCode = http:STATUS_CREATED;
        response.setPayload(address);

        return response;
    }

    resource function put customers/[string customerId]/addresses/default(
            @http:Payload DefaultAddressRequest request)
            returns http:Response|error {

        check setDefaultAddress(customerId, request.addressId);

        Customer customer = check getCustomerById(customerId);

        http:Response response = new;
        response.statusCode = http:STATUS_OK;
        response.setPayload(customer);

        return response;
    }

    resource function put customers/[string customerId](
            @http:Payload CustomerProfileUpdate profile)
            returns http:Response|error {

        check updateCustomerProfile(
            customerId,
            profile.name,
            profile.phone
        );

        Customer customer = check getCustomerById(customerId);

        http:Response response = new;
        response.statusCode = http:STATUS_OK;
        response.setPayload(customer);

        return response;
    }

    resource function post customers/verifyAddress(
            @http:Payload AddressVerificationRequest request)
            returns AddressVerificationResponse|error {

        return verifyCustomerAddress(request);
    }
}