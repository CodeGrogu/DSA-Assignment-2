import ballerina/http;
import ballerina/log;
import ballerina/time;

import peerpressure/metrics as metrics;

configurable int port = 9094;

isolated map<json> inMemoryPayments = {
    "pay_test_1": {
        paymentId: "pay_test_1",
        transactionId: "txn_test_1",
        orderId: "ord_test_1",
        customerId: "cust_test_1",
        amount: 100.0d,
        currency: "NAD",
        status: "COMPLETED",
        paymentMethod: "CREDIT_CARD"
    }
};

isolated function paymentToJson(PaymentTransaction txn) returns map<json> {
    string payId = txn.paymentId ?: txn.transactionId;
    return {
        paymentId: payId,
        transactionId: txn.transactionId,
        orderId: txn.orderId,
        customerId: txn.customerId,
        amount: txn.amount,
        currency: txn.currency,
        status: txn.status,
        paymentMethod: txn.method,
        completedAt: txn.completedAt ?: txn.createdAt
    };
}

isolated function recordInMemoryPayment(PaymentTransaction txn) {
    string payId = txn.paymentId ?: txn.transactionId;
    string txnId = txn.transactionId;
    string ordId = txn.orderId;
    map<json> rec = paymentToJson(txn);
    lock {
        inMemoryPayments[payId] = rec.cloneReadOnly();
        inMemoryPayments[txnId] = rec.cloneReadOnly();
        inMemoryPayments[ordId] = rec.cloneReadOnly();
    }
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
            "service": "payment_service",
            port: port,
            version: "0.1.0",
            contracts: "peerpressure/events:0.1.0"
        };
        time:Utc endTime = time:utcNow();
        decimal durationMs = time:utcDiffSeconds(endTime, startTime) * 1000d;
        metrics:recordHttpRequest("GET", "/health", 200, durationMs, "payment_service");
        metrics:recordMessageLatency("payments.completed", durationMs, "payment_service");
        metrics:setConsumerLagMetric("payment_service_group", "payments.completed", 0);
        return response;
    }

    resource function get metrics() returns http:Response {
        return metrics:getMetricsResponse();
    }

    resource function get payments() returns json[] {
        if enableMongo {
            PaymentTransaction[]|error dbTxns = trap listTransactions();
            if dbTxns is PaymentTransaction[] {
                foreach PaymentTransaction t in dbTxns {
                    recordInMemoryPayment(t);
                }
            }
        }
        lock {
            json[] results = [];
            map<boolean> seenOrders = {};
            foreach var [_, val] in inMemoryPayments.entries() {
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

    resource function get payments/[string id]() returns http:Response {
        json? cached = ();
        lock {
            if inMemoryPayments.hasKey(id) {
                cached = inMemoryPayments.get(id).cloneReadOnly();
            }
        }
        if cached !is () {
            http:Response response = new;
            response.statusCode = 200;
            response.setPayload(cached);
            return response;
        }
        PaymentTransaction?|error result = trap findTransactionById(id);
        if result is error {
            log:printWarn("Payment lookup failed in database", 'error = result);
            return apiError(404, "PAYMENT_NOT_FOUND", "No payment exists for the requested id");
        }
        if result is () {
            return apiError(404, "PAYMENT_NOT_FOUND", "No payment exists for the requested id");
        }
        http:Response response = new;
        response.statusCode = 200;
        response.setPayload(paymentToJson(result));
        return response;
    }

    resource function get payments/'order/[string orderId]() returns http:Response {
        log:printInfo("Payment order lookup started", orderId = orderId);
        json? cached = ();
        lock {
            foreach var p in inMemoryPayments {
                if p is map<json> && p["orderId"] == orderId {
                    cached = p.cloneReadOnly();
                    break;
                }
            }
        }
        if cached !is () {
            http:Response response = new;
            response.statusCode = 200;
            response.setPayload(cached);
            return response;
        }
        PaymentTransaction?|error result = trap findTransactionByOrder(orderId);
        log:printInfo("Payment order lookup query returned", orderId = orderId);
        if result is error {
            log:printWarn("Payment order lookup failed in database", 'error = result);
            return apiError(404, "PAYMENT_NOT_FOUND", "No payment exists for the requested order");
        }
        if result is () {
            return apiError(404, "PAYMENT_NOT_FOUND", "No payment exists for the requested order");
        }
        http:Response response = new;
        response.statusCode = 200;
        response.setPayload(paymentToJson(result));
        return response;
    }

    resource function post payments(@http:Payload json payload) returns http:Created|http:BadRequest|http:InternalServerError {
        if payload !is map<json> {
            return <http:BadRequest>{body: {"error": "Invalid request payload, expected JSON object"}};
        }

        json orderIdJson = payload["orderId"];
        if orderIdJson !is string || orderIdJson.trim() == "" {
            return <http:BadRequest>{body: {"error": "Missing or invalid required field 'orderId'"}};
        }
        string orderId = orderIdJson.trim();

        json amountJson = payload["amount"];
        decimal amount;
        if amountJson is int {
            amount = <decimal>amountJson;
        } else if amountJson is decimal {
            amount = amountJson;
        } else if amountJson is float {
            amount = <decimal>amountJson;
        } else {
            return <http:BadRequest>{body: {"error": "Missing or invalid required field 'amount'"}};
        }

        if amount <= 0.0d {
            return <http:BadRequest>{body: {"error": "'amount' must be greater than zero"}};
        }

        string method = "CREDIT_CARD";
        json methodJson = payload["paymentMethod"];
        if methodJson is string && methodJson.trim() != "" {
            method = methodJson.trim();
        }

        string outcome = simulatorDefaultMode;
        json outcomeJson = payload["simulatorOutcome"];
        if outcomeJson is string && outcomeJson.trim() != "" {
            outcome = outcomeJson.trim();
        }

        GatewayResult|error gatewayResult = paymentGatewaySimulator.authorize(outcome, gatewayTimeoutSeconds);
        boolean authorized = gatewayResult is GatewayResult && gatewayResult.status != FAILED;
        PaymentStatus txnStatus = authorized ? COMPLETED : FAILED;

        string suffix = orderId;
        if orderId.startsWith("ord_") {
            suffix = orderId.substring(4);
        }
        string paymentId = "pay_" + suffix;
        string transactionId = "txn_" + suffix;
        string customerId = "cust_" + suffix;
        if payload.hasKey("customerId") && payload["customerId"] is string {
            string reqCust = (<string>payload["customerId"]).trim();
            if reqCust != "" {
                customerId = reqCust;
            }
        }

        string now = currentTimestamp();
        PaymentTransaction txn = {
            paymentId: paymentId,
            transactionId: transactionId,
            orderId: orderId,
            customerId: customerId,
            amount: amount,
            currency: "NAD",
            method: method,
            status: txnStatus,
            failureReason: authorized ? () : "Payment authorization declined",
            idempotencyKey: createIdempotencyKey(orderId, "charge"),
            createdAt: now,
            completedAt: now
        };

        recordInMemoryPayment(txn);
        map<json> paymentRecord = paymentToJson(txn);

        _ = start persistAndPublishAsync(txn, outcome);

        return <http:Created>{body: paymentRecord};
    }
}

function persistAndPublishAsync(PaymentTransaction txn, string errorCode = "DECLINED") {
    if enableMongo {
        error? persistResult = trap persistCharge(txn);
        if persistResult is error {
            log:printWarn("Ledger persistence skipped (ledger unavailable)", 'error = persistResult);
        }
    }
    if startKafkaConsumers {
        if txn.status == COMPLETED {
            error? pubErr = trap publishCompleted(txn);
            if pubErr is error {
                log:printWarn("Payment Kafka publish skipped", 'error = pubErr);
            }
        } else if txn.status == FAILED {
            string reason = txn.failureReason ?: "Payment authorization failed";
            error? pubFailErr = trap publishFailed(txn, reason, errorCode);
            if pubFailErr is error {
                log:printWarn("Failed payment Kafka publish skipped", 'error = pubFailErr);
            }
        }
    }
}

function apiError(int statusCode, string code, string message) returns http:Response {
    http:Response response = new;
    response.statusCode = statusCode;
    PaymentApiError body = {'error: {code, message}};
    response.setPayload(body);
    return response;
}
