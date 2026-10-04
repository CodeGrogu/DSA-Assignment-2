
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
public function computeOverview(json[] orders, json[] payments, json[] deliveries) returns Overview {
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

    // Payments: count COMPLETED vs FAILED.
    int ok = 0;
    int failed = 0;
    foreach json p in payments {
        if p is map<json> {
            string status = getString(p, "status");
            if status == "COMPLETED" {
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
function getString(map<json> obj, string key) returns string {
    if obj.hasKey(key) {
        json v = obj[key];
        if v is string {
            return v;
        }
    }
    return "";
}

// Safe decimal read from a json object.
function getDecimal(map<json> obj, string key) returns decimal {
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
