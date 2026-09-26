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
    float[] coordinates;
|};

public type CustomerErrorDetail record {|
    string message = "";
|};

public type CustomerNotFoundError distinct error<CustomerErrorDetail>;

public type DuplicateEmailError distinct error<CustomerErrorDetail>;

public type DatabaseOperationError distinct error<CustomerErrorDetail>;

public type CustomerProfileUpdate record {|
    string name;
    string phone;
|};
public type AddressVerificationRequest record {|
    string customerId = "";
    CustomerAddress address;
|};

public type AddressVerificationResponse record {|
    boolean valid;
    boolean withinDeliveryRange;
    float distanceKm;
    string message;
|};
