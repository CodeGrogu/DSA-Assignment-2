import ballerina/http;
import ballerina/test;
import ballerina/time;

@test:Config {}
function testGatewaySuccessAndRejectedPayments() {
    GatewayResult|error success = paymentGatewaySimulator.authorize("SUCCESS", 0);
    test:assertTrue(success is GatewayResult && success.status == COMPLETED);

    GatewayResult|error insufficientFunds = paymentGatewaySimulator.authorize("INSUFFICIENT_FUNDS", 0);
    test:assertTrue(insufficientFunds is GatewayResult && insufficientFunds.status == FAILED);
    if insufficientFunds is GatewayResult {
        test:assertEquals(insufficientFunds.failureReason, "Insufficient funds");
    }

    GatewayResult|error invalidCard = paymentGatewaySimulator.authorize("INVALID_CARD", 0);
    test:assertTrue(invalidCard is GatewayResult && invalidCard.status == FAILED);
    if invalidCard is GatewayResult {
        test:assertEquals(invalidCard.failureReason, "Card is invalid");
    }
    GatewayResult|error suspectedFraud = paymentGatewaySimulator.authorize("FRAUD_SUSPECTED", 0);
    test:assertTrue(suspectedFraud is GatewayResult && suspectedFraud.status == FAILED);
    if suspectedFraud is GatewayResult {
        test:assertEquals(suspectedFraud.failureReason, "Fraud verification failed");
    }
}

@test:Config {}
function testGatewayTimeoutReturnsError() {
    GatewayResult|error result = paymentGatewaySimulator.authorize("NETWORK_TIMEOUT", 1);
    test:assertTrue(result is error);
}

@test:Config {}
function testCurrencyAndIdempotencyRules() {
    test:assertTrue(isSupportedCurrency("NAD"));
    test:assertTrue(isSupportedCurrency("USD"));
    test:assertFalse(isSupportedCurrency("EUR"));
    test:assertEquals(createIdempotencyKey("order-42", "charge"), "charge:order-42");
    test:assertEquals(createIdempotencyKey("order-42", "refund"), "refund:order-42");
    test:assertFalse(isDuplicate(()));
    PaymentTransaction savedPayment = {
        transactionId: "order-42-charge",
        orderId: "order-42",
        customerId: "customer-9",
        amount: 125.50,
        currency: "NAD",
        method: "CARD",
        status: COMPLETED,
        idempotencyKey: "charge:order-42",
        createdAt: "2026-10-04T12:00:00Z"
    };
    test:assertTrue(isDuplicate(savedPayment));
}

@test:Config {}
function testPaymentTimestampsAreRfc3339() {
    time:Civil|time:Error timestamp = time:civilFromString(currentTimestamp());
    test:assertTrue(timestamp is time:Civil);
}

@test:Config {}
function testChargeAndRefundLedgerEntriesAreInsertOnlyReversals() {
    PaymentTransaction payment = {
        transactionId: "order-42-charge",
        orderId: "order-42",
        customerId: "customer-9",
        amount: 125.50,
        currency: "NAD",
        method: "CARD",
        status: COMPLETED,
        idempotencyKey: "charge:order-42",
        createdAt: "2026-10-04T12:00:00Z"
    };
    LedgerEntry[] chargeEntries = makeLedgerEntries(payment, false);
    LedgerEntry[] refundEntries = makeLedgerEntries(payment, true);
    test:assertEquals(chargeEntries.length(), 2);
    test:assertEquals(chargeEntries[0].entryType, DEBIT);
    test:assertEquals(chargeEntries[1].entryType, CREDIT);
    test:assertEquals(refundEntries[0].entryType, CREDIT);
    test:assertEquals(refundEntries[1].entryType, DEBIT);
    test:assertEquals(refundEntries[0].transactionId, payment.transactionId);
}

@test:Config {}
function testCreateAndGetPayment() returns error? {
    http:Client clientEp = check new (string `http://localhost:${port}`);
    json createPayload = {
        orderId: "ord_unit_1",
        amount: 75.50d,
        paymentMethod: "CREDIT_CARD"
    };
    http:Response createResp = check clientEp->post("/payments", createPayload);
    test:assertEquals(createResp.statusCode, 201);
    json createBody = check createResp.getJsonPayload();
    test:assertTrue(createBody is map<json>);
    map<json> bodyMap = <map<json>>createBody;
    test:assertEquals(bodyMap["orderId"], "ord_unit_1");
    test:assertEquals(bodyMap["status"], "SUCCESS");
    test:assertEquals(bodyMap["currency"], "NAD");

    http:Response getResp = check clientEp->get("/payments/pay_unit_1");
    test:assertEquals(getResp.statusCode, 200);
    json getBody = check getResp.getJsonPayload();
    test:assertTrue(getBody is map<json>);
    map<json> getMap = <map<json>>getBody;
    test:assertEquals(getMap["orderId"], "ord_unit_1");
    test:assertEquals(getMap["status"], "SUCCESS");
}

@test:Config {}
function testCreatePaymentValidation() returns error? {
    http:Client clientEp = check new (string `http://localhost:${port}`);
    json invalidOrderPayload = {
        orderId: "",
        amount: 50.0d
    };
    http:Response badResp1 = check clientEp->post("/payments", invalidOrderPayload);
    test:assertEquals(badResp1.statusCode, 400);

    json invalidAmountPayload = {
        orderId: "ord_val_1",
        amount: -5.0d
    };
    http:Response badResp2 = check clientEp->post("/payments", invalidAmountPayload);
    test:assertEquals(badResp2.statusCode, 400);
}

