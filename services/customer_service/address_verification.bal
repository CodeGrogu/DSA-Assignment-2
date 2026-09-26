public function verifyCustomerAddress(
        AddressVerificationRequest request
) returns AddressVerificationResponse|error {

    CustomerAddress address = request.address;

    // Check that all required address fields are present.
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

    float longitude = address.location.coordinates[0];
    float latitude = address.location.coordinates[1];

    // Validate longitude.
    if longitude < -180.0 || longitude > 180.0 {
        return error("Invalid longitude");
    }

    // Validate latitude.
    if latitude < -90.0 || latitude > 90.0 {
        return error("Invalid latitude");
    }

    // Delivery centre.
    float deliveryLongitude = 17.0658;
    float deliveryLatitude = -22.5609;

    // Maximum delivery distance.
    float deliveryRadiusKm = 10.0;

    // Calculate coordinate differences.
    float longitudeDifference = longitude - deliveryLongitude;
    float latitudeDifference = latitude - deliveryLatitude;

    // Convert approximate degree differences to kilometres.
    float longitudeKm = longitudeDifference * 111.0;
    float latitudeKm = latitudeDifference * 111.0;

    // Calculate squared distance.
    float distanceSquared =
        (longitudeKm * longitudeKm) +
        (latitudeKm * latitudeKm);

    // Calculate the square root using Newton's method.
    float distanceKm = calculateSquareRoot(distanceSquared);

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

function calculateSquareRoot(float value) returns float {

    if value == 0.0 {
        return 0.0;
    }

    float guess = value;

    int iterations = 10;

    while iterations > 0 {
        guess = (guess + (value / guess)) / 2.0;
        iterations -= 1;
    }

    return guess;
}