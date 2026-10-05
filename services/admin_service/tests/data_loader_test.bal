import ballerina/test;

@test:Config {}
function testLoadSeedDefault() {
    json seed = loadSeed();
    test:assertTrue(seed is map<json>);

    json[] orders = loadOrders();
    test:assertTrue(orders.length() > 0);

    json[] payments = loadPayments();
    test:assertTrue(payments.length() > 0);

    json[] deliveries = loadDeliveries();
    test:assertTrue(deliveries.length() > 0);
}

@test:Config {}
function testLoadSeedAbsentFile() {
    json seed = loadSeed("non_existent_seed_file.json");
    test:assertTrue(seed is map<json>);
    if seed is map<json> {
        test:assertEquals(seed.length(), 0);
    }

    json[] orders = loadOrders("non_existent_seed_file.json");
    test:assertEquals(orders.length(), 0);

    json[] payments = loadPayments("non_existent_seed_file.json");
    test:assertEquals(payments.length(), 0);

    json[] deliveries = loadDeliveries("non_existent_seed_file.json");
    test:assertEquals(deliveries.length(), 0);
}

@test:Config {}
function testLoadSeedCorruptFile() {
    // Ballerina.toml contains TOML syntax which is invalid JSON
    json seed = loadSeed("Ballerina.toml");
    test:assertTrue(seed is map<json>);
    if seed is map<json> {
        test:assertEquals(seed.length(), 0);
    }

    json[] orders = loadOrders("Ballerina.toml");
    test:assertEquals(orders.length(), 0);

    json[] payments = loadPayments("Ballerina.toml");
    test:assertEquals(payments.length(), 0);

    json[] deliveries = loadDeliveries("Ballerina.toml");
    test:assertEquals(deliveries.length(), 0);
}
