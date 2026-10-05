import ballerina/http;
import ballerina/log;
import ballerina/observe;

isolated function recordHttpRequest(string method, string path, int statusCode, decimal durationMs, string serviceName) {
    map<string> tags = {
        method,
        path,
        status: statusCode.toString(),
        "service": serviceName
    };
    observe:Counter|error counterResult = getOrCreateCounter("http_requests_total", tags);
    if counterResult is observe:Counter {
        counterResult.increment();
    } else {
        log:printError("Failed to record HTTP request metric", counterResult);
    }

    observe:Gauge|error durationResult = getOrCreateGauge("http_request_duration_milliseconds", tags);
    if durationResult is observe:Gauge {
        durationResult.setValue(<float>durationMs);
    } else {
        log:printError("Failed to record HTTP request duration metric", durationResult);
    }
}

isolated function recordMessageLatency(string topic, decimal durationMs, string serviceName) {
    map<string> tags = {topic, "service": serviceName};
    observe:Gauge|error metricResult = getOrCreateGauge("message_latency_milliseconds", tags);
    if metricResult is observe:Gauge {
        metricResult.setValue(<float>durationMs);
    } else {
        log:printError("Failed to record message latency metric", metricResult);
    }
}

isolated function setConsumerLagMetric(string groupId, string topic, int lag) {
    map<string> tags = {group: groupId, topic};
    observe:Gauge|error metricResult = getOrCreateGauge("kafka_consumer_lag", tags);
    if metricResult is observe:Gauge {
        metricResult.setValue(<float>lag);
    } else {
        log:printError("Failed to set Kafka consumer lag metric", metricResult);
    }
}



isolated function getOrCreateCounter(string name, map<string> tags) returns observe:Counter|error {
    observe:Counter|observe:Gauge? currentMetric = observe:lookupMetric(name, tags = tags);
    if currentMetric is observe:Counter {
        return currentMetric;
    }
    if currentMetric is observe:Gauge {
        return error("Metric name is already registered as a gauge: " + name);
    }

    observe:Counter counter = new (name, tags = tags);
    error? registrationError = counter.register();
    if registrationError is error {
        observe:Counter|observe:Gauge? registeredMetric = observe:lookupMetric(name, tags = tags);
        if registeredMetric is observe:Counter {
            return registeredMetric;
        }
        return registrationError;
    }
    return counter;
}

isolated function getOrCreateGauge(string name, map<string> tags) returns observe:Gauge|error {
    observe:Counter|observe:Gauge? currentMetric = observe:lookupMetric(name, tags = tags);
    if currentMetric is observe:Gauge {
        return currentMetric;
    }
    if currentMetric is observe:Counter {
        return error("Metric name is already registered as a counter: " + name);
    }

    observe:Gauge gauge = new (name, tags = tags);
    error? registrationError = gauge.register();
    if registrationError is error {
        observe:Counter|observe:Gauge? registeredMetric = observe:lookupMetric(name, tags = tags);
        if registeredMetric is observe:Gauge {
            return registeredMetric;
        }
        return registrationError;
    }
    return gauge;
}
