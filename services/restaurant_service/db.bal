import ballerina/log;
import ballerinax/mongodb;

configurable string mongoUrl = "mongodb://root:password@localhost:27017";
configurable string databaseName = "restaurant_db";

public function seedDatabase() returns error? {
    mongodb:Client mongoClient = check new ({connection: mongoUrl});
    mongodb:Database restaurantDb = check mongoClient->getDatabase(databaseName);
    mongodb:Collection restaurantsCollection = check restaurantDb->getCollection("restaurants");

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
                        {id: "M1", name: "Beef Kapana", description: "Grilled beef strips with spice", price: 50.00, taxRate: 0.15, dietaryAttributes: ["High-Protein"]},
                        {id: "M2", name: "Vetkoek (Fat Cake)", description: "Deep fried dough bread", price: 10.00, taxRate: 0.15, dietaryAttributes: ["Vegetarian"]},
                        {id: "M3", name: "Salsa", description: "Tomato and onion salsa", price: 15.00, taxRate: 0.15, dietaryAttributes: ["Vegan", "Gluten-Free"]},
                        {id: "M4", name: "Roosterkoek", description: "Bread baked on a grid", price: 20.00, taxRate: 0.15, dietaryAttributes: ["Vegetarian"]},
                        {id: "M5", name: "Pork Kapana", description: "Grilled pork strips", price: 60.00, taxRate: 0.15, dietaryAttributes: []},
                        {id: "M6", name: "Oshikundu", description: "Traditional fermented drink", price: 25.00, taxRate: 0.15, dietaryAttributes: ["Vegetarian"]}
                    ]
                }
            ]
        },
        {
            id: "R002",
            name: "Namibian Potjie Kitchen",
            address: "Independence Ave, Windhoek",
            contactNumber: "081-333-4444",
            operatingHours: [
                {dayOfWeek: "Wednesday", openTime: "11:00", closeTime: "22:00"}
            ],
            menu: [
                {
                    id: "C2",
                    name: "Stews",
                    items: [
                        {id: "M7", name: "Beef Potjiekos", description: "Traditional slow-cooked beef stew", price: 120.00, taxRate: 0.15, dietaryAttributes: []},
                        {id: "M8", name: "Lamb Potjiekos", description: "Slow-cooked lamb with vegetables", price: 140.00, taxRate: 0.15, dietaryAttributes: []},
                        {id: "M9", name: "Oxtail Potjiekos", description: "Rich oxtail stew", price: 160.00, taxRate: 0.15, dietaryAttributes: []},
                        {id: "M10", name: "Chicken Potjiekos", description: "Chicken and potato stew", price: 110.00, taxRate: 0.15, dietaryAttributes: []},
                        {id: "M11", name: "Vegetable Potjiekos", description: "Assorted vegetables", price: 90.00, taxRate: 0.15, dietaryAttributes: ["Vegetarian"]},
                        {id: "M12", name: "Mahangu Pap", description: "Pearl millet porridge", price: 30.00, taxRate: 0.15, dietaryAttributes: ["Vegan", "Gluten-Free"]}
                    ]
                }
            ]
        },
        {
            id: "R003",
            name: "Oshakati Traditional Kitchen",
            address: "Main Road, Oshakati",
            contactNumber: "081-555-6666",
            operatingHours: [
                {dayOfWeek: "Thursday", openTime: "11:00", closeTime: "21:00", isClosed: false}
            ],
            menu: [
                {
                    id: "C3",
                    name: "Traditional Dishes",
                    items: [
                        {id: "M13", name: "Mopane Worms (Omatungu)", description: "Fried mopane worms", price: 80.00, taxRate: 0.15, dietaryAttributes: ["High-Protein"]},
                        {id: "M14", name: "Zambezi Bream", description: "Fried river fish", price: 150.00, taxRate: 0.15, dietaryAttributes: ["Pescatarian"]},
                        {id: "M15", name: "Marathon Chicken", description: "Free-range traditional chicken", price: 130.00, taxRate: 0.15, dietaryAttributes: []},
                        {id: "M16", name: "Omboga (Spinach)", description: "Wild spinach dish", price: 40.00, taxRate: 0.15, dietaryAttributes: ["Vegan"]},
                        {id: "M17", name: "Matangara", description: "Traditional tripe dish", price: 90.00, taxRate: 0.15, dietaryAttributes: []},
                        {id: "M18", name: "Oshafima", description: "Traditional porridge", price: 25.00, taxRate: 0.15, dietaryAttributes: ["Vegan"]}
                    ]
                }
            ]
        },
        {
            id: "R004",
            name: "Windhoek Braai House",
            address: "Sam Nujoma Drive, Windhoek",
            contactNumber: "081-777-8888",
            operatingHours: [
                {dayOfWeek: "Friday", openTime: "12:00", closeTime: "23:00"}
            ],
            menu: [
                {
                    id: "C4",
                    name: "Braai",
                    items: [
                        {id: "M19", name: "Boerewors Roll", description: "Grilled sausage in a roll", price: 45.00, taxRate: 0.15, dietaryAttributes: []},
                        {id: "M20", name: "Game Steak Braai", description: "Grilled springbok steak", price: 180.00, taxRate: 0.15, dietaryAttributes: []},
                        {id: "M21", name: "Pork Ribs", description: "Sticky BBQ ribs", price: 160.00, taxRate: 0.15, dietaryAttributes: []},
                        {id: "M22", name: "Potato Salad", description: "Creamy potato salad", price: 35.00, taxRate: 0.15, dietaryAttributes: ["Vegetarian"]},
                        {id: "M23", name: "Braaibroodjie", description: "Grilled cheese, tomato, onion sandwich", price: 40.00, taxRate: 0.15, dietaryAttributes: ["Vegetarian"]},
                        {id: "M24", name: "Garlic Bread", description: "Toasted garlic baguette", price: 30.00, taxRate: 0.15, dietaryAttributes: ["Vegetarian"]}
                    ]
                }
            ]
        },
        {
            id: "R005",
            name: "Desert Cafe",
            address: "Swakopmund Strand",
            contactNumber: "081-999-0000",
            operatingHours: [
                {dayOfWeek: "Saturday", openTime: "08:00", closeTime: "22:00"}
            ],
            menu: [
                {
                    id: "C5",
                    name: "Cafe Classics",
                    items: [
                        {id: "M25", name: "Biltong Salad", description: "Fresh salad with beef biltong", price: 85.00, taxRate: 0.15, dietaryAttributes: []},
                        {id: "M26", name: "Oryx Burger", description: "Game meat burger with chips", price: 110.00, taxRate: 0.15, dietaryAttributes: []},
                        {id: "M27", name: "Droëwors Snack", description: "Dried sausage snack", price: 60.00, taxRate: 0.15, dietaryAttributes: []},
                        {id: "M28", name: "Malva Pudding", description: "Warm sponge dessert", price: 55.00, taxRate: 0.15, dietaryAttributes: ["Vegetarian"]},
                        {id: "M29", name: "Rock Shandy", description: "Refreshing local drink", price: 35.00, taxRate: 0.15, dietaryAttributes: ["Vegetarian"]},
                        {id: "M30", name: "Rooibos Tea", description: "Hot rooibos tea", price: 20.00, taxRate: 0.15, dietaryAttributes: ["Vegan"]},
                        {id: "M31", name: "Fish and Chips", description: "Fresh coast fish", price: 95.00, taxRate: 0.15, dietaryAttributes: ["Pescatarian"]}
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
}
