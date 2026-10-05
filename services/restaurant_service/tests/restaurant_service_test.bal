import ballerina/http;
import ballerina/test;
import ballerina/uuid;

import peerpressure/events as events;

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
                items: [{id: "I-1", name: "Burger", price: 45.00d, taxRate: 0.15d, stock: 3, isAvailable: true}]
            },
            {
                id: "C-2",
                name: "Desserts",
                items: [{id: "I-7", name: "Cake", price: 30.00d, taxRate: 0.15d, stock: 4, isAvailable: true}]
            }
        ]
    };

    test:assertTrue(isMenuItemIdUniqueAcrossRestaurant(restaurant, "I-7", "C-2"),
            "The exclusion should permit I-7 since it does not exist outside C-2");
    test:assertFalse(isMenuItemIdUniqueAcrossRestaurant(restaurant, "I-1", "C-2"),
            "I-1 exists in C-1, so exclusion of C-2 should not permit it");
    test:assertFalse(isMenuItemIdUniqueAcrossRestaurant(restaurant, "I-7"),
            "I-7 exists in the restaurant, so global check without exclusion should fail");
}

@test:Config {}
function testIsMenuItemIdUniqueAcrossRestaurantRejectsSameIdOutsideExcludedCategory() returns error? {
    Restaurant restaurant = {
        id: "R-103",
        name: "Category Exclusion Check",
        address: "Bismarck Street",
        location: {'type: "Point", coordinates: [17.0658d, -22.5333d]},
        contactNumber: "081-300-4000",
        menu: [
            {
                id: "C-1",
                name: "Mains",
                items: [{id: "I-9", name: "Burger", price: 45.00d, taxRate: 0.15d, stock: 3, isAvailable: true}]
            },
            {
                id: "C-2",
                name: "Desserts",
                items: [{id: "I-9", name: "Cake", price: 30.00d, taxRate: 0.15d, stock: 4, isAvailable: true}]
            }
        ]
    };

    test:assertFalse(isMenuItemIdUniqueAcrossRestaurant(restaurant, "I-9", "C-2"),
            "The same ID remains invalid when it still exists in a non-excluded category");
}

@test:Config {}
function testStockDecrementQueryIsConditionalAndCannotGoBelowZero() returns error? {
    string stockPath = "menu.0.items.1.stock";
    map<json> filter = buildStockDecrementFilter("R-103", "I-9", 2, 0, 1);
    map<json> update = buildStockDecrementUpdate(2, 0, 1);
    map<json> increments = <map<json>>update["$inc"];

    test:assertEquals(filter["id"], "R-103");
    test:assertEquals(filter["menu.0.items.1.id"], "I-9");
    test:assertEquals(filter[stockPath], {"$gte": 2},
                                         "The atomic update must match only when stock covers the requested quantity");
    test:assertEquals(increments[stockPath], -2,
            "The matching update must decrement stock atomically");
}

@test:Config {}
function testConfirmedKitchenOrderRejectsMissingItemsAndNonPositiveQuantities() returns error? {
    events:OrderConfirmedEvent emptyOrder = {
        eventId: "E-1",
        orderId: "O-1",
        restaurantId: "R-1",
        items: [],
        paymentId: "P-1",
        estimatedDeliveryMinutes: 20,
        confirmedAt: "2026-10-05T10:00:00Z"
    };
    test:assertTrue(validateConfirmedKitchenOrder(emptyOrder) is string,
            "Kitchen must reject confirmed orders without items");

    events:OrderConfirmedEvent invalidQuantityOrder = {
        eventId: "E-2",
        orderId: "O-2",
        restaurantId: "R-1",
        items: [{itemId: "I-1", itemName: "Meal", quantity: 0, unitPrice: 10.0d, subtotal: 0.0d}],
        paymentId: "P-2",
        estimatedDeliveryMinutes: 20,
        confirmedAt: "2026-10-05T10:00:00Z"
    };
    test:assertTrue(validateConfirmedKitchenOrder(invalidQuantityOrder) is string,
            "Kitchen must reject non-positive order quantities");
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

@test:Config {}
function testHealthEndpoint() returns error? {
    http:Client healthClient = check new (string `http://localhost:${port}`);
    http:Response response = check healthClient->get("/health");
    test:assertEquals(response.statusCode, 200, "Health endpoint should return HTTP 200 OK");

    json payload = check response.getJsonPayload();
    test:assertTrue(payload is map<json>, "Response payload should be a JSON map");
    map<json> payloadMap = <map<json>>payload;

    test:assertEquals(payloadMap["status"], "UP", "status should be UP");
    test:assertEquals(payloadMap["service"], "restaurant_service", "service should be restaurant_service");
    test:assertEquals(payloadMap["port"], 9095, "port should be 9095");
    test:assertEquals(payloadMap["version"], "0.1.0", "version should be 0.1.0");
    test:assertEquals(payloadMap["contracts"], "peerpressure/events:0.1.0", "contracts should be peerpressure/events:0.1.0");
}

@test:Config {}
function testValidateRestaurantPassesForValidOnboardingStructure() returns error? {
    Restaurant restaurant = {
        id: "R-999",
        name: "Savanna Grill",
        address: "42 Sam Nujoma Drive, Windhoek",
        location: {'type: "Point", coordinates: [17.0805d, -22.5608d]},
        contactNumber: "+264-81-555-0199",
        operatingHours: [
            {dayOfWeek: "Monday", openTime: "08:00", closeTime: "22:00", isClosed: false},
            {dayOfWeek: "Tuesday", openTime: "08:00", closeTime: "22:00", isClosed: false}
        ],
        holidayExceptions: [
            {date: "2026-12-25", isClosed: true}
        ],
        menu: [
            {
                id: "CAT-1",
                name: "Steaks",
                items: [
                    {
                        id: "ITEM-1",
                        name: "Sirloin 300g",
                        description: "Aged sirloin steak",
                        price: 180.00d,
                        taxRate: 0.15d,
                        dietaryAttributes: ["High-Protein", "Gluten-Free"],
                        stock: 20,
                        isAvailable: true
                    }
                ]
            }
        ]
    };

    string? validationError = validateRestaurant(restaurant);
    test:assertEquals(validationError, (), "Valid restaurant onboarding structure must pass validation without error");
}

@test:Config {}
function testValidateRestaurantFailsForInvalidMandatoryFields() returns error? {
    // 1. Missing / whitespace ID
    Restaurant rEmptyId = {
        id: "   ",
        name: "Savanna Grill",
        address: "42 Sam Nujoma Drive, Windhoek",
        location: {'type: "Point", coordinates: [17.0805d, -22.5608d]},
        contactNumber: "+264-81-555-0199"
    };
    string? errId = validateRestaurant(rEmptyId);
    test:assertTrue(errId is string, "Empty restaurant ID should fail validation");
    test:assertTrue((<string>errId).includes("ID"), "Error message should mention ID");

    // 2. Missing / whitespace name
    Restaurant rEmptyName = {
        id: "R-999",
        name: "   ",
        address: "42 Sam Nujoma Drive, Windhoek",
        location: {'type: "Point", coordinates: [17.0805d, -22.5608d]},
        contactNumber: "+264-81-555-0199"
    };
    string? errName = validateRestaurant(rEmptyName);
    test:assertTrue(errName is string, "Empty restaurant name should fail validation");
    test:assertTrue((<string>errName).includes("name"), "Error message should mention name");

    // 3. Missing / whitespace address
    Restaurant rEmptyAddress = {
        id: "R-999",
        name: "Savanna Grill",
        address: "   ",
        location: {'type: "Point", coordinates: [17.0805d, -22.5608d]},
        contactNumber: "+264-81-555-0199"
    };
    string? errAddress = validateRestaurant(rEmptyAddress);
    test:assertTrue(errAddress is string, "Empty restaurant address should fail validation");
    test:assertTrue((<string>errAddress).includes("address"), "Error message should mention address");

    // 4. Missing / whitespace contact number
    Restaurant rEmptyContact = {
        id: "R-999",
        name: "Savanna Grill",
        address: "42 Sam Nujoma Drive, Windhoek",
        location: {'type: "Point", coordinates: [17.0805d, -22.5608d]},
        contactNumber: "   "
    };
    string? errContact = validateRestaurant(rEmptyContact);
    test:assertTrue(errContact is string, "Empty restaurant contact number should fail validation");
    test:assertTrue((<string>errContact).includes("contact"), "Error message should mention contact");

    // 5. Operating hours with whitespace dayOfWeek
    Restaurant rInvalidOpHours = {
        id: "R-999",
        name: "Savanna Grill",
        address: "42 Sam Nujoma Drive, Windhoek",
        location: {'type: "Point", coordinates: [17.0805d, -22.5608d]},
        contactNumber: "+264-81-555-0199",
        operatingHours: [
            {dayOfWeek: "  ", openTime: "08:00", closeTime: "22:00", isClosed: false}
        ]
    };
    string? errOpHours = validateRestaurant(rInvalidOpHours);
    test:assertTrue(errOpHours is string, "Operating hours with whitespace dayOfWeek should fail validation");
    test:assertTrue((<string>errOpHours).includes("Operating hours"), "Error should mention Operating hours");

    // 6. Operating hours open without open/close times
    Restaurant rMissingTimes = {
        id: "R-999",
        name: "Savanna Grill",
        address: "42 Sam Nujoma Drive, Windhoek",
        location: {'type: "Point", coordinates: [17.0805d, -22.5608d]},
        contactNumber: "+264-81-555-0199",
        operatingHours: [
            {dayOfWeek: "Monday", openTime: "", closeTime: "", isClosed: false}
        ]
    };
    string? errTimes = validateRestaurant(rMissingTimes);
    test:assertTrue(errTimes is string, "Operating hours without times should fail validation");
}

@test:Config {}
function testValidateRestaurantFailsForInvalidGeoJsonBoundaries() returns error? {
    // 1. Non-Point type
    Restaurant rBadType = {
        id: "R-999",
        name: "Savanna Grill",
        address: "42 Sam Nujoma Drive, Windhoek",
        location: {'type: "Polygon", coordinates: [17.0805d, -22.5608d]},
        contactNumber: "+264-81-555-0199"
    };
    string? errType = validateRestaurant(rBadType);
    test:assertTrue(errType is string, "Non-Point GeoJSON type should fail validation");
    test:assertTrue((<string>errType).includes("GeoJSON Point"), "Error should mention GeoJSON Point");

    // 2. Latitude exceeding 90 degrees
    Restaurant rBadLatMax = {
        id: "R-999",
        name: "Savanna Grill",
        address: "42 Sam Nujoma Drive, Windhoek",
        location: {'type: "Point", coordinates: [17.0805d, 90.0001d]},
        contactNumber: "+264-81-555-0199"
    };
    string? errLatMax = validateRestaurant(rBadLatMax);
    test:assertTrue(errLatMax is string, "Latitude > 90 degrees should fail validation");
    test:assertTrue((<string>errLatMax).includes("latitude"), "Error should mention latitude");

    // 3. Latitude below -90 degrees
    Restaurant rBadLatMin = {
        id: "R-999",
        name: "Savanna Grill",
        address: "42 Sam Nujoma Drive, Windhoek",
        location: {'type: "Point", coordinates: [17.0805d, -90.0001d]},
        contactNumber: "+264-81-555-0199"
    };
    string? errLatMin = validateRestaurant(rBadLatMin);
    test:assertTrue(errLatMin is string, "Latitude < -90 degrees should fail validation");
    test:assertTrue((<string>errLatMin).includes("latitude"), "Error should mention latitude");

    // 4. Longitude below -180 degrees
    Restaurant rBadLonMin = {
        id: "R-999",
        name: "Savanna Grill",
        address: "42 Sam Nujoma Drive, Windhoek",
        location: {'type: "Point", coordinates: [-180.0001d, -22.5608d]},
        contactNumber: "+264-81-555-0199"
    };
    string? errLonMin = validateRestaurant(rBadLonMin);
    test:assertTrue(errLonMin is string, "Longitude < -180 degrees should fail validation");
    test:assertTrue((<string>errLonMin).includes("longitude"), "Error should mention longitude");

    // 5. Longitude exceeding 180 degrees
    Restaurant rBadLonMax = {
        id: "R-999",
        name: "Savanna Grill",
        address: "42 Sam Nujoma Drive, Windhoek",
        location: {'type: "Point", coordinates: [180.0001d, -22.5608d]},
        contactNumber: "+264-81-555-0199"
    };
    string? errLonMax = validateRestaurant(rBadLonMax);
    test:assertTrue(errLonMax is string, "Longitude > 180 degrees should fail validation");
    test:assertTrue((<string>errLonMax).includes("longitude"), "Error should mention longitude");
}

@test:Config {}
function testPlaceholderIdResolutionAndUuidGeneration() returns error? {
    string[] placeholders = ["", "   ", "placeholder", "auto", "<auto>", "{auto}", "default", "new", "null", "undefined", "0", "string", "temp", "none", "generate", "generated"];
    foreach string ph in placeholders {
        test:assertTrue(isPlaceholderId(ph), "String '" + ph + "' should be recognized as a placeholder ID");
        string generatedUuid = uuid:createType1AsString();
        test:assertTrue(generatedUuid.length() > 0, "Generated UUID must not be empty");
        test:assertFalse(isPlaceholderId(generatedUuid), "Generated UUID must not be considered a placeholder");
    }

    test:assertFalse(isPlaceholderId("R-101"), "Explicit restaurant ID 'R-101' must not be a placeholder");
    test:assertFalse(isPlaceholderId("savanna-grill"), "Explicit slug ID must not be a placeholder");
}

@test:Config {}
function testRestaurantOpenForOrderingRespectsExplicitWindow() returns error? {
    Restaurant restaurant = {
        id: "R-110",
        name: "Open Hours Check",
        address: "Market Street",
        location: {'type: "Point", coordinates: [17.0658d, -22.5333d]},
        contactNumber: "081-200-3000",
        operatingHours: [
            {dayOfWeek: "Monday", openTime: "08:00", closeTime: "18:00", isClosed: false},
            {dayOfWeek: "Tuesday", openTime: "09:00", closeTime: "17:00", isClosed: false}
        ]
    };

    test:assertTrue(isRestaurantOpenForOrdering(restaurant, "Monday", "09:30"),
            "The restaurant should be open during its configured Monday window");
    test:assertTrue(isRestaurantOpenForOrdering(restaurant, "Monday", "18:00"),
            "The closing boundary should still count as open");
    test:assertFalse(isRestaurantOpenForOrdering(restaurant, "Monday", "07:59"),
            "The restaurant should be closed before opening time");
    test:assertFalse(isRestaurantOpenForOrdering(restaurant, "Tuesday", "07:00"),
            "The restaurant should be closed outside its Tuesday schedule");
    test:assertTrue(validateRestaurantOpenForOrdering(restaurant, "Monday", "12:00") is (),
            "The validation helper should return nil when the restaurant is open");
    test:assertTrue(validateRestaurantOpenForOrdering(restaurant, "Friday", "12:00") is string,
            "The validation helper should reject ordering when no valid operating-hours row matches");
}

@test:Config {}
function testValidateRestaurantRejectsDuplicateCategoryIds() returns error? {
    Restaurant restaurant = {
        id: "R-105",
        name: "Category Dup",
        address: "Independence Ave",
        location: {'type: "Point", coordinates: [17.0658d, -22.5333d]},
        contactNumber: "081-123-4567",
        menu: [
            {id: "C-1", name: "Category One", items: []},
            {id: "C-1", name: "Category Two", items: []}
        ]
    };
    string? err = validateRestaurant(restaurant);
    test:assertTrue(err is string, "Duplicate category ID should fail validation");
    test:assertTrue((<string>err).includes("duplicate menu category ID"), "Error should mention duplicate menu category ID");
}

@test:Config {}
function testSeedDatabaseReturnsErrorGracefullyWhenMongoUnreachable() returns error? {
    error? err = seedDatabase();
    test:assertTrue(err is error, "seedDatabase should return an error when MongoDB is offline");
}

@test:Config {}
function testGetRestaurantsFailsGracefullyWhenMongoOffline() returns error? {
    http:Client clientEp = check new (string `http://localhost:${port}`, {timeout: 10});
    http:Response response = check clientEp->get("/restaurants");
    test:assertEquals(response.statusCode, 500, "Should return HTTP 500 when MongoDB is offline");
    json payload = check response.getJsonPayload();
    test:assertTrue(payload is map<json>, "Payload should be a JSON map");
    map<json> payloadMap = <map<json>>payload;
    test:assertTrue(payloadMap.hasKey("message"), "Payload should contain message property");
}

@test:Config {}
function testGetRestaurantByIdFailsGracefullyWhenMongoOffline() returns error? {
    http:Client clientEp = check new (string `http://localhost:${port}`, {timeout: 10});
    http:Response response = check clientEp->get("/restaurants/R001");
    test:assertEquals(response.statusCode, 500, "Should return HTTP 500 when MongoDB is offline");
    json payload = check response.getJsonPayload();
    test:assertTrue(payload is map<json>, "Payload should be a JSON map");
    map<json> payloadMap = <map<json>>payload;
    test:assertTrue(payloadMap.hasKey("message"), "Payload should contain message property");
}

@test:Config {}
function testPostSeedFailsGracefullyWhenMongoOffline() returns error? {
    http:Client clientEp = check new (string `http://localhost:${port}`, {timeout: 10});
    http:Response response = check clientEp->post("/seed", {});
    test:assertEquals(response.statusCode, 500, "Should return HTTP 500 when MongoDB is offline");
    json payload = check response.getJsonPayload();
    test:assertTrue(payload is map<json>, "Payload should be a JSON map");
    map<json> payloadMap = <map<json>>payload;
    test:assertTrue(payloadMap.hasKey("message"), "Payload should contain message property");
}
