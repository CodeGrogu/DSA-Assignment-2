import ballerina/log;
import ballerinax/mongodb;

configurable string mongoHost = "mongodb";
configurable int mongoPort = 27017;
configurable string mongoUser = "restaurant_user";
configurable string mongoPassword = "restaurant_password";
configurable string mongoAuthSource = "restaurant_db";
configurable string mongoReplicaSet = "rs0";
configurable string databaseName = "restaurant_db";
configurable int mongoServerSelectionTimeoutMs = 2000;

final string mongoConnectionString = string `mongodb://${mongoUser}:${mongoPassword}@${mongoHost}:${mongoPort}/${databaseName}?authSource=${mongoAuthSource}&replicaSet=${mongoReplicaSet}&serverSelectionTimeoutMS=${mongoServerSelectionTimeoutMs}`;

isolated function getMongoClient() returns mongodb:Client|error {
    do {
        return check new ({connection: mongoConnectionString});
    } on fail error err {
        log:printError("Failed to initialize MongoDB client: " + err.message(), err);
        return err;
    }
}

isolated function getRestaurantsCollection() returns mongodb:Collection|error {
    do {
        mongodb:Client mongoClient = check getMongoClient();
        mongodb:Database restaurantDb = check mongoClient->getDatabase(databaseName);
        return check restaurantDb->getCollection("restaurants");
    } on fail error err {
        log:printError("Failed to access restaurants collection: " + err.message(), err);
        return err;
    }
}

isolated function decrementMenuItemStock(string restaurantId, string itemId, int quantity) returns boolean|error {
    if quantity <= 0 {
        return false;
    }
    mongodb:Collection collection = check getRestaurantsCollection();
    
    map<json> filter = {
        "id": restaurantId,
        "menu.items.id": itemId,
        "menu.items": {
            "$elemMatch": {
                "id": itemId,
                "stock": {"$gte": quantity}
            }
        }
    };
    
    map<json> updateMap = {"$inc": {"menu.items.$.stock": -quantity}};
    mongodb:Update update = check updateMap.cloneWithType();
    
    mongodb:UpdateResult result = check collection->updateOne(filter, update);
    return result.modifiedCount == 1;
}

isolated function incrementMenuItemStock(string restaurantId, string itemId, int quantity) returns boolean|error {
    if quantity <= 0 {
        return false;
    }
    mongodb:Collection collection = check getRestaurantsCollection();
    
    map<json> filter = {
        "id": restaurantId,
        "menu.items.id": itemId
    };
    
    map<json> updateMap = {"$inc": {"menu.items.$.stock": quantity}};
    mongodb:Update update = check updateMap.cloneWithType();
    
    mongodb:UpdateResult result = check collection->updateOne(filter, update);
    return result.modifiedCount == 1;
}



public isolated function seedDatabase() returns error? {
    do {
        mongodb:Collection restaurantsCollection = check getRestaurantsCollection();

        // Check if empty
        int count = check restaurantsCollection->countDocuments({});
        if count > 0 {
            log:printInfo("Database already connected.");
            return;
        }

        log:printInfo("Connected to database. ");

        Restaurant[] seedRestaurants = [
            {
                id: "R001",
                name: "Kapana Corner",
                address: "Single Quarters, Katutura, Windhoek",
                location: {'type: "Point", coordinates: [17.0658d, -22.5333d]},
                contactNumber: "081-111-2222",
                operatingHours: [
                    {dayOfWeek: "Monday", openTime: "08:00", closeTime: "20:00"},
                    {dayOfWeek: "Tuesday", openTime: "08:00", closeTime: "20:00"}
                ],
                menu: [
                    {
                        id: "C1",
                        name: "Street Food",
                        items: [
                            {id: "M1", name: "Beef Kapana", description: "Grilled beef strips with spice", price: 50.00d, taxRate: 0.15d, dietaryAttributes: ["High-Protein"], stock: 42},
                            {id: "M2", name: "Vetkoek (Fat Cake)", description: "Deep fried dough bread", price: 10.00d, taxRate: 0.15d, dietaryAttributes: ["Vegetarian"], stock: 35},
                            {id: "M3", name: "Salsa", description: "Tomato and onion salsa", price: 15.00d, taxRate: 0.15d, dietaryAttributes: ["Vegan", "Gluten-Free"], stock: 60},
                            {id: "M4", name: "Roosterkoek", description: "Bread baked on a grid", price: 20.00d, taxRate: 0.15d, dietaryAttributes: ["Vegetarian"], stock: 45},
                            {id: "M5", name: "Pork Kapana", description: "Grilled pork strips", price: 60.00d, taxRate: 0.15d, dietaryAttributes: [], stock: 30},
                            {id: "M6", name: "Oshikundu", description: "Traditional fermented drink", price: 25.00d, taxRate: 0.15d, dietaryAttributes: ["Vegetarian"], stock: 70}
                        ]
                    }
                ]
            },
            {
                id: "R002",
                name: "Namibian Potjie Kitchen",
                address: "Independence Ave, Windhoek",
                location: {'type: "Point", coordinates: [17.0836d, -22.5601d]},
                contactNumber: "081-333-4444",
                operatingHours: [
                    {dayOfWeek: "Wednesday", openTime: "11:00", closeTime: "22:00"}
                ],
                menu: [
                    {
                        id: "C2",
                        name: "Stews",
                        items: [
                            {id: "M7", name: "Beef Potjiekos", description: "Traditional slow-cooked beef stew", price: 120.00d, taxRate: 0.15d, dietaryAttributes: [], stock: 28},
                            {id: "M8", name: "Lamb Potjiekos", description: "Slow-cooked lamb with vegetables", price: 140.00d, taxRate: 0.15d, dietaryAttributes: [], stock: 23},
                            {id: "M9", name: "Oxtail Potjiekos", description: "Rich oxtail stew", price: 160.00d, taxRate: 0.15d, dietaryAttributes: [], stock: 17},
                            {id: "M10", name: "Chicken Potjiekos", description: "Chicken and potato stew", price: 110.00d, taxRate: 0.15d, dietaryAttributes: [], stock: 31},
                            {id: "M11", name: "Vegetable Potjiekos", description: "Assorted vegetables", price: 90.00d, taxRate: 0.15d, dietaryAttributes: ["Vegetarian"], stock: 26},
                            {id: "M12", name: "Mahangu Pap", description: "Pearl millet porridge", price: 30.00d, taxRate: 0.15d, dietaryAttributes: ["Vegan", "Gluten-Free"], stock: 40}
                        ]
                    }
                ]
            },
            {
                id: "R003",
                name: "Oshakati Traditional Kitchen",
                address: "Main Road, Oshakati",
                location: {'type: "Point", coordinates: [15.6887d, -17.7833d]},
                contactNumber: "081-555-6666",
                operatingHours: [
                    {dayOfWeek: "Thursday", openTime: "11:00", closeTime: "21:00", isClosed: false}
                ],
                menu: [
                    {
                        id: "C3",
                        name: "Traditional Dishes",
                        items: [
                            {id: "M13", name: "Mopane Worms (Omatungu)", description: "Fried mopane worms", price: 80.00d, taxRate: 0.15d, dietaryAttributes: ["High-Protein"], stock: 22},
                            {id: "M14", name: "Zambezi Bream", description: "Fried river fish", price: 150.00d, taxRate: 0.15d, dietaryAttributes: ["Pescatarian"], stock: 19},
                            {id: "M15", name: "Marathon Chicken", description: "Free-range traditional chicken", price: 130.00d, taxRate: 0.15d, dietaryAttributes: [], stock: 24},
                            {id: "M16", name: "Omboga (Spinach)", description: "Wild spinach dish", price: 40.00d, taxRate: 0.15d, dietaryAttributes: ["Vegan"], stock: 36},
                            {id: "M17", name: "Matangara", description: "Traditional tripe dish", price: 90.00d, taxRate: 0.15d, dietaryAttributes: [], stock: 18},
                            {id: "M18", name: "Oshafima", description: "Traditional porridge", price: 25.00d, taxRate: 0.15d, dietaryAttributes: ["Vegan"], stock: 42}
                        ]
                    }
                ]
            },
            {
                id: "R004",
                name: "Windhoek Braai House",
                address: "Sam Nujoma Drive, Windhoek",
                location: {'type: "Point", coordinates: [17.0805d, -22.5608d]},
                contactNumber: "081-777-8888",
                operatingHours: [
                    {dayOfWeek: "Friday", openTime: "12:00", closeTime: "23:00"}
                ],
                menu: [
                    {
                        id: "C4",
                        name: "Braai",
                        items: [
                            {id: "M19", name: "Boerewors Roll", description: "Grilled sausage in a roll", price: 45.00d, taxRate: 0.15d, dietaryAttributes: [], stock: 34},
                            {id: "M20", name: "Game Steak Braai", description: "Grilled springbok steak", price: 180.00d, taxRate: 0.15d, dietaryAttributes: [], stock: 16},
                            {id: "M21", name: "Pork Ribs", description: "Sticky BBQ ribs", price: 160.00d, taxRate: 0.15d, dietaryAttributes: [], stock: 20},
                            {id: "M22", name: "Potato Salad", description: "Creamy potato salad", price: 35.00d, taxRate: 0.15d, dietaryAttributes: ["Vegetarian"], stock: 29},
                            {id: "M23", name: "Braaibroodjie", description: "Grilled cheese, tomato, onion sandwich", price: 40.00d, taxRate: 0.15d, dietaryAttributes: ["Vegetarian"], stock: 33},
                            {id: "M24", name: "Garlic Bread", description: "Toasted garlic baguette", price: 30.00d, taxRate: 0.15d, dietaryAttributes: ["Vegetarian"], stock: 47}
                        ]
                    }
                ]
            },
            {
                id: "R005",
                name: "Desert Cafe",
                address: "Swakopmund Strand",
                location: {'type: "Point", coordinates: [14.5266d, -22.6792d]},
                contactNumber: "081-999-0000",
                operatingHours: [
                    {dayOfWeek: "Saturday", openTime: "08:00", closeTime: "22:00"}
                ],
                menu: [
                    {
                        id: "C5",
                        name: "Cafe Classics",
                        items: [
                            {id: "M25", name: "Biltong Salad", description: "Fresh salad with beef biltong", price: 85.00d, taxRate: 0.15d, dietaryAttributes: [], stock: 27},
                            {id: "M26", name: "Oryx Burger", description: "Game meat burger with chips", price: 110.00d, taxRate: 0.15d, dietaryAttributes: [], stock: 25},
                            {id: "M27", name: "Droëwors Snack", description: "Dried sausage snack", price: 60.00d, taxRate: 0.15d, dietaryAttributes: [], stock: 38},
                            {id: "M28", name: "Malva Pudding", description: "Warm sponge dessert", price: 55.00d, taxRate: 0.15d, dietaryAttributes: ["Vegetarian"], stock: 21},
                            {id: "M29", name: "Rock Shandy", description: "Refreshing local drink", price: 35.00d, taxRate: 0.15d, dietaryAttributes: ["Vegetarian"], stock: 44},
                            {id: "M30", name: "Rooibos Tea", description: "Hot rooibos tea", price: 20.00d, taxRate: 0.15d, dietaryAttributes: ["Vegan"], stock: 52},
                            {id: "M31", name: "Fish and Chips", description: "Fresh coast fish", price: 95.00d, taxRate: 0.15d, dietaryAttributes: ["Pescatarian"], stock: 32}
                        ]
                    }
                ]
            }
        ];

        foreach Restaurant r in seedRestaurants {
            map<json> doc = check r.cloneWithType();
            _ = check restaurantsCollection->insertOne(doc);
        }

        log:printInfo("Database seeded successfully.");
    } on fail error err {
        log:printError("Failed to seed database: " + err.message(), err);
        return err;
    }
}

