// Payload we send to a single recipient over a single channel.
// Keeping this small so it's easy to log and store in Mongo.
public type NotificationPayload record {|
    string notificationId;
    RecipientRole role;
    string recipientId;
    Channel channel;
    Severity severity;
    string subject;
    string body;
    string relatedEventType;
    string relatedEventId;
    string createdAt;
|};

// One row in the audit log. Once it's written we never change it.
public type NotificationAuditRecord record {|
    string notificationId;
    RecipientRole role;
    string recipientId;
    Channel channel;
    Severity severity;
    string payload; // JSON string of the full NotificationPayload
    string status; // "SENT", "FAILED", "SKIPPED"
    string sentAt;
|};

// Rule that says "when this event happens, notify this role
// on this channel, at this severity".
public type SubscriptionRule record {|
    string eventType; // e.g. "order.created"
    RecipientRole recipient; // who gets told
    Channel channel; // how they get told
    Severity severity; // how loud it is
    string template; // which message template to use
|};
