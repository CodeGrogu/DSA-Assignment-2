import ballerina/constraint;

public type Customer record {|
    @constraint:String {
        minLength: 1,
        maxLength: 50
    }
    string id;

    @constraint:String {
        minLength: 1,
        maxLength: 100
    }
    string name;

    @constraint:String {
        minLength: 3,
        maxLength: 150,
        pattern: re `^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$`
    }
    string email;

    @constraint:String {
        minLength: 7,
        maxLength: 20,
        pattern: re `^\+?[0-9][0-9 -]{6,19}$`
    }
    string phone;

    @constraint:Array {
        maxLength: 20
    }
    CustomerAddress[] addresses = [];
|};

public type CustomerAddress record {|
    @constraint:String {
        minLength: 1,
        maxLength: 50
    }
    string id;

    @constraint:String {
        minLength: 1,
        maxLength: 30
    }
    string tag;

    @constraint:String {
        minLength: 1,
        maxLength: 150
    }
    string street;

    @constraint:String {
        minLength: 1,
        maxLength: 100
    }
    string city;

    @constraint:String {
        minLength: 1,
        maxLength: 100
    }
    string state;

    @constraint:String {
        minLength: 1,
        maxLength: 20
    }
    string postalCode;

    GeoJSONPoint location;

    @constraint:String {
        maxLength: 250
    }
    string deliveryInstructions = "";

    boolean isDefault = false;
|};

public type GeoJSONPoint record {|
    @constraint:String {
        length: 5
    }
    string 'type = "Point";

    @constraint:Array {
        length: 2
    }
    float[] coordinates;
|};

public type CustomerErrorDetail record {|
    string message = "";
|};

public type CustomerNotFoundError distinct error<CustomerErrorDetail>;

public type DuplicateEmailError distinct error<CustomerErrorDetail>;

public type DatabaseOperationError distinct error<CustomerErrorDetail>;

public type AddressNotFoundError distinct error<CustomerErrorDetail>;

public type CustomerProfileUpdate record {|
    @constraint:String {
        minLength: 1,
        maxLength: 100
    }
    string name;

    @constraint:String {
        minLength: 7,
        maxLength: 20,
        pattern: re `^\+?[0-9][0-9 -]{6,19}$`
    }
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

public type DefaultAddressRequest record {|
    @constraint:String {
        minLength: 1,
        maxLength: 50
    }
    string addressId;
|};
