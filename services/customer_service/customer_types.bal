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

public isolated function validateGeoJSONPoint(GeoJSONPoint point) returns string? {
    if point.'type != "Point" {
        return "GeoJSON point type must be 'Point'";
    }
    if point.coordinates.length() != 2 {
        return "GeoJSON point coordinates must contain exactly [longitude, latitude]";
    }
    float lon = point.coordinates[0];
    float lat = point.coordinates[1];
    if lon < -180.0 || lon > 180.0 {
        return "Longitude must be between -180 and 180";
    }
    if lat < -90.0 || lat > 90.0 {
        return "Latitude must be between -90 and 90";
    }
    return ();
}

public isolated function validateCustomerAddress(CustomerAddress address) returns string? {
    if address.id.trim().length() == 0 {
        return "Address ID cannot be empty";
    }
    if address.street.trim().length() == 0 {
        return "Address street cannot be empty";
    }
    if address.city.trim().length() == 0 {
        return "Address city cannot be empty";
    }
    string? pointErr = validateGeoJSONPoint(address.location);
    if pointErr is string {
        return pointErr;
    }
    return ();
}

public isolated function validateCustomer(Customer customer) returns string? {
    if customer.id.trim().length() == 0 {
        return "Customer ID cannot be empty";
    }
    if customer.name.trim().length() == 0 {
        return "Customer name cannot be empty";
    }
    if customer.email.trim().length() == 0 || !customer.email.includes("@") {
        return "Invalid customer email address";
    }
    if customer.phone.trim().length() == 0 {
        return "Customer phone cannot be empty";
    }
    foreach CustomerAddress addr in customer.addresses {
        string? addrErr = validateCustomerAddress(addr);
        if addrErr is string {
            return addrErr;
        }
    }
    return ();
}

public isolated function getDefaultAddress(Customer customer) returns CustomerAddress? {
    foreach CustomerAddress addr in customer.addresses {
        if addr.isDefault {
            return addr;
        }
    }
    if customer.addresses.length() > 0 {
        return customer.addresses[0];
    }
    return ();
}
