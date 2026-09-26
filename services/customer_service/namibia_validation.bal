public function validateNamibiaCoordinates(GeoJSONPoint location)
        returns error? {

    if location.'type != "Point" {
        return error("Location type must be Point");
    }

    if location.coordinates.length() != 2 {
        return error("Location must contain longitude and latitude");
    }

    float longitude = location.coordinates[0];
    float latitude = location.coordinates[1];

    // Approximate geographic extent of Namibia.
    // GeoJSON order: [longitude, latitude]
    if longitude < 11.7 || longitude > 25.3 {
        return error("Longitude is outside Namibia");
    }

    if latitude < -28.97 || latitude > -16.96 {
        return error("Latitude is outside Namibia");
    }

    return;
}