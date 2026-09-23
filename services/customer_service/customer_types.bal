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
    GeoCoordinate coordinates;
    string deliveryInstructions = "";
    boolean isDefault = false;
|};

public type GeoCoordinate record {|
    decimal latitude;
    decimal longitude;
|};
