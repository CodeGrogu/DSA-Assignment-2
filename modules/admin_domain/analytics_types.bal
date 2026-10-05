// High level numbers shown on the admin dashboard.
public type PlatformOverview record {|
    int totalOrders;
    decimal grossMerchandiseValue;
    int successfulPayments;
    int failedPayments;
    int activeDeliveries;
    string generatedAt;
|};

// One restaurant's revenue breakdown for a date range.
public type RestaurantReport record {|
    string restaurantId;
    string restaurantName;
    int orderCount;
    decimal grossSales;
    decimal commissionAmount;
    decimal netPayout;
|};

// One driver's delivery performance for a date range.
public type DriverReport record {|
    string driverId;
    string driverName;
    int completedDeliveries;
    decimal averageTurnaroundMinutes;
    int slaBreaches;
|};

// Daily snapshot used for SLA compliance tracking.
public type DailyMetricsSnapshot record {|
    string date; // YYYY-MM-DD
    int totalOrders;
    int deliveredOnTime;
    int deliveredLate;
    decimal slaComplianceRate; // 0.0 to 1.0
|};
