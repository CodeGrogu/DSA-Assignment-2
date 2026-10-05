public type Money readonly & record {|
    decimal amount;
    string currency = "NAD";
|};

public type GeoCoordinate readonly & record {|
    decimal latitude;
    decimal longitude;
|};

public type Address readonly & record {|
    string street;
    string city;
    string state;
    string postalCode;
    GeoCoordinate? coordinates = ();
|};

public type OrderItem readonly & record {|
    string itemId;
    string itemName;
    int quantity;
    decimal unitPrice;
    decimal subtotal;
    string[] specialInstructions = [];
|};

