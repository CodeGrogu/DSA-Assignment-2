import ballerina/http;

import peerpressure/events as _;

configurable int port = 9096;

service / on new http:Listener(port) {
    resource function get health() returns json {
        return {
            status: "UP",
            "service": "delivery_service",
            port: port,
            version: "0.1.0",
            contracts: "peerpressure/events:0.1.0"
        };
    }
}
