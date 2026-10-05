import peerpressure/delivery_domain as domain;

public const DeliveryTaskStatus UNASSIGNED = domain:UNASSIGNED;
public const DeliveryTaskStatus DRIVER_ASSIGNED = domain:DRIVER_ASSIGNED;
public const DeliveryTaskStatus AT_RESTAURANT = domain:AT_RESTAURANT;
public const DeliveryTaskStatus OUT_FOR_DELIVERY = domain:OUT_FOR_DELIVERY;
public const DeliveryTaskStatus DELIVERED = domain:DELIVERED;

public isolated function isValidDeliveryTransition(DeliveryTaskStatus currentStatus, DeliveryTaskStatus nextStatus) returns boolean {
    return domain:isValidDeliveryTransition(currentStatus, nextStatus);
}

public isolated function transitionDelivery(DeliveryTaskStatus currentStatus, DeliveryTaskStatus nextStatus) returns DeliveryTaskStatus|error {
    return domain:transitionDelivery(currentStatus, nextStatus);
}
