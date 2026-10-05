import ballerina/time;

// Result of aggregating orders + payments + deliveries.
public type Overview record {|
    int totalOrders;
    decimal grossMerchandiseValue;
    int successfulPayments;
    int failedPayments;
    int activeDeliveries;
    string generatedAt;
|};

// Compute the platform overview from raw json arrays.
public isolated function computeOverview(json[] orders, json[] payments, json[] deliveries) returns Overview {
    int totalOrders = orders.length();

    // GMV: sum of all non-cancelled order totals.
    decimal gmv = 0;
    foreach json o in orders {
        if o is map<json> {
            string status = getString(o, "status");
            if status != "CANCELLED" {
                gmv = gmv + getDecimal(o, "totalAmount");
            }
        }
    }

    // Payments: count COMPLETED (or legacy SUCCESS) vs FAILED.
    int ok = 0;
    int failed = 0;
    foreach json p in payments {
        if p is map<json> {
            string status = getString(p, "status");
            if status == "COMPLETED" || status == "SUCCESS" {
                ok = ok + 1;
            }
            if status == "FAILED" {
                failed = failed + 1;
            }
        }
    }

    // Active deliveries: everything not yet DELIVERED.
    int active = 0;
    foreach json d in deliveries {
        if d is map<json> {
            string status = getString(d, "status");
            if status != "DELIVERED" && status != "CANCELLED" {
                active = active + 1;
            }
        }
    }

    return {
        totalOrders: totalOrders,
        grossMerchandiseValue: gmv,
        successfulPayments: ok,
        failedPayments: failed,
        activeDeliveries: active,
        generatedAt: ""
    };
}

// Safe string read from a json object.
isolated function getString(map<json> obj, string key) returns string {
    if obj.hasKey(key) {
        json v = obj[key];
        if v is string {
            return v;
        }
    }
    return "";
}

// Safe decimal read from a json object.
isolated function getDecimal(map<json> obj, string key) returns decimal {
    if obj.hasKey(key) {
        json v = obj[key];
        if v is int {
            return <decimal>v;
        }
        if v is decimal {
            return v;
        }
        if v is float {
            return <decimal>v;
        }
    }
    return 0d;
}

// One restaurant's row in the report.
public type RestaurantReport record {|
    string restaurantId;
    int orderCount;
    decimal grossSales;
    decimal commissionAmount;
    decimal netPayout;
|};

// One driver's row in the report.
public type DriverReport record {|
    string driverId;
    string driverName;
    int completedDeliveries;
    decimal averageTurnaroundMinutes;
    int slaBreaches;
|};

// Platform commission rate. 10% is a reasonable default for the demo.
const decimal COMMISSION_RATE = 0.10d;

// SLA threshold in minutes. Deliveries over this are counted as breaches.
const decimal SLA_MINUTES = 45.0d;

// Compute per-restaurant reports, filtered by date range if given.
// fromDate / toDate are "YYYY-MM-DD" strings. Empty string means "no filter".
public isolated function computeRestaurantReport(json[] orders, string fromDate, string toDate, string fromTime = "", string toTime = "") returns RestaurantReport[] {
    map<RestaurantReport> byRestaurant = {};

    foreach json o in orders {
        if o is map<json> {
            string status = getString(o, "status");
            if status == "CANCELLED" {
                continue;
            }
            string createdAt = getString(o, "createdAt");
            if !withinDateRange(createdAt, fromDate, toDate, fromTime, toTime) {
                continue;
            }

            string restId = getString(o, "restaurantId");
            if restId == "" {
                continue;
            }
            decimal amount = getDecimal(o, "totalAmount");

            // Merge into the map.
            if byRestaurant.hasKey(restId) {
                RestaurantReport existing = byRestaurant.get(restId);
                byRestaurant[restId] = {
                    restaurantId: restId,
                    orderCount: existing.orderCount + 1,
                    grossSales: existing.grossSales + amount,
                    commissionAmount: 0d,
                    netPayout: 0d
                };
            } else {
                byRestaurant[restId] = {
                    restaurantId: restId,
                    orderCount: 1,
                    grossSales: amount,
                    commissionAmount: 0d,
                    netPayout: 0d
                };
            }
        }
    }

    // Compute commission + netPayout for each row.
    RestaurantReport[] rows = [];
    foreach RestaurantReport r in byRestaurant {
        decimal commission = r.grossSales * COMMISSION_RATE;
        rows.push({
            restaurantId: r.restaurantId,
            orderCount: r.orderCount,
            grossSales: r.grossSales,
            commissionAmount: commission,
            netPayout: r.grossSales - commission
        });
    }
    return rows;
}

// Compute per-driver reports, filtered by date range.
public isolated function computeDriverReport(json[] deliveries, string fromDate, string toDate, string fromTime = "", string toTime = "") returns DriverReport[] {
    map<DriverReport> byDriver = {};
    map<int> turnaroundSum = {};
    map<int> turnaroundCount = {};

    foreach json d in deliveries {
        if d is map<json> {
            string status = getString(d, "status");
            if status != "DELIVERED" {
                continue;
            }
            string deliveredAt = getString(d, "deliveredAt");
            if !withinDateRange(deliveredAt, fromDate, toDate, fromTime, toTime) {
                continue;
            }

            string driverId = getString(d, "driverId");
            if driverId == "" {
                continue;
            }
            string driverName = getString(d, "driverName");

            // Compute turnaround in minutes if both timestamps exist.
            string assignedAt = getString(d, "assignedAt");
            int minutes = minutesBetween(assignedAt, deliveredAt);
            boolean isBreach = <decimal>minutes > SLA_MINUTES;

            if byDriver.hasKey(driverId) {
                DriverReport existing = byDriver.get(driverId);
                int newCount = existing.completedDeliveries + 1;
                int newBreaches = existing.slaBreaches + (isBreach ? 1 : 0);

                // Running average.
                int prevSum = turnaroundSum.hasKey(driverId) ? turnaroundSum.get(driverId) : 0;
                int prevCount = turnaroundCount.hasKey(driverId) ? turnaroundCount.get(driverId) : 0;
                int newSum = prevSum + minutes;
                int newTCount = prevCount + 1;

                decimal avg = newTCount > 0 ? <decimal>newSum / <decimal>newTCount : 0d;

                byDriver[driverId] = {
                    driverId: driverId,
                    driverName: driverName,
                    completedDeliveries: newCount,
                    averageTurnaroundMinutes: avg,
                    slaBreaches: newBreaches
                };
                turnaroundSum[driverId] = newSum;
                turnaroundCount[driverId] = newTCount;
            } else {
                byDriver[driverId] = {
                    driverId: driverId,
                    driverName: driverName,
                    completedDeliveries: 1,
                    averageTurnaroundMinutes: <decimal>minutes,
                    slaBreaches: isBreach ? 1 : 0
                };
                turnaroundSum[driverId] = minutes;
                turnaroundCount[driverId] = 1;
            }
        }
    }

    DriverReport[] rows = [];
    foreach DriverReport r in byDriver {
        rows.push(r);
    }
    return rows;
}

// True if timestamp falls within [fromDate, toDate] (and optional HH:MM time bounds) inclusive.
// Empty strings mean "no bound on that side".
isolated function withinDateRange(string timestamp, string fromDate, string toDate, string fromTime = "", string toTime = "") returns boolean {
    if timestamp == "" {
        return false;
    }
    string day = timestamp.length() >= 10 ? timestamp.substring(0, 10) : timestamp;
    if fromDate != "" && day < fromDate {
        return false;
    }
    if toDate != "" && day > toDate {
        return false;
    }
    if (fromTime != "" || toTime != "") && timestamp.length() >= 16 {
        string hhmm = timestamp.substring(11, 16);
        if fromTime != "" && (fromDate == "" || day == fromDate) && hhmm < fromTime {
            return false;
        }
        if toTime != "" && (toDate == "" || day == toDate) && hhmm > toTime {
            return false;
        }
    }
    return true;
}

// Computes exact minutes between two RFC 3339 / ISO-8601 timestamps across midnight and multi-day boundaries.
isolated function minutesBetween(string fromIso, string toIso) returns int {
    if fromIso.trim() == "" || toIso.trim() == "" {
        return 0;
    }
    time:Utc|error fromUtc = time:utcFromString(fromIso.trim());
    time:Utc|error toUtc = time:utcFromString(toIso.trim());
    if fromUtc is time:Utc && toUtc is time:Utc {
        decimal diffSeconds = time:utcDiffSeconds(toUtc, fromUtc);
        if diffSeconds <= 0d {
            return 0;
        }
        return <int>(diffSeconds / 60d);
    }

    int fromH = isoHour(fromIso);
    int fromM = isoMinute(fromIso);
    int toH = isoHour(toIso);
    int toM = isoMinute(toIso);
    int delta = (toH * 60 + toM) - (fromH * 60 + fromM);
    return delta < 0 ? 0 : delta;
}

isolated function isoHour(string iso) returns int {
    if iso.length() < 13 {
        return 0;
    }
    string hh = iso.substring(11, 13);
    int|error parsed = int:fromString(hh);
    return parsed is int ? parsed : 0;
}

isolated function isoMinute(string iso) returns int {
    if iso.length() < 16 {
        return 0;
    }
    string mm = iso.substring(14, 16);
    int|error parsed = int:fromString(mm);
    return parsed is int ? parsed : 0;
}
