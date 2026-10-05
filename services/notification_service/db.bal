import ballerina/log;
import ballerina/os;
import ballerinax/mongodb;

import peerpressure/admin_domain as domain;

configurable string mongoUri = "";
configurable string mongoDatabase = "notification_db";

isolated function getEffectiveNotificationMongoUri() returns string {
    string envUri = os:getEnv("MONGO_URI");
    if envUri != "" {
        return envUri;
    }
    return mongoUri;
}

public isolated function persistAuditToMongo(domain:NotificationAuditRecord entry) {
    string uri = getEffectiveNotificationMongoUri();
    if uri.trim() == "" {
        return;
    }
    mongodb:Client|error mongoClient = trap new ({connection: uri});
    if mongoClient is mongodb:Client {
        mongodb:Database|error db = mongoClient->getDatabase(mongoDatabase);
        if db is mongodb:Database {
            mongodb:Collection|error coll = db->getCollection("notifications");
            if coll is mongodb:Collection {
                error? insErr = coll->insertOne(entry);
                if insErr is error {
                    log:printWarn("Could not insert notification audit into MongoDB; preserved in audit.log", 'error = insErr);
                }
            }
        }
    }
}
