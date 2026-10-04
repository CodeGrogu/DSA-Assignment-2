import ballerina/test;

@test:Config {}
function testValidateRestaurantRejectsDuplicateMenuItemIdsAcrossCategories() returns error? {
    Restaurant restaurant = {
        id: "R-101",
        name: "Test Bistro",
        address: "Main Road, Windhoek",
        location: {'type: "Point", coordinates: [17.0658d, -22.5333d]},
        contactNumber: "081-000-0000",
        menu: [
            {
                id: "C-1",
                name: "Main",
                items: [
                    {id: "I-1", name: "Burger", description: "Classic burger", price: 60.00d, taxRate: 0.15d,
                        dietaryAttributes: ["High-Protein"], stock: 5, isAvailable: true}
                ]
            },
            {
                id: "C-2",
                name: "Sides",
                items: [
                    {id: "I-1", name: "Fries", description: "Crispy fries", price: 25.00d, taxRate: 0.15d,
                        dietaryAttributes: ["Vegetarian"], stock: 10, isAvailable: true}
                ]
            }
        ]
    };

    string? validationError = validateRestaurant(restaurant);
    test:assertTrue(validationError is string, "Duplicate item IDs across categories should fail validation");
    test:assertTrue((<string>validationError).includes("duplicate menu item ID"),
            "Validation message should point to duplicate menu item ID");
}

@test:Config {}
function testValidateMenuItemRejectsUnavailableStockAsAvailable() returns error? {
    MenuItem item = {
        id: "I-2",
        name: "Out of stock item",
        description: "Item created with stock mismatch",
        price: 50.00d,
        taxRate: 0.15d,
        dietaryAttributes: [],
        stock: 0,
        isAvailable: true
    };

    string? validationError = validateMenuItem(item);
    test:assertTrue(validationError is string, "A true availability flag with zero stock should fail validation");
    test:assertTrue((<string>validationError).includes("stock"),
            "Validation message should mention the stock mismatch");
}

@test:Config {}
function testValidateRestaurantRejectsInvalidGeoJsonCoordinates() returns error? {
    Restaurant restaurant = {
        id: "R-102",
        name: "Invalid Geo",
        address: "No location",
        location: {'type: "Point", coordinates: [200.00d, -22.5333d]},
        contactNumber: "081-000-0001",
        menu: []
    };

    string? validationError = validateRestaurant(restaurant);
    test:assertTrue(validationError is string, "Longitude outside the valid range should fail validation");
    test:assertTrue((<string>validationError).includes("longitude"),
            "Validation message should mention the invalid longitude coordinate");
}
