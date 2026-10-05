public isolated function verifyCustomerAddress(
        AddressVerificationRequest request
) returns AddressVerificationResponse|error {

    CustomerAddress address = request.address;

    // Check that all required address fields are present and non-empty.
    if address.street.trim().length() == 0 ||
        address.city.trim().length() == 0 ||
        address.state.trim().length() == 0 ||
        address.postalCode.trim().length() == 0 {

        return error("Address is incomplete");
    }

    // GeoJSON coordinates must contain longitude and latitude.
    if address.location.coordinates.length() != 2 {
        return error("Coordinates must contain longitude and latitude");
    }

    // Validate coordinates are within Namibia geographic boundaries.
    error? namibiaValidation = validateNamibiaCoordinates(address.location);
    if namibiaValidation is error {
        return {
            valid: false,
            withinDeliveryRange: false,
            distanceKm: -1.0,
            message: namibiaValidation.message()
        };
    }

    float longitude = address.location.coordinates[0];
    float latitude = address.location.coordinates[1];

    // Reference point: Central Windhoek (-22.5609, 17.0658).
    float deliveryLongitude = 17.0658;
    float deliveryLatitude = -22.5609;

    // Maximum delivery distance.
    float deliveryRadiusKm = 10.0;

    // Calculate distance relative to Windhoek reference.
    float distanceKm = calculateDistanceKm(
            latitude,
            longitude,
            deliveryLatitude,
            deliveryLongitude
    );

    boolean withinRange = distanceKm <= deliveryRadiusKm;

    return {
        valid: true,
        withinDeliveryRange: withinRange,
        distanceKm: distanceKm,
        message: withinRange
            ? "Address is within delivery range"
            : "Address is outside delivery range"
    };
}

// Calculate distance in kilometres between two coordinates using degree projection.
isolated function calculateDistanceKm(
        float lat1,
        float lon1,
        float lat2,
        float lon2
) returns float {

    float latitudeDifference = lat1 - lat2;
    float longitudeDifference = lon1 - lon2;

    // Convert degree differences to kilometres around Windhoek (lat ~-22.56°).
    // 1 deg latitude ≈ 111.0 km, 1 deg longitude ≈ 111.32 * cos(-22.5609°) ≈ 102.5 km.
    float latitudeKm = latitudeDifference * 111.0;
    float longitudeKm = longitudeDifference * 102.5;

    float distanceSquared =
        (latitudeKm * latitudeKm) +
        (longitudeKm * longitudeKm);

    return calculateSquareRoot(distanceSquared);
}

// Calculate square root using Newton-Raphson method.
isolated function calculateSquareRoot(float value) returns float {

    if value <= 0.0 {
        return 0.0;
    }

    float guess = value > 1.0 ? value / 2.0 : 1.0;
    int iterations = 10;

    while iterations > 0 {
        guess = (guess + (value / guess)) / 2.0;
        iterations -= 1;
    }

    return guess;
}
