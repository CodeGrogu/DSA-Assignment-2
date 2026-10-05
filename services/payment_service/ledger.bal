import ballerinax/mongodb;

configurable string mongoUri = "mongodb://root:password@mongodb:27017/payments_db?authSource=admin&replicaSet=rs0";
configurable string mongoDatabase = "payments_db";

type IdempotencyRecord record {|
    string _id;
    string key;
    string idempotencyKey;
    PaymentTransaction 'transaction;
|};

isolated class PaymentStore {
    private final mongodb:Client mongoClient;
    private final mongodb:Database database;
    private final mongodb:Collection transactionsCollection;
    private final mongodb:Collection ledgerCollection;
    private final mongodb:Collection idempotencyCollection;
    private boolean indexesReady = false;

    isolated function init() returns error? {
        self.mongoClient = check new ({connection: mongoUri});
        self.database = check self.mongoClient->getDatabase(mongoDatabase);
        self.transactionsCollection = check self.database->getCollection("transactions");
        self.ledgerCollection = check self.database->getCollection("ledger_entries");
        self.idempotencyCollection = check self.database->getCollection("idempotency_keys");
    }

    private isolated function ensureIndexes() returns error? {
        lock {
            if !self.indexesReady {
                check self.transactionsCollection->createIndex(
                    {orderId: 1, createdAt: -1},
                    {name: "transactions_by_order_created"}
                );
                check self.idempotencyCollection->createIndex({key: 1}, {unique: true, name: "idempotency_key_unique"});
                self.indexesReady = true;
            }
        }
    }

    public isolated function findTransactionById(string transactionId) returns PaymentTransaction?|error {
        check self.ensureIndexes();
        return check self.transactionsCollection->findOne({transactionId}, targetType = PaymentTransaction);
    }

    public isolated function findTransactionByOrder(string orderId) returns PaymentTransaction?|error {
        check self.ensureIndexes();
        return check self.transactionsCollection->findOne(
            {orderId},
            {sort: {createdAt: -1}},
            targetType = PaymentTransaction
        );
    }

    public isolated function findCapturedTransactionByOrder(string orderId) returns PaymentTransaction?|error {
        check self.ensureIndexes();
        return check self.transactionsCollection->findOne(
            {orderId, status: "COMPLETED"},
            targetType = PaymentTransaction
        );
    }

    public isolated function findByIdempotencyKey(string key) returns PaymentTransaction?|error {
        check self.ensureIndexes();
        IdempotencyRecord? document = check self.idempotencyCollection->findOne({_id: key}, targetType = IdempotencyRecord);
        if document is () {
            return ();
        }
        return document.'transaction;
    }

    public isolated function persistCharge(PaymentTransaction payment) returns error? {
        check self.ensureIndexes();
        check self.transactionsCollection->insertOne(payment);
        if payment.status == COMPLETED {
            foreach LedgerEntry entry in makeLedgerEntries(payment, false) {
                check self.ledgerCollection->insertOne(entry);
            }
        }
        IdempotencyRecord idempotencyRecord = {
            _id: payment.idempotencyKey,
            key: payment.idempotencyKey,
            idempotencyKey: payment.idempotencyKey,
            'transaction: payment
        };
        check self.idempotencyCollection->insertOne(idempotencyRecord);
    }

    public isolated function persistRefund(PaymentTransaction payment) returns error? {
        check self.ensureIndexes();
        check self.transactionsCollection->insertOne(payment);
        foreach LedgerEntry entry in makeLedgerEntries(payment, true) {
            check self.ledgerCollection->insertOne(entry);
        }
        IdempotencyRecord idempotencyRecord = {
            _id: payment.idempotencyKey,
            key: payment.idempotencyKey,
            idempotencyKey: payment.idempotencyKey,
            'transaction: payment
        };
        check self.idempotencyCollection->insertOne(idempotencyRecord);
    }
}

isolated final PaymentStore paymentStore = checkpanic new ();

public isolated function findTransactionById(string transactionId) returns PaymentTransaction?|error {
    return check paymentStore.findTransactionById(transactionId);
}

public isolated function findTransactionByOrder(string orderId) returns PaymentTransaction?|error {
    return check paymentStore.findTransactionByOrder(orderId);
}

public isolated function findCapturedTransactionByOrder(string orderId) returns PaymentTransaction?|error {
    return check paymentStore.findCapturedTransactionByOrder(orderId);
}

public isolated function findByIdempotencyKey(string key) returns PaymentTransaction?|error {
    return check paymentStore.findByIdempotencyKey(key);
}

public isolated function persistCharge(PaymentTransaction payment) returns error? {
    check paymentStore.persistCharge(payment);
}

public isolated function persistRefund(PaymentTransaction payment) returns error? {
    check paymentStore.persistRefund(payment);
}
