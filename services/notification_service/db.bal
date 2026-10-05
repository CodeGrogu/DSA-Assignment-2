import ballerina/log;
import ballerina/os;
import ballerinax/mongodb;

import peerpressure/admin_domain as domain;

configurable string mongoUri = "";
configurable string mongoDatabase = "notification_db";

isolated mongodb:Client? sharedNotificationMongoClient = ();

isolated function getEffectiveNotificationMongoUri() returns string {
    string envUri = os:getEnv("MONGO_URI");
    if envUri != "" {
        return envUri;
    }
    return mongoUri;
}

isolated function getNotificationMongoClient() returns mongodb:Client? {
    string uri = getEffectiveNotificationMongoUri();
    if uri.trim() == "" {
        return ();
    }
    lock {
        mongodb:Client? existing = sharedNotificationMongoClient;
        if existing is mongodb:Client {
            return existing;
        }
        mongodb:Client|error created = trap new ({connection: uri});
        if created is mongodb:Client {
            sharedNotificationMongoClient = created;
            return created;
        }
        return ();
    }
}

public isolated function queryAuditFromMongo() returns json[] {
    mongodb:Client? mongoClient = getNotificationMongoClient();
    if mongoClient is mongodb:Client {
        mongodb:Database|error db = mongoClient->getDatabase(mongoDatabase);
        if db is mongodb:Database {
            mongodb:Collection|error coll = db->getCollection("notifications");
            if coll is mongodb:Collection {
                stream<map<json>, error?>|error st = coll->find({}, projection = {"_id": 0});
                if st is stream<map<json>, error?> {
                    json[] out = [];
                    while true {
                        record {|map<json> value;|}|error? nextDoc = st.next();
                        if nextDoc is () || nextDoc is error {
                            break;
                        }
                        out.push(nextDoc.value);
                    }
                    return out;
                }
            }
        }
    }
    return [];
}

public isolated function persistAuditToMongo(domain:NotificationAuditRecord entry) {
    mongodb:Client? mongoClient = getNotificationMongoClient();
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
