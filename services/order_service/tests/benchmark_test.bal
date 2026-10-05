import ballerina/io;
import ballerina/test;
import ballerina/time;

# Benchmark result captured per worker strand.
public type StrandBenchmarkResult record {|
    int workerId;
    boolean success;
    decimal latencyMs;
    decimal surgeMultiplier;
    decimal deliveryFee;
    string tier;
|};

# Sorts a decimal array in ascending numerical order.
#
# + input - Array of decimal values to sort
# + return - New sorted array of decimal values
isolated function sortDecimalLatencies(decimal[] input) returns decimal[] {
    decimal[] sorted = input.clone();
    int n = sorted.length();
    foreach int i in 0 ..< n {
        foreach int j in 0 ..< (n - i - 1) {
            if sorted[j] > sorted[j + 1] {
                decimal temp = sorted[j];
                sorted[j] = sorted[j + 1];
                sorted[j + 1] = temp;
            }
        }
    }
    return sorted;
}

# Worker function executed concurrently across Ballerina strands.
#
# + workerId - Identifier of the executing worker strand
# + unfulfilled - Simulated count of unfulfilled orders
# + drivers - Simulated count of available drivers
# + return - StrandBenchmarkResult containing latency and pricing quote
isolated function executeStrandPricingWorker(int workerId, int unfulfilled, int drivers) returns StrandBenchmarkResult {
    time:Utc strandStart = time:utcNow();

    PricingQuote quote = pricingEngine.getQuote(unfulfilled, drivers);
    decimal directMultiplier = calculateSurgeMultiplier(unfulfilled, drivers);
    decimal directDeliveryFee = calculateDeliveryFee(15.0d, directMultiplier);

    time:Utc strandEnd = time:utcNow();
    decimal latencyMs = time:utcDiffSeconds(strandEnd, strandStart) * 1000d;

    boolean isConsistent = (quote.surgeMultiplier == directMultiplier && quote.deliveryFee == directDeliveryFee);

    return {
        workerId: workerId,
        success: isConsistent,
        latencyMs: latencyMs,
        surgeMultiplier: quote.surgeMultiplier,
        deliveryFee: quote.deliveryFee,
        tier: quote.tier
    };
}

# Helper function to mutate pricing engine state in a worker strand.
#
# + unfulfilled - Unfulfilled orders count
# + drivers - Available drivers count
isolated function mutateSupplyDemand(int unfulfilled, int drivers) {
    pricingEngine.setSupplyDemand(unfulfilled, drivers);
}

# Helper function to read pricing engine quote in a worker strand.
#
# + return - Retrieved PricingQuote
isolated function readCurrentQuote() returns PricingQuote {
    return pricingEngine.getCurrentQuote();
}

# Subtask #48: 100-Client Concurrency Benchmark
# Simulates 100 concurrent workers requesting pricing quotes and calculating surge multipliers simultaneously
# using Ballerina strands. Measures min, max, avg, and p95 latency. Asserts 100% success rate and p95 latency < 50ms.
@test:Config {}
function testSurgePricing100ClientConcurrencyBenchmark() returns error? {
    int workerCount = 100;
    future<StrandBenchmarkResult>[] strandFutures = [];

    time:Utc benchmarkStartTime = time:utcNow();

    // Spawn 100 concurrent worker strands simulating multi-client load
    foreach int i in 0 ..< workerCount {
        // Distribute varying supply/demand ratios across tiers
        int unfulfilled = (i % 25) * 2;
        int drivers = (i % 10) + 1;
        future<StrandBenchmarkResult> f = start executeStrandPricingWorker(i, unfulfilled, drivers);
        strandFutures.push(f);
    }

    // Await all 100 strands and harvest execution records
    StrandBenchmarkResult[] collectedResults = [];
    foreach future<StrandBenchmarkResult> f in strandFutures {
        StrandBenchmarkResult r = check wait f;
        collectedResults.push(r);
    }

    time:Utc benchmarkEndTime = time:utcNow();
    decimal totalElapsedMs = time:utcDiffSeconds(benchmarkEndTime, benchmarkStartTime) * 1000d;

    // Verify 100% success rate
    int successCount = 0;
    decimal sumLatency = 0.0d;
    decimal minLatency = 999999.0d;
    decimal maxLatency = 0.0d;
    decimal[] latencies = [];

    foreach StrandBenchmarkResult res in collectedResults {
        if res.success {
            successCount += 1;
        }
        decimal lat = res.latencyMs;
        latencies.push(lat);
        sumLatency += lat;
        if lat < minLatency {
            minLatency = lat;
        }
        if lat > maxLatency {
            maxLatency = lat;
        }
    }

    decimal avgLatency = sumLatency / <decimal>workerCount;

    // Calculate P95 latency
    decimal[] sortedLatencies = sortDecimalLatencies(latencies);
    // Index 94 is the 95th element in a 0-indexed 100-element array
    decimal p95Latency = sortedLatencies[94];

    // Formatted benchmark telemetry output
    io:println("");
    io:println("==========================================================================");
    io:println("       SUBTASK #48: 100-CLIENT CONCURRENCY BENCHMARK TELEMETRY           ");
    io:println("==========================================================================");
    io:println(string `Total Strands Executed      : ${workerCount}`);
    io:println(string `Successful Executions       : ${successCount} / ${workerCount} (100.0%)`);
    io:println(string `Total Benchmark Wall Time   : ${totalElapsedMs} ms`);
    io:println(string `Min Strand Latency          : ${minLatency} ms`);
    io:println(string `Avg Strand Latency          : ${avgLatency} ms`);
    io:println(string `Max Strand Latency          : ${maxLatency} ms`);
    io:println(string `P95 Strand Latency          : ${p95Latency} ms`);
    io:println(string `Throughput                  : ${(<decimal>workerCount / (totalElapsedMs / 1000d))} ops/sec`);
    io:println("==========================================================================");
    io:println("");

    // Required assertions
    test:assertEquals(successCount, workerCount, "100% success rate required across all 100 concurrent workers");
    test:assertTrue(p95Latency < 50.0d, string `P95 latency (${p95Latency} ms) must be strictly below 50ms threshold`);
}

# Concurrent thread-safety stress test under heavy simultaneous mutation and read pressure.
@test:Config {}
function testConcurrentPricingEngineStateContention() returns error? {
    int threadPairs = 50;
    future<()>[] writeFutures = [];
    future<PricingQuote>[] readFutures = [];

    foreach int i in 0 ..< threadPairs {
        int targetUnfulfilled = i * 3;
        int targetDrivers = (i % 5) + 1;
        // Concurrent writers
        future<()> wf = start mutateSupplyDemand(targetUnfulfilled, targetDrivers);
        writeFutures.push(wf);
        // Concurrent readers
        future<PricingQuote> rf = start readCurrentQuote();
        readFutures.push(rf);
    }

    // Await all writers
    foreach future<()> wf in writeFutures {
        check wait wf;
    }

    // Await all readers
    foreach future<PricingQuote> rf in readFutures {
        PricingQuote q = check wait rf;
        test:assertTrue(q.surgeMultiplier >= 1.0d && q.surgeMultiplier <= 3.0d);
        test:assertTrue(q.deliveryFee >= 15.0d);
    }
}
