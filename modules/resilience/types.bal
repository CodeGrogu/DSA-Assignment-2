# Configuration policy for retrying operations.
public type RetryPolicy record {|
    # Maximum number of retry attempts before giving up.
    int maxAttempts = 3;
    # Initial backoff duration in seconds.
    decimal initialBackoffSeconds = 1.0;
    # Backoff multiplier for exponential growth (e.g. 2.0 yields 1s, 2s, 4s).
    decimal backoffMultiplier = 2.0;
    # Maximum ceiling for backoff in seconds.
    decimal maxBackoffSeconds = 30.0;
|};

# Error detail for exhausted retry attempts.
public type RetryExhaustedDetail record {|
    # Number of attempts completed before aborting.
    int attemptsMade;
    # Underlying exception message from the last attempt.
    string lastExceptionMessage;
    # Whether the failure was classified as transient.
    boolean isTransient;
|};

# Distinct error returned when retry policy attempts are completely exhausted.
public type RetryExhaustedError distinct error<RetryExhaustedDetail>;

# Diagnostic context accompanying an unprocessable message routed to a Dead Letter Queue.
public type DlqContext record {|
    # Source topic from which the failed record originated.
    string sourceTopic;
    # Original Kafka partition index.
    int originalPartition = 0;
    # Original Kafka offset of the record.
    int originalOffset = 0;
    # Number of retry attempts made prior to routing to DLQ.
    int retryCount = 0;
    # Diagnostic error or exception message explaining why processing failed.
    string exceptionMessage;
    # Timestamp formatted string when DLQ routing occurred.
    string timestamp;
|};
