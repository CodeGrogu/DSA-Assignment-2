# Represents the state of a GPS route simulation.
public type RouteSimulation readonly & record {|
    string deliveryId;
    string? orderId = ();
    string? driverId = ();
    LocationCoordinates startLocation;
    LocationCoordinates destinationLocation;
    decimal stepSize = 0.1d;
    decimal currentProgress = 0.0d;
    LocationCoordinates currentLocation;
    decimal remainingDistanceKm;
    int remainingEtaMinutes;
    boolean isCompleted = false;
|};

# Represents the result of a single step progression.
public type SimulationStepResult readonly & record {|
    LocationCoordinates currentLocation;
    decimal remainingDistanceKm;
    int remainingEtaMinutes;
    decimal currentProgress;
    boolean isCompleted;
|};

# Interpolates intermediate coordinates between start and destination given a progress fraction.
#
# + startLoc - Starting location coordinates
# + destLoc - Destination location coordinates
# + progressFraction - Progress fraction between 0.0d and 1.0d
# + return - Interpolated location coordinates
public function interpolateCoordinates(LocationCoordinates startLoc, LocationCoordinates destLoc, decimal progressFraction) returns LocationCoordinates {
    if progressFraction <= 0.0d {
        return startLoc;
    }
    if progressFraction >= 1.0d {
        return destLoc;
    }

    decimal lat = startLoc.latitude + (destLoc.latitude - startLoc.latitude) * progressFraction;
    decimal lon = startLoc.longitude + (destLoc.longitude - startLoc.longitude) * progressFraction;

    return {
        latitude: lat,
        longitude: lon
    };
}

# Initializes a new route simulation from coordinates.
#
# + deliveryId - Identifier for the delivery
# + startLoc - Pickup / start location coordinates
# + destLoc - Dropoff / destination location coordinates
# + stepSize - Progression fraction per step (default 0.1d = 10%)
# + speedKmH - Average vehicle speed in km/h (default 40.0d)
# + orderId - Optional associated order ID
# + driverId - Optional assigned driver ID
# + return - Initialized RouteSimulation
public function initRouteSimulation(string deliveryId, LocationCoordinates startLoc, LocationCoordinates destLoc, decimal stepSize = 0.1d, decimal speedKmH = 40.0d, string? orderId = (), string? driverId = ()) returns RouteSimulation {
    decimal initialDistance = calculateHaversineDistance(startLoc, destLoc);
    int initialEta = calculateDynamicEta(initialDistance, speedKmH);
    return {
        deliveryId: deliveryId,
        orderId: orderId,
        driverId: driverId,
        startLocation: startLoc,
        destinationLocation: destLoc,
        stepSize: stepSize,
        currentProgress: 0.0d,
        currentLocation: startLoc,
        remainingDistanceKm: initialDistance,
        remainingEtaMinutes: initialEta,
        isCompleted: initialDistance == 0.0d
    };
}

# Creates a route simulation from an active delivery task.
#
# + task - The active DeliveryTask
# + restaurantLoc - Restaurant / pickup coordinates
# + customerLoc - Customer / destination coordinates
# + stepSize - Progression fraction per step (default 0.1d = 10%)
# + speedKmH - Average speed in km/h (default 40.0d)
# + return - Initialized RouteSimulation
public function createRouteSimulation(DeliveryTask task, LocationCoordinates restaurantLoc, LocationCoordinates customerLoc, decimal stepSize = 0.1d, decimal speedKmH = 40.0d) returns RouteSimulation {
    return initRouteSimulation(task.deliveryId, restaurantLoc, customerLoc, stepSize, speedKmH, task.orderId, task.driverId);
}

# Advances the route simulation by one step.
#
# + sim - The current route simulation state
# + speedKmH - Vehicle speed in km/h (default 40.0d)
# + return - Advanced RouteSimulation state
public function advanceSimulationStep(RouteSimulation sim, decimal speedKmH = 40.0d) returns RouteSimulation {
    if sim.isCompleted {
        return sim;
    }

    decimal nextProgress = sim.currentProgress + sim.stepSize;
    if nextProgress >= 1.0d {
        return {
            deliveryId: sim.deliveryId,
            orderId: sim.orderId,
            driverId: sim.driverId,
            startLocation: sim.startLocation,
            destinationLocation: sim.destinationLocation,
            stepSize: sim.stepSize,
            currentProgress: 1.0d,
            currentLocation: sim.destinationLocation,
            remainingDistanceKm: 0.0d,
            remainingEtaMinutes: 0,
            isCompleted: true
        };
    }

    LocationCoordinates newLoc = interpolateCoordinates(sim.startLocation, sim.destinationLocation, nextProgress);
    decimal remainingDistance = calculateHaversineDistance(newLoc, sim.destinationLocation);
    int remainingEta = calculateDynamicEta(remainingDistance, speedKmH);

    return {
        deliveryId: sim.deliveryId,
        orderId: sim.orderId,
        driverId: sim.driverId,
        startLocation: sim.startLocation,
        destinationLocation: sim.destinationLocation,
        stepSize: sim.stepSize,
        currentProgress: nextProgress,
        currentLocation: newLoc,
        remainingDistanceKm: remainingDistance,
        remainingEtaMinutes: remainingEta,
        isCompleted: false
    };
}

# Advances an active delivery task by a discrete step and returns the updated progress and ETA.
#
# + task - The active DeliveryTask
# + restaurantLoc - Pickup / restaurant coordinates
# + customerLoc - Destination / customer coordinates
# + currentProgress - Current progression fraction (0.0d - 1.0d)
# + stepIncrement - Progression increment per tick (default 0.1d = 10%)
# + speedKmH - Vehicle speed in km/h (default 40.0d)
# + return - SimulationStepResult with updated coordinates, remaining distance, ETA, and status
public function advanceTaskStep(DeliveryTask task, LocationCoordinates restaurantLoc, LocationCoordinates customerLoc, decimal currentProgress, decimal stepIncrement = 0.1d, decimal speedKmH = 40.0d) returns SimulationStepResult {
    decimal nextProgress = currentProgress + stepIncrement;
    if nextProgress >= 1.0d {
        return {
            currentLocation: customerLoc,
            remainingDistanceKm: 0.0d,
            remainingEtaMinutes: 0,
            currentProgress: 1.0d,
            isCompleted: true
        };
    }

    LocationCoordinates newLoc = interpolateCoordinates(restaurantLoc, customerLoc, nextProgress);
    decimal remainingDistance = calculateHaversineDistance(newLoc, customerLoc);
    int remainingEta = calculateDynamicEta(remainingDistance, speedKmH);

    return {
        currentLocation: newLoc,
        remainingDistanceKm: remainingDistance,
        remainingEtaMinutes: remainingEta,
        currentProgress: nextProgress,
        isCompleted: false
    };
}

# Simulates the full route from start to destination, returning each step snapshot.
#
# + task - The active DeliveryTask
# + restaurantLoc - Restaurant / pickup coordinates
# + customerLoc - Customer / destination coordinates
# + stepSize - Progression fraction per step (default 0.1d = 10%)
# + speedKmH - Vehicle speed in km/h (default 40.0d)
# + return - Array of RouteSimulation snapshots from start to completion
public function simulateFullRoute(DeliveryTask task, LocationCoordinates restaurantLoc, LocationCoordinates customerLoc, decimal stepSize = 0.1d, decimal speedKmH = 40.0d) returns RouteSimulation[] {
    RouteSimulation[] history = [];
    RouteSimulation currentSim = createRouteSimulation(task, restaurantLoc, customerLoc, stepSize, speedKmH);
    history.push(currentSim);

    while !currentSim.isCompleted {
        currentSim = advanceSimulationStep(currentSim, speedKmH);
        history.push(currentSim);
    }

    return history;
}
