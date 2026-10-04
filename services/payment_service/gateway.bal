import ballerina/uuid;

# Defines the outcomes supported by the simulated payment gateway.
public enum GatewayMode {
    SUCCESS = "SUCCESS",
    INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS",
    NETWORK_TIMEOUT = "NETWORK_TIMEOUT",
    INVALID_CARD = "INVALID_CARD"
}

# Contains the result of a simulated payment authorization.
public type GatewayResult readonly & record {|
    boolean authorized;
    string transactionReference;
    string? errorCode = ();
    string? failureReason = ();
|};

public isolated function simulateAuthorization(decimal amount, GatewayMode mode) returns GatewayResult {
    string reference = uuid:createType1AsString();
    match mode {
        SUCCESS => {
            return {authorized: true, transactionReference: reference};
        }
        INSUFFICIENT_FUNDS => {
            return {
                authorized: false,
                transactionReference: reference,
                errorCode: "INSUFFICIENT_FUNDS",
                failureReason: "The payment method has insufficient funds"
            };
        }
        NETWORK_TIMEOUT => {
            return {
                authorized: false,
                transactionReference: reference,
                errorCode: "GATEWAY_TIMEOUT",
                failureReason: "The payment gateway did not respond in time"
            };
        }
        INVALID_CARD => {
            return {
                authorized: false,
                transactionReference: reference,
                errorCode: "INVALID_CARD",
                failureReason: "The payment card could not be validated"
            };
        }
    }
    return {
        authorized: false,
        transactionReference: reference,
        errorCode: "UNSUPPORTED_GATEWAY_OUTCOME",
        failureReason: "The configured payment gateway outcome is unsupported"
    };
}
