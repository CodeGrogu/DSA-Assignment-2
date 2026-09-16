public type Money record {|
    decimal amount;
    string currency = "USD";
|};

public type GeoCoordinate record {|
    decimal latitude;
    decimal longitude;
|};

public type Address record {|
    string street;
    string city;
    string state;
    string postalCode;
    GeoCoordinate? coordinates = ();
|};

public type OrderItem record {|
    string itemId;
    string itemName;
    int quantity;
    decimal unitPrice;
    decimal subtotal;
    string[] specialInstructions = [];
|};
