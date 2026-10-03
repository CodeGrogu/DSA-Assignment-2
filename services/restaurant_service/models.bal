import ballerina/constraint;

public type OperatingHours record {|
    @constraint:String {minLength: 1}
    string dayOfWeek;
    string openTime;
    string closeTime;
    boolean isClosed = false;
|};

public type HolidayException record {|
    string date;
    string openTime?;
    string closeTime?;
    boolean isClosed = true;
|};

public type GeoJsonPoint record {|
    string 'type = "Point";
    # [longitude, latitude] in degrees
    [decimal, decimal] coordinates;
|};

public type MenuItem record {|
    @constraint:String {minLength: 1}
    string id;
    @constraint:String {minLength: 1}
    string name;
    string description;
    @constraint:Number {minValue: 0.0}
    decimal price;
    @constraint:Number {minValue: 0.0, maxValue: 1.0}
    decimal taxRate = 0.15d;
    string[] dietaryAttributes = [];
    @constraint:Int {minValue: 0}
    int stock = 100;
|};

public type MenuCategory record {|
    @constraint:String {minLength: 1}
    string id;
    @constraint:String {minLength: 1}
    string name;
    MenuItem[] items;
|};

public type Restaurant record {|
    @constraint:String {minLength: 1}
    string id;
    @constraint:String {minLength: 1}
    string name;
    string address;
    GeoJsonPoint location;
    string contactNumber;
    OperatingHours[] operatingHours;
    HolidayException[] holidayExceptions = [];
    MenuCategory[] menu;
|};
