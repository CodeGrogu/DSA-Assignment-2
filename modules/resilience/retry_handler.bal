import ballerina/lang.'runtime as runtime;
import ballerina/lang.'string as strings;
import ballerina/log;

import peerpressure/kafka_client;

# Determines whether an error is transient (temporary network/broker glitch) or permanent (poison pill, validation failure).
#
# + err - The error to inspect
# + return - `true` if transient and eligible for retry, `false` otherwise
public isolated function isTransient(error err) returns boolean {
    if err is kafka_client:DeserializationError {
        return false;
    }

    string msg = strings:toLowerAscii(err.message());

    // Explicit non-transient conditions (fail-fast)
    if msg.includes("syntax") || msg.includes("validation") ||
        msg.includes("illegal") || msg.includes("disallowed") ||
        msg.includes("bad request") || msg.includes("not found") ||
        msg.includes("unauthorized") || msg.includes("forbidden") ||
        msg.includes("invalid payload") || msg.includes("deserialization") {
        return false;
    }

    // Explicit transient conditions
    if msg.includes("connection") || msg.includes("timeout") ||
        msg.includes("network") || msg.includes("refused") ||
        msg.includes("reset") || msg.includes("unavailable") ||
        msg.includes("leader") || msg.includes("temporary") ||
        msg.includes("503") || msg.includes("504") ||
        msg.includes("busy") || msg.includes("econnrefused") {
        return true;
    }

    // Default to transient for generic I/O or client communication errors unless explicitly permanent
    return true;
}

# Calculates exponential backoff delay in seconds for a given attempt.
#
# + attempt - 1-based attempt number
# + policy - Retry policy configuration
# + return - Backoff duration in seconds
public isolated function calculateBackoff(int attempt, RetryPolicy policy) returns decimal {
    decimal delay = policy.initialBackoffSeconds;
    int exponent = attempt - 1;
    int i = 0;
    while i < exponent {
        delay = delay * policy.backoffMultiplier;
        i += 1;
    }
    if delay > policy.maxBackoffSeconds {
        return policy.maxBackoffSeconds;
    }
    return delay;
}

# Executes an operation with exponential backoff retries for transient failures.
# Non-transient errors (such as deserialization or validation errors) bypass the retry loop immediately.
#
# + operation - The function to execute
# + policy - Retry policy settings
# + return - `()` on eventual success, or the error if non-transient or exhausted
public isolated function executeWithRetry(isolated function () returns error? operation, RetryPolicy policy = {}) returns error? {
    int attempt = 0;
    int maxAttempts = policy.maxAttempts;
    string lastError = "";

    while attempt < maxAttempts {
        attempt += 1;
        error? result = operation();
        if result is () {
            return;
        }

        lastError = result.message();
        boolean transient = isTransient(result);

        // Fail-fast on non-transient errors (poison pills, schema violations)
        if !transient {
            log:printWarn("Non-transient error encountered; bypassing retry loop",
                    attempt = attempt,
                    'error = result
            );
            return result;
        }

        if attempt < maxAttempts {
            decimal backoff = calculateBackoff(attempt, policy);
            log:printWarn("Transient error encountered; retrying after backoff",
                    attempt = attempt,
                    maxAttempts = maxAttempts,
                    backoffSeconds = backoff,
                    'error = result
            );
            runtime:sleep(backoff);
        }
    }

    return error RetryExhaustedError("Operation failed after maximum retry attempts",
        attemptsMade = attempt,
        lastExceptionMessage = lastError,
        isTransient = true
    );
}
