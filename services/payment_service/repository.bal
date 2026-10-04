import ballerina/os;
import ballerinax/mongodb;

import peerpressure/events;

configurable string mongoUri = "mongodb://root:password@localhost:27017/payment_service?authSource=admin";
configurable string databaseName = "payment_service";
configurable string transactionsCollectionName = "transactions";
configurable string idempotencyCollectionName = "idempotency_keys";
configurable string ledgerCollectionName = "ledger_entries";
configurable string refundsCollectionName = "refunds";

isolated mongodb:Client? cachedMongoClient = ();

function collection(string collectionName) returns mongodb:Collection|error {
    string connectionUri = mongoUri;
    string? environmentUri = os:getEnv("MONGO_URI");
    if environmentUri is string {
        connectionUri = environmentUri;
    }

    mongodb:Client mongoClient;
    lock {
        if cachedMongoClient is mongodb:Client {
            mongoClient = <mongodb:Client>cachedMongoClient;
        } else {
            mongodb:Client newClient = check new ({connection: connectionUri});
            cachedMongoClient = newClient;
            mongoClient = newClient;
        }
    }

    mongodb:Database database = check mongoClient->getDatabase(databaseName);
    return check database->getCollection(collectionName);
}

public function findTransactionById(string transactionId) returns PaymentTransaction?|error {
    mongodb:Collection transactions = check collection(transactionsCollectionName);
    return check transactions->findOne({transactionId}, targetType = PaymentTransaction);
}

public function findTransactionByOrderId(string orderId) returns PaymentTransaction?|error {
    mongodb:Collection transactions = check collection(transactionsCollectionName);
    return check transactions->findOne({orderId}, targetType = PaymentTransaction);
}

public function findTransactionByIdempotencyKey(string idempotencyKey) returns PaymentTransaction?|error {
    mongodb:Collection transactions = check collection(transactionsCollectionName);
    return check transactions->findOne({idempotencyKey}, targetType = PaymentTransaction);
}

public function findIdempotencyRecord(string idempotencyKey) returns IdempotencyRecord?|error {
    mongodb:Collection idempotencyKeys = check collection(idempotencyCollectionName);
    return check idempotencyKeys->findOne({idempotencyKey}, targetType = IdempotencyRecord);
}

public function reserveIdempotencyKey(IdempotencyRecord idempotencyRecord) returns error? {
    mongodb:Collection idempotencyKeys = check collection(idempotencyCollectionName);
    check idempotencyKeys->createIndex({idempotencyKey: 1}, {unique: true});
    check idempotencyKeys->insertOne(idempotencyRecord);
}

public function insertPaymentTransaction(PaymentTransaction paymentTransaction) returns error? {
    mongodb:Collection transactions = check collection(transactionsCollectionName);
    check transactions->createIndex({transactionId: 1}, {unique: true});
    check transactions->createIndex({orderId: 1}, {unique: true});
    check transactions->insertOne(paymentTransaction);
}

public function completeIdempotencyKey(IdempotencyRecord idempotencyRecord) returns error? {
    mongodb:Collection idempotencyKeys = check collection(idempotencyCollectionName);
    map<json> fields = {
        status: idempotencyRecord.status,
        transactionReference: idempotencyRecord.transactionReference,
        updatedAt: idempotencyRecord.updatedAt,
        eventPublished: idempotencyRecord.eventPublished
    };
    if idempotencyRecord.errorCode is string {
        fields["errorCode"] = idempotencyRecord.errorCode;
    }
    if idempotencyRecord.failureReason is string {
        fields["failureReason"] = idempotencyRecord.failureReason;
    }
    _ = check idempotencyKeys->updateOne(
        {idempotencyKey: idempotencyRecord.idempotencyKey},
        {set: fields}
    );
}

public function markPaymentEventPublished(string idempotencyKey) returns error? {
    mongodb:Collection idempotencyKeys = check collection(idempotencyCollectionName);
    _ = check idempotencyKeys->updateOne(
        {idempotencyKey},
        {set: {eventPublished: true}}
    );
}

public function findRefundByOrderId(string orderId) returns RefundRecord?|error {
    mongodb:Collection refunds = check collection(refundsCollectionName);
    return check refunds->findOne({orderId}, targetType = RefundRecord);
}

public function insertRefundRecord(RefundRecord refundRecord) returns error? {
    mongodb:Collection refunds = check collection(refundsCollectionName);
    check refunds->createIndex({orderId: 1}, {unique: true});
    check refunds->createIndex({refundId: 1}, {unique: true});
    check refunds->insertOne(refundRecord);
}

public function updatePaymentStatus(string orderId, events:PaymentStatus status, string updatedAt) returns error? {
    mongodb:Collection transactions = check collection(transactionsCollectionName);
    _ = check transactions->updateOne(
        {orderId, status: events:COMPLETED},
        {set: {status: status.toString(), updatedAt}}
    );
}

public function markRefundEventPublished(string orderId) returns error? {
    mongodb:Collection refunds = check collection(refundsCollectionName);
    _ = check refunds->updateOne(
        {orderId},
        {set: {eventPublished: true}}
    );
}

public function insertLedgerEntries(LedgerEntry[] entries) returns error? {
    mongodb:Collection ledgerEntries = check collection(ledgerCollectionName);
    check ledgerEntries->createIndex({entryId: 1}, {unique: true});
    foreach LedgerEntry ledgerEntry in entries {
        _ = check ledgerEntries->updateOne(
            {entryId: ledgerEntry.entryId},
            {setOnInsert: ledgerEntry},
            {upsert: true}
        );
    }
}
