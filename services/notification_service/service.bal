// Notification service entry point.
// Real HTTP endpoint comes later — for now this file just reserves the module entry.

import ballerina/log;

public function main() returns error? {
    log:printInfo("notification_service starting — Kafka consumer attached");
}
