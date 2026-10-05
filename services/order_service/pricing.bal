import ballerina/time;

// Configurable pricing parameters
# Base delivery fee applied to standard off-peak orders.
configurable decimal baseDeliveryFee = 15.0;

# Maximum surge multiplier upper bound cap.
configurable decimal maxSurgeMultiplier = 3.0;

# Minimum surge multiplier lower bound floor.
configurable decimal minSurgeMultiplier = 1.0;

# Flag to enable or disable time-of-day peak hour surge bonus.
configurable boolean enableTimeOfDayPeak = true;

# Local timezone offset in hours relative to UTC (defaults to CAT = UTC+2 for Windhoek, Namibia).
configurable decimal timezoneOffsetHours = 2.0;

# Canonical pricing quote representation returned to customers and downstream services.
#
# + surgeMultiplier - The dynamic surge multiplier applied to this quote
# + deliveryFee - Calculated final delivery fee (baseFee * surgeMultiplier)
# + baseFee - Base delivery fee configured on the platform
# + tier - Surge tier label ("STANDARD", "MODERATE", "HIGH", "SURGE", "PEAK")
# + peakHourApplied - Indicates whether lunch/dinner peak-hour bonus was added
# + timestamp - RFC 3339 timestamp when the quote was computed
public type PricingQuote record {|
    decimal surgeMultiplier;
    decimal deliveryFee;
    decimal baseFee;
    string tier;
    boolean peakHourApplied;
    string timestamp;
|};

# Request payload representation for pricing calculation.
#
# + unfulfilledOrders - Count of currently unfulfilled/pending customer orders
# + availableDrivers - Count of active and available delivery drivers
public type PricingRequest record {|
    int unfulfilledOrders;
    int availableDrivers;
|};

# Computes the effective civil hour accounting for configured local timezone offset.
# Defaults to Central Africa Time (CAT = UTC+2) for Windhoek, Namibia.
#
# + return - Effective local civil hour (0-23)
public isolated function getLocalCivilHour() returns int {
    time:Utc utcNow = time:utcNow();
    decimal offsetSeconds = timezoneOffsetHours * 3600.0d;
    time:Utc localUtc = time:utcAddSeconds(utcNow, <time:Seconds>offsetSeconds);
    return time:utcToCivil(localUtc).hour;
}

# Evaluates whether the given hour of day falls within lunch or dinner peak windows.
# Lunch peak: 12:00 - 13:59 ([12, 13]).
# Dinner peak: 18:00 - 20:59 ([18, 19, 20]).
#
# + hourOfDay - The 24-hour formatted hour (0-23)
# + return - True if hour is a designated peak hour, false otherwise
public isolated function isPeakHour(int hourOfDay) returns boolean {
    return (hourOfDay >= 12 && hourOfDay <= 13) || (hourOfDay >= 18 && hourOfDay <= 20);
}

# Maps the supply-demand ratio R to its corresponding surge tier identifier.
#
# + ratio - The demand-to-supply ratio R = unfulfilledOrders / max(1, availableDrivers)
# + return - String name of the surge tier
public isolated function getSurgeTierName(decimal ratio) returns string {
    if ratio <= 1.0d {
        return "STANDARD";
    } else if ratio <= 2.0d {
        return "MODERATE";
    } else if ratio <= 3.0d {
        return "HIGH";
    } else if ratio <= 5.0d {
        return "SURGE";
    } else {
        return "PEAK";
    }
}

# Calculates total delivery fee based on base delivery fee and surge multiplier.
# Enforces explicit 2-decimal currency precision rounding for financial ledger integrity.
#
# + baseFee - The base platform delivery fee
# + surgeMultiplier - The computed surge multiplier
# + return - Computed delivery fee rounded to 2 decimal places
public isolated function calculateDeliveryFee(decimal baseFee, decimal surgeMultiplier) returns decimal {
    decimal safeBase = baseFee >= 0.0d ? baseFee : 0.0d;
    decimal rawFee = safeBase * surgeMultiplier;
    decimal roundedFee = (rawFee * 100.0d).round() / 100.0d;
    return roundedFee >= 0.0d ? roundedFee : 0.0d;
}

# Computes dynamic surge multiplier using supply-demand ratio and optional time-of-day peak bonus.
# Formula:
# - If availableDrivers <= 0 and unfulfilledOrders > 0 -> maxSurgeMultiplier (PEAK tier)
# - If availableDrivers <= 0 and unfulfilledOrders == 0 -> 1.0x (STANDARD tier)
# - Otherwise: R = unfulfilledOrders / availableDrivers
# Tiers:
# R <= 1.0 -> 1.0x (STANDARD)
# 1.0 < R <= 2.0 -> 1.25x (MODERATE)
# 2.0 < R <= 3.0 -> 1.5x (HIGH)
# 3.0 < R <= 5.0 -> 2.0x (SURGE)
# R > 5.0 -> 3.0x (PEAK, capped at maxSurgeMultiplier)
# Time-of-day bonus: +0.2x if hour in [12, 13] or [18, 19, 20], capped at maxSurgeMultiplier.
#
# + unfulfilledOrders - Count of unfulfilled orders (clamped to >= 0)
# + availableDrivers - Count of available drivers
# + hourOfDay - Optional explicit hour of day (0-23); defaults to local civil hour (CAT UTC+2)
# + return - Capped surge multiplier decimal
public isolated function calculateSurgeMultiplier(int unfulfilledOrders, int availableDrivers, int? hourOfDay = ()) returns decimal {
    decimal safeMin = minSurgeMultiplier >= 1.0d ? minSurgeMultiplier : 1.0d;
    decimal safeMax = maxSurgeMultiplier >= safeMin ? maxSurgeMultiplier : safeMin;

    int orders = unfulfilledOrders >= 0 ? unfulfilledOrders : 0;
    decimal multiplier;

    if availableDrivers <= 0 {
        if orders > 0 {
            multiplier = safeMax;
        } else {
            multiplier = 1.0d;
        }
    } else {
        decimal ratio = <decimal>orders / <decimal>availableDrivers;
        if ratio <= 1.0d {
            multiplier = 1.0d;
        } else if ratio <= 2.0d {
            multiplier = 1.25d;
        } else if ratio <= 3.0d {
            multiplier = 1.5d;
        } else if ratio <= 5.0d {
            multiplier = 2.0d;
        } else {
            multiplier = 3.0d;
        }
    }

    if enableTimeOfDayPeak {
        int effectiveHour = hourOfDay ?: getLocalCivilHour();
        if isPeakHour(effectiveHour) {
            multiplier = multiplier + 0.2d;
        }
    }

    if multiplier > safeMax {
        multiplier = safeMax;
    }
    if multiplier < safeMin {
        multiplier = safeMin;
    }

    return multiplier;
}

# Thread-safe dynamic surge pricing engine tracking platform supply and demand.
public isolated class PricingEngine {
    private int unfulfilledOrders = 0;
    private int availableDrivers = 0;

    # Initializes pricing engine.
    public isolated function init() {
    }

    # Thread-safely records current platform supply and demand levels.
    #
    # + unfulfilledOrders - Count of unfulfilled orders
    # + availableDrivers - Count of active available drivers
    public isolated function setSupplyDemand(int unfulfilledOrders, int availableDrivers) {
        lock {
            self.unfulfilledOrders = unfulfilledOrders >= 0 ? unfulfilledOrders : 0;
            self.availableDrivers = availableDrivers >= 0 ? availableDrivers : 0;
        }
    }

    # Thread-safely returns currently tracked count of available drivers.
    #
    # + return - Available drivers count
    public isolated function getAvailableDrivers() returns int {
        lock {
            return self.availableDrivers;
        }
    }

    # Thread-safely returns currently tracked count of unfulfilled orders.
    #
    # + return - Unfulfilled orders count
    public isolated function getUnfulfilledOrders() returns int {
        lock {
            return self.unfulfilledOrders;
        }
    }

    # Calculates dynamic pricing quote for specified supply, demand, and hour parameters.
    #
    # + unfulfilledOrders - Count of unfulfilled orders
    # + availableDrivers - Count of active available drivers
    # + hourOfDay - Optional explicit hour of day (0-23)
    # + return - Generated PricingQuote
    public isolated function getQuote(int unfulfilledOrders, int availableDrivers, int? hourOfDay = ()) returns PricingQuote {
        int orders = unfulfilledOrders >= 0 ? unfulfilledOrders : 0;
        decimal ratio;
        if availableDrivers <= 0 {
            ratio = orders > 0 ? 999.0d : 0.0d;
        } else {
            ratio = <decimal>orders / <decimal>availableDrivers;
        }
        string tier = getSurgeTierName(ratio);

        decimal surgeMultiplier = calculateSurgeMultiplier(unfulfilledOrders, availableDrivers, hourOfDay);
        decimal deliveryFee = calculateDeliveryFee(baseDeliveryFee, surgeMultiplier);

        int effectiveHour = hourOfDay ?: getLocalCivilHour();
        boolean peakHourApplied = enableTimeOfDayPeak && isPeakHour(effectiveHour);

        return {
            surgeMultiplier: surgeMultiplier,
            deliveryFee: deliveryFee,
            baseFee: baseDeliveryFee,
            tier: tier,
            peakHourApplied: peakHourApplied,
            timestamp: currentTimestamp()
        };
    }

    # Thread-safely evaluates real-time platform quote using current tracked supply and demand.
    #
    # + return - Current platform PricingQuote
    public isolated function getCurrentQuote() returns PricingQuote {
        int orders;
        int drivers;
        lock {
            orders = self.unfulfilledOrders;
            drivers = self.availableDrivers;
        }
        return self.getQuote(orders, drivers);
    }
}

# Global singleton pricing engine instance.
public final PricingEngine pricingEngine = new;
