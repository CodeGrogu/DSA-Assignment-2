import ballerina/constraint;

public type GeoJsonPoint record {|
    string 'type = "Point";
    # [longitude, latitude] in degrees
    [decimal, decimal] coordinates;
|};

public type OperatingHours record {|
    @constraint:String {minLength: 1}
    string dayOfWeek;
    string openTime;
    string closeTime;
    boolean isClosed = false;
|};

public type HolidayException record {|
    string date;
    string? openTime = ();
    string? closeTime = ();
    boolean isClosed = true;
|};

public type MenuItem record {|
    @constraint:String {minLength: 1}
    string id;
    @constraint:String {minLength: 1}
    string name;
    string description = "";
    @constraint:Number {minValue: 0.01}
    decimal price;
    @constraint:Number {minValue: 0.0, maxValue: 1.0}
    decimal taxRate = 0.15d;
    string[] dietaryAttributes = [];
    @constraint:Int {minValue: 0}
    int stock = 100;
    boolean isAvailable = true;
|};

public type MenuCategory record {|
    @constraint:String {minLength: 1}
    string id;
    @constraint:String {minLength: 1}
    string name;
    MenuItem[] items = [];
|};

public type Restaurant record {|
    string id = "";
    @constraint:String {minLength: 1}
    string name;
    string address;
    GeoJsonPoint location;
    string contactNumber;
    OperatingHours[] operatingHours = [];
    HolidayException[] holidayExceptions = [];
    MenuCategory[] menu = [];
|};

public type AddMenuItemRequest record {|
    @constraint:String {minLength: 1}
    string categoryId;
    MenuItem item;
|};

public type OrderItemReservation record {|
    @constraint:String {minLength: 1}
    string itemId;
    @constraint:Int {minValue: 1}
    int quantity;
|};

public type ValidateAndReserveRequest record {|
    # ISO 8601 / RFC 3339 timestamp of order placement (defaults to current time if omitted)
    string? orderTimestamp = ();
    OrderItemReservation[] items;
|};

public type StockReservationFailure record {|
    string itemId;
    string reason; // "INSUFFICIENT_STOCK" | "ITEM_NOT_FOUND" | "RESTAURANT_CLOSED"
    int availableStock;
    int requestedQuantity;
|};

