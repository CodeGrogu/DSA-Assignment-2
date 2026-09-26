import ballerina/test;

@test:Config {}
function testInsertCustomer() returns error? {
    Customer customer = {
        id: "TEST-CUST-002",
        name: "Test Customer",
        email: "test.customer2@example.com",
        phone: "+264810000001",
        addresses: []
    };

    check insertCustomer(customer);

    Customer result = check getCustomerById("TEST-CUST-002");

    test:assertEquals(result.id, customer.id);
    test:assertEquals(result.name, customer.name);
    test:assertEquals(result.email, customer.email);
}

@test:Config {}
function testGetCustomerById() returns error? {
    Customer customer = check getCustomerById("CUST-001");

    test:assertEquals(customer.id, "CUST-001");
    test:assertEquals(customer.name, "Amelia Shilongo");
    test:assertEquals(customer.email, "amelia.shilongo@example.com");
}

@test:Config {}
function testUpdateCustomerAddress() returns error? {
    CustomerAddress address = {
        id: "TEST-ADDR-001",
        tag: "Test",
        street: "1 Test Street",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "10000",
        location: {
            'type: "Point",
            coordinates: [17.0658, -22.5609]
        },
        deliveryInstructions: "Test delivery",
        isDefault: false
    };

    Customer testCustomer = {
        id: "TEST-CUST-UPDATE-001",
        name: "Update Test Customer",
        email: "update.test.001@example.com",
        phone: "+264810000002",
        addresses: []
    };

    check insertCustomer(testCustomer);

    check updateCustomerAddress("TEST-CUST-UPDATE-001", address);

    Customer customer = check getCustomerById("TEST-CUST-UPDATE-001");

    test:assertEquals(customer.addresses.length(), 1);
    test:assertEquals(customer.addresses[0].id, "TEST-ADDR-001");
}
