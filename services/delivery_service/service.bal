import ballerina/http;
import ballerina/lang.'float as floats;
import ballerina/lang.'runtime as runtime;
import ballerina/log;
import ballerina/os;
import ballerina/time;
import ballerina/uuid;
import ballerinax/kafka;
import ballerinax/mongodb;

import peerpressure/delivery_domain as domain;
import peerpressure/events as events;
import peerpressure/kafka_client;
import peerpressure/metrics as metrics;
import peerpressure/resilience;

configurable int port = 9096;
configurable boolean enableMongo = false;
configurable string mongoUri = "mongodb://delivery_user:delivery_password@mongodb:27017/delivery_db?authSource=delivery_db&replicaSet=rs0";
configurable string mongoDatabase = "delivery_db";
configurable boolean enableKafka = false;
configurable boolean startKafkaConsumers = false;
configurable string kafkaBootstrapServers = "kafka:9092";
configurable string kitchenReadyTopic = "kitchen.orders.ready";
configurable string deliveryAssignedTopic = "delivery.assigned";
configurable string deliveryStatusTopic = "delivery.status";
configurable string deliveryEventsTopic = "delivery.events";
configurable string deliveryConsumerGroup = "delivery-service-group";

isolated map<domain:Driver> inMemoryDrivers = {
    "drv_001": {
        id: "drv_001",
        name: "Tomas Nekundi",
        phone: "+264811234501",
        vehicleCategory: "MOTORCYCLE",
        availability: "AVAILABLE",
        state: "AVAILABLE",
        location: {
            latitude: -22.5609d,
            longitude: 17.0658d
        }
    },
    "drv_002": {
        id: "drv_002",
        name: "Maria Shilongo",
        phone: "+264811234502",
        vehicleCategory: "CAR",
        availability: "AVAILABLE",
        state: "AVAILABLE",
        location: {
            latitude: -22.5550d,
            longitude: 17.0720d
        }
    },
    "drv_003": {
        id: "drv_003",
        name: "Lukas Hamutenya",
        phone: "+264811234503",
        vehicleCategory: "MOTORCYCLE",
        availability: "AVAILABLE",
        state: "AVAILABLE",
        location: {
            latitude: -22.5700d,
            longitude: 17.0800d
        }
    },
    "drv_004": {
        id: "drv_004",
        name: "Selma Amukoto",
        phone: "+264811234504",
        vehicleCategory: "BICYCLE",
        availability: "AVAILABLE",
        state: "AVAILABLE",
        location: {
            latitude: -22.5630d,
            longitude: 17.0600d
        }
    }
};

isolated map<json> inMemoryDeliveries = {
    "ord_test_1": {
        deliveryId: "del_ord_test_1",
        orderId: "ord_test_1",
        driverId: "drv_001",
        driverName: "Tomas Nekundi",
        status: "IN_TRANSIT",
        distanceKm: 1.25d,
        estimatedMinutes: 5,
        assignedAt: "2026-10-05T10:00:00Z",
        currentLocation: {
            latitude: -22.5609d,
            longitude: 17.0658d
        }
    }
};

isolated function getEffectiveKafkaBroker() returns string {
    string envBroker = os:getEnv("KAFKA_BROKER");
    if envBroker != "" {
        return envBroker;
    }
    string envServers = os:getEnv("KAFKA_BOOTSTRAP_SERVERS");
    if envServers != "" {
        return envServers;
    }
    return kafkaBootstrapServers;
}

isolated function getEffectiveMongoUri() returns string {
    string envUri = os:getEnv("MONGO_URI");
    if envUri != "" {
        return envUri;
    }
    return mongoUri;
}

# Calculates spherical Haversine distance in kilometers between two geographic coordinates.
public isolated function calculateDistanceKm(domain:LocationCoordinates origin, domain:LocationCoordinates destination) returns decimal {
    float lat1 = <float>origin.latitude * (floats:PI / 180.0);
    float lon1 = <float>origin.longitude * (floats:PI / 180.0);
    float lat2 = <float>destination.latitude * (floats:PI / 180.0);
    float lon2 = <float>destination.longitude * (floats:PI / 180.0);

    float dLat = lat2 - lat1;
    float dLon = lon2 - lon1;

    float sinLat = floats:sin(dLat / 2.0);
    float sinLon = floats:sin(dLon / 2.0);
    float a = (sinLat * sinLat) + (floats:cos(lat1) * floats:cos(lat2) * sinLon * sinLon);
    float c = 2.0 * floats:atan2(floats:sqrt(a), floats:sqrt(1.0 - a));
    float distanceKm = 6371.0 * c;
    decimal rounded = <decimal>floats:round(distanceKm * 100.0) / 100.0d;
    return rounded;
}

# Calculates estimated delivery time in minutes assuming a 30 km/h urban courier speed.
public isolated function calculateEtaMinutes(decimal distanceKm) returns int {
    if distanceKm <= 0.05d {
        return 1;
    }
    decimal rawMins = (distanceKm / 30.0d) * 60.0d;
    int mins = <int>rawMins;
    return mins < 1 ? 1 : mins;
}

# Selects the nearest available driver using spherical Haversine distance.
public isolated function selectNearestAvailableDriver(domain:LocationCoordinates pickupCoords) returns domain:Driver {
    domain:Driver? bestDriver = ();
    decimal bestDist = 999999.0d;

    lock {
        foreach domain:Driver drv in inMemoryDrivers {
            if drv.availability == "AVAILABLE" {
                decimal dist = calculateDistanceKm(drv.location, pickupCoords);
                if bestDriver is () || dist < bestDist {
                    bestDriver = drv;
                    bestDist = dist;
                }
            }
        }
        if bestDriver is domain:Driver {
            return bestDriver;
        }
        return inMemoryDrivers.get("drv_001");
    }
}

isolated function isDeliveryTaskStatus(string status) returns boolean {
    return status == "UNASSIGNED" || status == "DRIVER_ASSIGNED" || status == "AT_RESTAURANT" ||
        status == "OUT_FOR_DELIVERY" || status == "DELIVERED";
}

isolated function persistDeliveryToMongoAsync(map<json> deliveryDoc) {
    if !enableMongo && os:getEnv("MONGO_URI") == "" {
        return;
    }
    mongodb:Client|error mongoClient = trap new ({connection: getEffectiveMongoUri()});
    if mongoClient is mongodb:Client {
        mongodb:Database|error db = mongoClient->getDatabase(mongoDatabase);
        if db is mongodb:Database {
            mongodb:Collection|error coll = db->getCollection("deliveries");
            if coll is mongodb:Collection {
                string orderId = (deliveryDoc["orderId"] ?: "").toString();
                mongodb:Update update = {"set": deliveryDoc};
                mongodb:UpdateResult|error upd = coll->updateOne({"orderId": orderId}, update, {upsert: true});
                if upd is error {
                    log:printWarn("Failed to upsert delivery in MongoDB", 'error = upd);
                }
            }
        }
    }
}

isolated function publishDeliveryEventsAsync(string orderId, string deliveryId, string driverId, string driverName, string driverPhone, string status, domain:LocationCoordinates coords, string now) {
    if !enableKafka && os:getEnv("KAFKA_BROKER") == "" && os:getEnv("KAFKA_BOOTSTRAP_SERVERS") == "" {
        return;
    }
    kafka_client:ResilientProducer producer = new ({
        bootstrapServers: getEffectiveKafkaBroker(),
        clientId: "delivery-service-producer",
        maxRetries: 2,
        retryBackoffSeconds: 0.5
    });

    if status == "DRIVER_ASSIGNED" {
        events:DeliveryAssignedEvent assignedEvt = {
            eventId: uuid:createType4AsString(),
            deliveryId: deliveryId,
            orderId: orderId,
            driverId: driverId,
            driverName: driverName,
            driverPhone: driverPhone,
            assignedAt: now
        };
        json assignedJson = events:deliveryAssignedToJson(assignedEvt);
        error? pubErr1 = producer.publishJson(deliveryAssignedTopic, assignedJson, driverId);
        error? pubErr2 = producer.publishJson(deliveryEventsTopic, assignedJson, orderId);
    } else if status == "OUT_FOR_DELIVERY" || status == "IN_TRANSIT" {
        events:DeliveryStatusUpdated pickupEvt = {
            eventId: uuid:createType4AsString(),
            deliveryId: deliveryId,
            orderId: orderId,
            driverId: driverId,
            status: events:PICKED_UP,
            currentLocation: {
                latitude: coords.latitude,
                longitude: coords.longitude
            },
            updatedAt: now
        };
        json pickupJson = events:deliveryStatusUpdatedToJson(pickupEvt);
        error? pubErr1 = producer.publishJson(deliveryStatusTopic, pickupJson, orderId);
        error? pubErr2 = producer.publishJson(deliveryEventsTopic, pickupJson, orderId);
    } else if status == "DELIVERED" {
        events:DeliveryStatusUpdated deliveredEvt = {
            eventId: uuid:createType4AsString(),
            deliveryId: deliveryId,
            orderId: orderId,
            driverId: driverId,
            status: events:DELIVERED,
            currentLocation: {
                latitude: coords.latitude,
                longitude: coords.longitude
            },
            updatedAt: now
        };
        json deliveredJson = events:deliveryStatusUpdatedToJson(deliveredEvt);
        error? pubErr1 = producer.publishJson(deliveryStatusTopic, deliveredJson, orderId);
        error? pubErr2 = producer.publishJson(deliveryEventsTopic, deliveredJson, orderId);
    }
    error? closeErr = producer.close();
}

function init() {
    if startKafkaConsumers || os:getEnv("KAFKA_BROKER") != "" {
        _ = start runKitchenReadyConsumerLoop();
    }
}

function runKitchenReadyConsumerLoop() {
    while true {
        error? err = pollKitchenReadyTopic();
        if err is error {
            log:printWarn("Delivery Service Kafka consumer loop interrupted; retrying in 2s", 'error = err);
            runtime:sleep(2.0d);
        }
    }
}

function pollKitchenReadyTopic() returns error? {
    string broker = getEffectiveKafkaBroker();
    kafka:Consumer consumer = check new (broker, {
        groupId: deliveryConsumerGroup,
        offsetReset: "earliest",
        autoCommit: false
    });
    check consumer->subscribe([kitchenReadyTopic]);
    resilience:DlqRouter dlqRouter = new ((), {
        bootstrapServers: broker,
        clientId: "delivery-service-dlq"
    });

    while true {
        kafka:AnydataConsumerRecord[] records = check consumer->poll(1.0);
        foreach kafka:AnydataConsumerRecord rec in records {
            byte[]|kafka_client:DeserializationError rawBytes = kafka_client:extractBytes(rec.value);
            if rawBytes is kafka_client:DeserializationError {
                continue;
            }
            byte[] payload = rawBytes;
            error? procErr = resilience:executeWithRetry(function() returns error? {
                        return processKitchenReadyBytes(payload);
                    });
            if procErr is error {
                _ = check dlqRouter.routeToDlq(rawBytes, {
                    sourceTopic: rec.offset.partition.topic,
                    originalPartition: rec.offset.partition.partition,
                    originalOffset: rec.offset.offset,
                    retryCount: 3,
                    exceptionMessage: procErr.message(),
                    timestamp: time:utcToString(time:utcNow())
                });
            }
        }
        if records.length() > 0 {
            check consumer->commit();
        } else {
            runtime:sleep(0.5d);
        }
    }
}

isolated function processKitchenReadyBytes(byte[] payloadBytes) returns error? {
    json parsed = check kafka_client:safeParseJson(payloadBytes);
    events:KitchenOrderReady readyEvent = check events:validateKitchenOrderReady(parsed);
    domain:LocationCoordinates restaurantCoords = {
        latitude: -22.5609d,
        longitude: 17.0658d
    };
    domain:Driver assignedDriver = selectNearestAvailableDriver(restaurantCoords);
    string now = time:utcToString(time:utcNow());
    string deliveryId = "del_" + readyEvent.orderId;
    decimal distKm = calculateDistanceKm(assignedDriver.location, restaurantCoords);
    int etaMins = calculateEtaMinutes(distKm);

    map<json> deliveryRecord = {
        deliveryId: deliveryId,
        orderId: readyEvent.orderId,
        driverId: assignedDriver.id,
        driverName: assignedDriver.name,
        status: "DRIVER_ASSIGNED",
        distanceKm: distKm,
        estimatedMinutes: etaMins,
        assignedAt: now,
        currentLocation: {
            latitude: assignedDriver.location.latitude,
            longitude: assignedDriver.location.longitude
        }
    };

    lock {
        if !inMemoryDeliveries.hasKey(readyEvent.orderId) {
            inMemoryDeliveries[readyEvent.orderId] = deliveryRecord.cloneReadOnly();
            inMemoryDeliveries[deliveryId] = deliveryRecord.cloneReadOnly();
        }
    }
    _ = start persistDeliveryToMongoAsync(deliveryRecord.cloneReadOnly());
    _ = start publishDeliveryEventsAsync(readyEvent.orderId, deliveryId, assignedDriver.id, assignedDriver.name, assignedDriver.phone, "DRIVER_ASSIGNED", assignedDriver.location, now);
}

@http:ServiceConfig {
    cors: {
        allowOrigins: ["*"],
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowHeaders: ["*"]
    }
}
service / on new http:Listener(port) {
    resource function get health() returns json {
        time:Utc startTime = time:utcNow();
        json response = {
            status: "UP",
            "service": "delivery_service",
            port: port,
            version: "0.1.0",
            contracts: "peerpressure/events:0.1.0"
        };
        time:Utc endTime = time:utcNow();
        decimal durationMs = time:utcDiffSeconds(endTime, startTime) * 1000d;
        metrics:recordHttpRequest("GET", "/health", 200, durationMs, "delivery_service");
        metrics:recordMessageLatency("delivery.status", durationMs, "delivery_service");
        metrics:setConsumerLagMetric("delivery_service_group", "delivery.status", 0);
        return response;
    }

    resource function get metrics() returns http:Response {
        return metrics:getMetricsResponse();
    }

    isolated resource function get drivers() returns domain:Driver[] {
        lock {
            domain:Driver[] list = [];
            foreach domain:Driver drv in inMemoryDrivers {
                list.push(drv.cloneReadOnly());
            }
            return list.clone();
        }
    }

    isolated resource function get deliveries() returns json[] {
        lock {
            json[] results = [];
            map<boolean> seenOrders = {};
            foreach var [_, val] in inMemoryDeliveries.entries() {
                if val is map<json> {
                    json ordIdJson = val["orderId"];
                    if ordIdJson is string && !seenOrders.hasKey(ordIdJson) {
                        seenOrders[ordIdJson] = true;
                        results.push(val.cloneReadOnly());
                    }
                }
            }
            return results.clone();
        }
    }

    isolated resource function get delivery/track/[string orderId]() returns json|http:NotFound {
        if orderId.trim() == "" {
            return <http:NotFound>{body: {"error": "NotFound", "message": "Order ID not found"}};
        }
        json? cached = ();
        lock {
            if inMemoryDeliveries.hasKey(orderId) {
                cached = inMemoryDeliveries.get(orderId).cloneReadOnly();
            }
        }
        if cached !is () {
            return cached;
        }
        return <http:NotFound>{
            body: {
                "error": "NotFound",
                "message": string `No active or historical delivery found for order '${orderId}'`
            }
        };
    }

    isolated resource function post deliveries(@http:Payload json payload) returns http:Created|http:BadRequest {
        if payload !is map<json> {
            return <http:BadRequest>{body: {"error": "Invalid request payload, expected JSON object"}};
        }

        json orderIdJson = payload["orderId"];
        if orderIdJson !is string || orderIdJson.trim() == "" {
            return <http:BadRequest>{body: {"error": "Missing or invalid required field 'orderId'"}};
        }
        string orderId = orderIdJson.trim();

        string deliveryId = "del_" + orderId;
        json delIdJson = payload["deliveryId"];
        if delIdJson is string && delIdJson.trim() != "" {
            deliveryId = delIdJson.trim();
        }

        domain:LocationCoordinates coords = {
            latitude: -22.5609d,
            longitude: 17.0658d
        };
        json locJson = payload["currentLocation"];
        if locJson is map<json> {
            json latVal = locJson["latitude"];
            json lonVal = locJson["longitude"];
            decimal|error parsedLat = latVal.cloneWithType(decimal);
            decimal|error parsedLon = lonVal.cloneWithType(decimal);
            if parsedLat is error || parsedLon is error {
                return <http:BadRequest>{body: {"error": "Invalid latitude or longitude in currentLocation"}};
            }
            coords = {
                latitude: parsedLat,
                longitude: parsedLon
            };
            if !domain:isValidCoordinates(coords) {
                return <http:BadRequest>{body: {"error": "Coordinates out of valid geographic bounds"}};
            }
        }

        domain:Driver nearestDriver = selectNearestAvailableDriver(coords);
        string driverId = nearestDriver.id;
        string driverName = nearestDriver.name;
        string driverPhone = nearestDriver.phone;
        json driverIdJson = payload["driverId"];
        if driverIdJson is string && driverIdJson.trim() != "" {
            driverId = driverIdJson.trim();
            lock {
                if inMemoryDrivers.hasKey(driverId) {
                    domain:Driver known = inMemoryDrivers.get(driverId);
                    driverName = known.name;
                    driverPhone = known.phone;
                }
            }
        }

        string status = "DRIVER_ASSIGNED";
        json statusJson = payload["status"];
        if statusJson is string && statusJson.trim() != "" {
            status = statusJson.trim();
        }

        string now = time:utcToString(time:utcNow());
        string assignedAt = now;
        string? pickedUpAt = ();
        string? deliveredAt = ();

        json? existingJson = ();
        lock {
            if inMemoryDeliveries.hasKey(orderId) {
                existingJson = inMemoryDeliveries.get(orderId).cloneReadOnly();
            }
        }

        if existingJson is map<json> {
            json prevAssigned = existingJson["assignedAt"];
            if prevAssigned is string && prevAssigned != "" {
                assignedAt = prevAssigned;
            }
            json prevPicked = existingJson["pickedUpAt"];
            if prevPicked is string && prevPicked != "" {
                pickedUpAt = prevPicked;
            }
            json prevStatusJson = existingJson["status"];
            if prevStatusJson is string && prevStatusJson != status {
                if isDeliveryTaskStatus(prevStatusJson) && isDeliveryTaskStatus(status) {
                    domain:DeliveryTaskStatus|error prevTyped = prevStatusJson.cloneWithType(domain:DeliveryTaskStatus);
                    domain:DeliveryTaskStatus|error nextTyped = status.cloneWithType(domain:DeliveryTaskStatus);
                    if prevTyped is domain:DeliveryTaskStatus && nextTyped is domain:DeliveryTaskStatus {
                        domain:DeliveryTaskStatus|error transitioned = domain:transitionDelivery(prevTyped, nextTyped);
                        if transitioned is error {
                            return <http:BadRequest>{
                                body: {
                                    "error": "IllegalStateTransition",
                                    "message": transitioned.message()
                                }
                            };
                        }
                    }
                }
            }
        }

        if status == "OUT_FOR_DELIVERY" || status == "IN_TRANSIT" {
            pickedUpAt = now;
        } else if status == "DELIVERED" {
            deliveredAt = now;
        }

        domain:LocationCoordinates windhoekRef = {
            latitude: -22.5609d,
            longitude: 17.0658d
        };
        decimal distKm = calculateDistanceKm(coords, windhoekRef);
        int etaMins = calculateEtaMinutes(distKm);

        map<json> deliveryRecord = {
            deliveryId: deliveryId,
            orderId: orderId,
            driverId: driverId,
            driverName: driverName,
            status: status,
            distanceKm: distKm,
            estimatedMinutes: etaMins,
            assignedAt: assignedAt,
            pickedUpAt: pickedUpAt,
            deliveredAt: deliveredAt,
            currentLocation: {
                latitude: coords.latitude,
                longitude: coords.longitude
            }
        };

        lock {
            inMemoryDeliveries[orderId] = deliveryRecord.cloneReadOnly();
            inMemoryDeliveries[deliveryId] = deliveryRecord.cloneReadOnly();
        }

        _ = start persistDeliveryToMongoAsync(deliveryRecord.cloneReadOnly());
        _ = start publishDeliveryEventsAsync(orderId, deliveryId, driverId, driverName, driverPhone, status, coords, now);

        return <http:Created>{body: deliveryRecord};
    }
}
