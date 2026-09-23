public type Customer record {|
    string id;
    string name;
    string email;
    string phone;
    CustomerAddress[] addresses = [];
|};

public type CustomerAddress record {|
    string id;
    string tag;
    string street;
    string city;
    string state;
    string postalCode;
    GeoJSONPoint location;
    string deliveryInstructions = "";
    boolean isDefault = false;
|};

public type GeoJSONPoint record {|
    string 'type = "Point";
    decimal[] coordinates;
|};