// Haversine formula calculation for geodesic distance and ETA estimation

# Calculates the great-circle distance between two decimal coordinates in kilometers
# using the Haversine formula.
#
# + startLoc - The starting location coordinates
# + destLoc - The destination location coordinates
# + return - The distance in kilometers rounded to 4 decimal places
public isolated function calculateHaversineDistance(LocationCoordinates startLoc, LocationCoordinates destLoc) returns decimal {
    if startLoc.latitude == destLoc.latitude && startLoc.longitude == destLoc.longitude {
        return 0.0d;
    }

    float r = 6371.0;
    float piVal = float:PI;

    // Convert degrees to radians
    float lat1 = <float>startLoc.latitude * piVal / 180.0;
    float lat2 = <float>destLoc.latitude * piVal / 180.0;
    float deltaLat = <float>(destLoc.latitude - startLoc.latitude) * piVal / 180.0;
    float deltaLon = <float>(destLoc.longitude - startLoc.longitude) * piVal / 180.0;

    // a = sin²(Δlat / 2) + cos(lat1) * cos(lat2) * sin²(Δlon / 2)
    float sinHalfDeltaLat = float:sin(deltaLat / 2.0);
    float sinHalfDeltaLon = float:sin(deltaLon / 2.0);
    float a = sinHalfDeltaLat * sinHalfDeltaLat + float:cos(lat1) * float:cos(lat2) * sinHalfDeltaLon * sinHalfDeltaLon;

    // Clamp a to prevent potential NaN from numerical inaccuracy
    if a < 0.0 {
        a = 0.0;
    } else if a > 1.0 {
        a = 1.0;
    }

    // c = 2 * atan2(√a, √(1 - a))
    float c = 2.0 * float:atan2(float:sqrt(a), float:sqrt(1.0 - a));

    // distance = R * c
    float distance = r * c;

    decimal distanceDec = <decimal>distance;
    return distanceDec.round(4);
}

# Calculates dynamic Estimated Time of Arrival (ETA) in minutes given distance and speed.
#
# + distanceKm - Distance in kilometers
# + speedKmH - Speed in kilometers per hour (default 40.0 km/h)
# + return - ETA in minutes (0 if distance <= 0)
public isolated function calculateDynamicEta(decimal distanceKm, decimal speedKmH = 40.0d) returns int {
    if distanceKm <= 0.0d || speedKmH <= 0.0d {
        return 0;
    }

    decimal rawMinutes = (distanceKm / speedKmH) * 60.0d;
    int eta = <int>rawMinutes.round();
    if eta == 0 && distanceKm > 0.0d {
        return 1;
    }
    return eta;
}
