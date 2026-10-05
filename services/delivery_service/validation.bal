import peerpressure/delivery_domain as domain;

public isolated function isValidCoordinates(LocationCoordinates location) returns boolean {
    return domain:isValidCoordinates(location);
}

public isolated function isValidDriver(Driver driver) returns boolean {
    return domain:isValidDriver(driver);
}
