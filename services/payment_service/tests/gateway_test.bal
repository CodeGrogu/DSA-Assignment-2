import ballerina/test;

@test:Config {}
function testGatewaySuccess() {
    GatewayResult result = simulateAuthorization(25.50, SUCCESS);
    test:assertTrue(result.authorized);
    test:assertTrue(result.transactionReference.length() > 0);
    test:assertEquals(result.errorCode, ());
}

@test:Config {}
function testGatewayFailureModes() {
    GatewayResult insufficientFunds = simulateAuthorization(25.50, INSUFFICIENT_FUNDS);
    test:assertFalse(insufficientFunds.authorized);
    test:assertEquals(insufficientFunds.errorCode, "INSUFFICIENT_FUNDS");

    GatewayResult timeout = simulateAuthorization(25.50, NETWORK_TIMEOUT);
    test:assertFalse(timeout.authorized);
    test:assertEquals(timeout.errorCode, "GATEWAY_TIMEOUT");

    GatewayResult invalidCard = simulateAuthorization(25.50, INVALID_CARD);
    test:assertFalse(invalidCard.authorized);
    test:assertEquals(invalidCard.errorCode, "INVALID_CARD");
}
