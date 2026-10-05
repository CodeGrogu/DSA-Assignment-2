public const DeliveryTaskStatus UNASSIGNED = "UNASSIGNED";
public const DeliveryTaskStatus DRIVER_ASSIGNED = "DRIVER_ASSIGNED";
public const DeliveryTaskStatus AT_RESTAURANT = "AT_RESTAURANT";
public const DeliveryTaskStatus OUT_FOR_DELIVERY = "OUT_FOR_DELIVERY";
public const DeliveryTaskStatus DELIVERED = "DELIVERED";

public function isValidDeliveryTransition(DeliveryTaskStatus currentStatus, DeliveryTaskStatus nextStatus) returns boolean {
    match currentStatus {
        UNASSIGNED => {
            return nextStatus == DRIVER_ASSIGNED;
        }
        DRIVER_ASSIGNED => {
            return nextStatus == AT_RESTAURANT;
        }
        AT_RESTAURANT => {
            return nextStatus == OUT_FOR_DELIVERY;
        }
        OUT_FOR_DELIVERY => {
            return nextStatus == DELIVERED;
        }
        DELIVERED => {
            return false;
        }
        _ => {
            return false;
        }
    }
}

public function transitionDelivery(DeliveryTaskStatus currentStatus, DeliveryTaskStatus nextStatus) returns DeliveryTaskStatus|error {
    if isValidDeliveryTransition(currentStatus, nextStatus) {
        return nextStatus;
    }
    return error(string `Invalid delivery transition from ${currentStatus} to ${nextStatus}`);
}
