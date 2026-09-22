import ballerina/http;

import peerpressure/events as _;

configurable int port = 9095;

service / on new http:Listener(port) {
    resource function get health() returns json {
        return {
            status: "UP",
            "service": "restaurant_service",
            port: port,
            version: "0.1.0",
            contracts: "peerpressure/events:0.1.0"
        };
    }

    resource function post seed() returns http:Response|error {
        error? err = seedDatabase();
        http:Response res = new;
        if err is error {
            res.statusCode = 500;
            res.setJsonPayload({ message: "Failed to seed database", "error": err.message() });
        } else {
            res.statusCode = 200;
            res.setJsonPayload({ message: "Database seeded successfully" });
        }
        return res;
    }
}
