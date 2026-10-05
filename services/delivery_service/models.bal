public type DriverAvailability "AVAILABLE"|"BUSY"|"OFFLINE";

public type DriverState "AVAILABLE"|"ASSIGNED"|"DELIVERING"|"OFFLINE";

public type VehicleCategory "CAR"|"MOTORCYCLE"|"BICYCLE"|"VAN";

public type DeliveryTaskStatus
    "UNASSIGNED"|"DRIVER_ASSIGNED"|"AT_RESTAURANT"|"OUT_FOR_DELIVERY"|"DELIVERED";

public type LocationCoordinates readonly & record {|
    decimal latitude;
    decimal longitude;
|};

public type Driver readonly & record {|
    string id;
    string name;
    string phone;
    VehicleCategory vehicleCategory;
    DriverAvailability availability;
    DriverState state;
    LocationCoordinates location;
|};

public type DeliveryTask readonly & record {|
    string deliveryId;
    string orderId;
    string? driverId = ();
    DeliveryTaskStatus status;
    string createdAt;
    string? assignedAt = ();
    string? pickedUpAt = ();
    string? deliveredAt = ();
|};
