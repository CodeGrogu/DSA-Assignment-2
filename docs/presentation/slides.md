# Defense Slide Outline

Part of PR #155 - Defense documentation

Rough slide-by-slide outline for the 15-30 minute slot.
Expand or trim as needed.

---

## Slide 1 - Title

- Distributed Food Delivery Platform
- Team Peer Pressure
- DSA612S - Distributed Systems and Applications
- Date of defense

---

## Slide 2 - The problem

- Local SMEs: restaurants and delivery drivers
- Ministry wants a platform that handles peak meal times
- Independent actors: customers, restaurants, drivers
- Requirements: high concurrency, fault tolerance

---

## Slide 3 - Architecture

- Six microservices connected by Kafka
- Each service owns its own data
- No direct service-to-service HTTP calls
- Diagram: services on the outside, Kafka topics in the middle

Key point:

- Event-driven, not request-response

---

## Slide 4 - Shared contract (admin_domain)

- Types every service imports
- `NotificationPayload`, `NotificationAuditRecord`, `SubscriptionRule`
- `PlatformOverview`, `RestaurantReport`, `DriverReport`
- The subscription matrix - "when X happens, notify Y on Z"

Key point:

- One source of truth for cross-service contracts

---

## Slide 5 - Notification service

- Multi-topic Kafka consumer
- Subscribes to: orders, payments, kitchen, delivery events
- Looks up rules from the subscription matrix
- Writes an audit record for every dispatch
- Exposes `GET /notifications/recipient/{id}`

Key point:

- Fan-out from one event to many channels

---

## Slide 6 - Admin service

- HTTP API on port 9098
- Three endpoints:
  - `/admin/stats/overview` - orders, GMV, payments, active deliveries
  - `/admin/reports/restaurant` - revenue, commission, payout
  - `/admin/reports/driver` - turnaround, SLA breaches
- Date range filtering via query parameters

Key point:

- Real aggregation logic, not just a passthrough

---

## Slide 7 - Demo (live or recorded)

- Publish an event to Kafka
- Watch the notification service consume it
- Query the audit log
- Hit the HTTP endpoint
- Show the admin overview and reports

See `docs/defense/admin_analytics.md` for the exact commands.

---

## Slide 8 - SLA breach scenario

- Publish a `delivery.sla_breach` event
- Two notifications fire: customer + driver
- Both at CRITICAL severity via SMS
- Breach count appears in the driver report

See `docs/defense/sla_breach.md` for the exact commands.

---

## Slide 9 - What is built vs scaffolded

**Fully working:**

- admin_domain
- notification_service
- admin_service

**Scaffolded only:**

- order_service, payment_service, delivery_service
- restaurant_service, customer_service
- Each has a health endpoint and depends on the events contract

Key point:

- Being honest about the scope is a feature, not a weakness

---

## Slide 10 - Known limitations

- Ballerina MongoDB connector 5.2.4 could not authenticate
  against our dockerised Mongo
- Worked around by writing audit records to a file
- Interface is unchanged; swapping back is a small change
- The other five services are scaffolded, not implemented

Key point:

- We identified, documented, and worked around a real issue

---

## Slide 11 - Design decisions

- Kafka instead of direct HTTP between services
- Consumer group with `autoCommit: false` for at-least-once delivery
- Subscription matrix in a shared module (not hardcoded per service)
- File-based audit for the demo (swap-able)

Key point:

- Every choice trades off something

---

## Slide 12 - Q&A

- Leave this on screen while taking questions
- Common questions and answers are in
  `docs/defense/admin_analytics.md` section 4

---

## Timing guide

- Slides 1-2: 1 minute
- Slides 3-6: 5 minutes
- Slides 7-8: 5 minutes (demo)
- Slides 9-11: 3 minutes
- Slide 12: rest of the slot

Total: about 15 minutes plus Q&A.
