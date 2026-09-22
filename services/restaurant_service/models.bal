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

public type MenuItem record {|
    @constraint:String {minLength: 1}
    string id;
    @constraint:String {minLength: 1}
    string name;
    string description;
    @constraint:Float {minValue: 0.0}
    float price;
    float taxRate = 0.0;
    string[] dietaryAttributes = [];
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
    string contactNumber;
    OperatingHours[] operatingHours;
    HolidayException[] holidayExceptions = [];
    MenuCategory[] menu;
|};
