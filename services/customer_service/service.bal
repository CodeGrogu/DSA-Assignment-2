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

        error? result = insertCustomer(customer);

        if result is DuplicateEmailError {
            http:Response response = new;
            response.statusCode = http:STATUS_CONFLICT;
            response.setPayload({
                message: "Customer email already exists"
            });

            return response;
        }

        if result is error {
            return result;
        }

        http:Response response = new;
        response.statusCode = http:STATUS_CREATED;
        response.setPayload(customer);

        return response;
    }

    resource function get customers/[string customerId]()
            returns http:Response|error {

        Customer|error result = getCustomerById(customerId);

        if result is error {
            if result.message() == "Customer not found" {
                http:Response response = new;
                response.statusCode = http:STATUS_NOT_FOUND;
                response.setPayload({
                    message: "Customer not found"
                });

                return response;
            }

            return result;
        }

        http:Response response = new;
        response.statusCode = http:STATUS_OK;
        response.setPayload(result);

        return response;
    }

    resource function post customers/[string customerId]/addresses(
            @http:Payload CustomerAddress address)
            returns http:Response|error {

        error? coordinateResult =
            validateNamibiaCoordinates(address.location);

        if coordinateResult is error {
            http:Response response = new;
            response.statusCode = http:STATUS_BAD_REQUEST;
            response.setPayload({
                message: coordinateResult.message()
            });

            return response;
        }

        error? result = updateCustomerAddress(
            customerId,
            address
        );

        if result is error {
            if result.message() == "Customer not found" {
                http:Response response = new;
                response.statusCode = http:STATUS_NOT_FOUND;
                response.setPayload({
                    message: "Customer not found"
                });

                return response;
            }

            return result;
        }

        http:Response response = new;
        response.statusCode = http:STATUS_CREATED;
        response.setPayload(address);

        return response;
    }

    resource function put customers/[string customerId]/addresses/default(
            @http:Payload DefaultAddressRequest request)
            returns http:Response|error {

        error? result = setDefaultAddress(
            customerId,
            request.addressId
        );

        if result is error {
            if result.message() == "Customer not found" {
                http:Response response = new;
                response.statusCode = http:STATUS_NOT_FOUND;
                response.setPayload({
                    message: "Customer not found"
                });

                return response;
            }

            if result.message() == "Address not found" {
                http:Response response = new;
                response.statusCode = http:STATUS_NOT_FOUND;
                response.setPayload({
                    message: "Address not found"
                });

                return response;
            }

            return result;
        }

        Customer|error customerResult = getCustomerById(customerId);

        if customerResult is error {
            if customerResult.message() == "Customer not found" {
                http:Response response = new;
                response.statusCode = http:STATUS_NOT_FOUND;
                response.setPayload({
                    message: "Customer not found"
                });

                return response;
            }

            return customerResult;
        }

        http:Response response = new;
        response.statusCode = http:STATUS_OK;
        response.setPayload(customerResult);

        return response;
    }

    resource function put customers/[string customerId](
            @http:Payload CustomerProfileUpdate profile)
            returns http:Response|error {

        error? result = updateCustomerProfile(
            customerId,
            profile.name,
            profile.phone
        );

        if result is error {
            if result.message() == "Customer not found" {
                http:Response response = new;
                response.statusCode = http:STATUS_NOT_FOUND;
                response.setPayload({
                    message: "Customer not found"
                });

                return response;
            }

            return result;
        }

        Customer|error customerResult = getCustomerById(customerId);

        if customerResult is error {
            if customerResult.message() == "Customer not found" {
                http:Response response = new;
                response.statusCode = http:STATUS_NOT_FOUND;
                response.setPayload({
                    message: "Customer not found"
                });

                return response;
            }

            return customerResult;
        }

        http:Response response = new;
        response.statusCode = http:STATUS_OK;
        response.setPayload(customerResult);

        return response;
    }

    resource function delete customers/[string customerId]/addresses/[string addressId]()
            returns http:Response|error {

        error? result = deleteCustomerAddress(
            customerId,
            addressId
        );

        if result is error {
            if result.message() == "Customer not found" {
                http:Response response = new;
                response.statusCode = http:STATUS_NOT_FOUND;
                response.setPayload({
                    message: "Customer not found"
                });

                return response;
            }

            if result.message() == "Address not found" {
                http:Response response = new;
                response.statusCode = http:STATUS_NOT_FOUND;
                response.setPayload({
                    message: "Address not found"
                });

                return response;
            }

            return result;
        }

        http:Response response = new;
        response.statusCode = http:STATUS_OK;
        response.setPayload({
            message: "Address deleted successfully"
        });

        return response;
    }

    resource function post customers/verifyAddress(
            @http:Payload AddressVerificationRequest request)
            returns AddressVerificationResponse|error {

        return verifyCustomerAddress(request);
    }
}
