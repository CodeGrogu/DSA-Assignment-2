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
                    {
                        id: "I-1",
                        name: "Burger",
                        description: "Classic burger",
                        price: 60.00d,
                        taxRate: 0.15d,
                        dietaryAttributes: ["High-Protein"],
                        stock: 5,
                        isAvailable: true
                    }
                ]
            },
            {
                id: "C-2",
                name: "Sides",
                items: [
                    {
                        id: "I-1",
                        name: "Fries",
                        description: "Crispy fries",
                        price: 25.00d,
                        taxRate: 0.15d,
                        dietaryAttributes: ["Vegetarian"],
                        stock: 10,
                        isAvailable: true
                    }
                ]
            }
        ]
    };

    string? validationError = validateRestaurant(restaurant);
    test:assertTrue(validationError is string, "Duplicate item IDs across categories should fail validation");
    test:assertTrue((<string>validationError).includes("duplicate menu item ID"),
            "Validation message should point to duplicate menu item ID");
    test:assertFalse(isMenuItemIdUniqueAcrossRestaurant(restaurant, "I-1"),
            "The helper should recognize the same item ID already exists in another category");
}

@test:Config {}
function testIsMenuItemIdUniqueAcrossRestaurantAllowsSameIdInDifferentCategoryWhenExcluded() returns error? {
    Restaurant restaurant = {
        id: "R-102",
        name: "Category Check",
        address: "Long Street",
        location: {'type: "Point", coordinates: [17.0658d, -22.5333d]},
        contactNumber: "081-100-2000",
        menu: [
            {
                id: "C-1",
                name: "Mains",
                items: [{id: "I-7", name: "Burger", price: 45.00d, taxRate: 0.15d, stock: 3, isAvailable: true}]
            },
            {
                id: "C-2",
                name: "Desserts",
                items: [{id: "I-7", name: "Cake", price: 30.00d, taxRate: 0.15d, stock: 4, isAvailable: true}]
            }
        ]
    };

    test:assertFalse(isMenuItemIdUniqueAcrossRestaurant(restaurant, "I-7"),
            "A duplicate item ID should still fail globally even when the value repeats across categories");
    test:assertTrue(isMenuItemIdUniqueAcrossRestaurant(restaurant, "I-7", "C-2"),
            "The exclusion should permit a same-ID check when ignoring the current category being updated");
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
