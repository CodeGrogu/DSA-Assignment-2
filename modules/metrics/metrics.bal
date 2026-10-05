import ballerina/http;

public type MetricType "COUNTER"|"GAUGE"|"HISTOGRAM";

public type MetricSample record {|
    string name;
    string help;
    MetricType metricType;
    decimal value = 0d;
    map<string> labels = {};
    int[] buckets = [10, 50, 100, 250, 500, 1000, 5000];
    int[] bucketCounts = [0, 0, 0, 0, 0, 0, 0];
    int count = 0;
    decimal sum = 0d;
|};

public class MetricsRegistry {
    private map<MetricSample> metrics = {};
    private map<int> consumerLag = {};

    isolated function seriesKey(string name, map<string> labels) returns string {
        return name + self.formatLabels(labels);
    }

    public function incrementCounter(string name, string help, map<string>? labels = ()) {
        lock {
            map<string> resolvedLabels = (labels ?: {}).clone();
            string key = self.seriesKey(name, resolvedLabels);
            MetricSample metric = self.metrics[key] ?: {
                name: name,
                help: help,
                metricType: "COUNTER",
                value: 0d,
                labels: resolvedLabels,
                buckets: [10, 50, 100, 250, 500, 1000, 5000],
                bucketCounts: [0, 0, 0, 0, 0, 0, 0],
                count: 0,
                sum: 0d
            };
            metric.value += 1d;
            self.metrics[key] = metric;
        }
    }

    public function setGauge(string name, string help, decimal value, map<string>? labels = ()) {
        lock {
            map<string> resolvedLabels = (labels ?: {}).clone();
            string key = self.seriesKey(name, resolvedLabels);
            MetricSample metric = {
                name: name,
                help: help,
                metricType: "GAUGE",
                value: value,
                labels: resolvedLabels,
                buckets: [10, 50, 100, 250, 500, 1000, 5000],
                bucketCounts: [0, 0, 0, 0, 0, 0, 0],
                count: 0,
                sum: 0d
            };
            self.metrics[key] = metric;
        }
    }

    public function observeLatency(string name, string help, decimal latencyMs, map<string>? labels = ()) {
        lock {
            map<string> resolvedLabels = (labels ?: {}).clone();
            string key = self.seriesKey(name, resolvedLabels);
            MetricSample metric = self.metrics[key] ?: {
                name: name,
                help: help,
                metricType: "HISTOGRAM",
                value: 0d,
                labels: resolvedLabels,
                buckets: [10, 50, 100, 250, 500, 1000, 5000],
                bucketCounts: [0, 0, 0, 0, 0, 0, 0],
                count: 0,
                sum: 0d
            };
            metric.value = latencyMs;
            metric.count += 1;
            metric.sum += latencyMs;
            int idx = 0;
            while idx < metric.buckets.length() {
                if latencyMs <= <decimal>metric.buckets[idx] {
                    metric.bucketCounts[idx] = metric.bucketCounts[idx] + 1;
                }
                idx += 1;
            }
            self.metrics[key] = metric;
        }
    }

    public function setConsumerLag(string consumerGroup, string topic, int lag) {
        lock {
            self.consumerLag[string `${consumerGroup}:${topic}`] = lag;
        }
    }

    public function exportPrometheus() returns string {
        lock {
            string output = "";
            map<boolean> emittedHeader = {};
            foreach MetricSample metric in self.metrics {
                if !emittedHeader.hasKey(metric.name) {
                    emittedHeader[metric.name] = true;
                    output += string `# HELP ${metric.name} ${metric.help}
`;
                    output += string `# TYPE ${metric.name} ${metric.metricType.toLowerAscii()}
`;
                }

                string labelsText = self.formatLabels(metric.labels);
                if metric.metricType == "COUNTER" || metric.metricType == "GAUGE" {
                    output += string `${metric.name}${labelsText} ${metric.value}
`;
                } else {
                    string extraLabels = self.formatExtraLabels(metric.labels);
                    int idx = 0;
                    while idx < metric.buckets.length() {
                        int bucket = metric.buckets[idx];
                        int bCount = metric.bucketCounts[idx];
                        output += string `${metric.name}_bucket{le="${bucket}"${extraLabels}} ${bCount}
`;
                        idx += 1;
                    }
                    output += string `${metric.name}_bucket{le="+Inf"${extraLabels}} ${metric.count}
`;
                    output += string `${metric.name}_sum${labelsText} ${metric.sum}
`;
                    output += string `${metric.name}_count${labelsText} ${metric.count}
`;
                }
            }

            if self.consumerLag.length() > 0 {
                output += "# HELP kafka_consumer_lag Consumer lag reported per consumer group and topic\n";
                output += "# TYPE kafka_consumer_lag gauge\n";
                foreach var [key, lag] in self.consumerLag.entries() {
                    output += string `kafka_consumer_lag{group_topic="${key}"} ${lag}
`;
                }
            }

            return output;
        }
    }

    public function reset() {
        lock {
            self.metrics = {};
            self.consumerLag = {};
        }
    }

    isolated function formatLabels(map<string> labels, string? le = ()) returns string {
        string[] parts = [];
        if le is string {
            parts.push(string `le="${le}"`);
        }
        foreach var [key, value] in labels.entries() {
            parts.push(string `${key}="${value}"`);
        }
        if parts.length() == 0 {
            return "";
        }
        return "{" + string:'join(", ", ...parts) + "}";
    }

    isolated function formatExtraLabels(map<string> labels) returns string {
        if labels.length() == 0 {
            return "";
        }
        string[] parts = [];
        foreach var [key, value] in labels.entries() {
            parts.push(string `${key}="${value}"`);
        }
        return ", " + string:'join(", ", ...parts);
    }
}

public final MetricsRegistry globalMetricsRegistry = new ();

public function recordHttpRequest(string method, string path, int statusCode, decimal durationMs, string serviceName = "") {
    map<string> labels = {
        "method": method,
        "path": path,
        "status": statusCode.toString(),
        "service": serviceName
    };
    globalMetricsRegistry.incrementCounter("http_requests_total", "Total HTTP requests processed", labels);
    globalMetricsRegistry.setGauge("http_request_duration_ms", "HTTP request latency in milliseconds", durationMs, labels);
}

public function recordMessageLatency(string topic, decimal latencyMs, string serviceName = "") {
    globalMetricsRegistry.observeLatency(
        "message_processing_latency_ms",
        "Message processing latency in milliseconds",
        latencyMs,
        {"topic": topic, "service": serviceName}
    );
}

public function setConsumerLagMetric(string consumerGroup, string topic, int lag) {
    globalMetricsRegistry.setConsumerLag(consumerGroup, topic, lag);
}

public function getMetricsResponse() returns http:Response {
    http:Response response = new;
    response.setTextPayload(globalMetricsRegistry.exportPrometheus(), "text/plain; version=0.0.4");
    response.statusCode = 200;
    return response;
}
