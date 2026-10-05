public function isValidCoordinates(LocationCoordinates location) returns boolean {
    return location.latitude >= -90.0d &&
        location.latitude <= 90.0d &&
        location.longitude >= -180.0d &&
        location.longitude <= 180.0d;
}

public function isValidDriver(Driver driver) returns boolean {
    return driver.id != "" &&
        driver.name != "" &&
        driver.phone != "" &&
        isValidCoordinates(driver.location);
}
