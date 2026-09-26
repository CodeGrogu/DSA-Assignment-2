import ballerina/http;

import peerpressure/events as _;

configurable int port = 9091;

service / on new http:Listener(port) {

    resource function get health() returns json {
        return {
            status: "UP",
            "service": "order_service",
            port: port,
            version: "0.1.0",
            contracts: "peerpressure/events:0.1.0"
        };
    }

    resource function get customers/[string customerId]/orders(
            int resultLimit = 10,
            int offset = 0
) returns record {}[]|error {

        return getOrdersByCustomer(customerId, resultLimit, offset);
    }
}
