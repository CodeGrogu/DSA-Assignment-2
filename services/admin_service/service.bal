import ballerina/http;

import codegrogu/events as _;

configurable int port = 9098;

service / on new http:Listener(port) {
    resource function get health() returns json {
        return {
            status: "UP",
            "service": "admin_service",
            port: port,
            version: "0.1.0",
            contracts: "codegrogu/events:0.1.0"
        };
    }
}
