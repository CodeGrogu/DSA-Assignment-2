# SLA Breach - Live Demo

Who: Liina Massipa
Part of PR #155 - Defense documentation

This runbook shows how an SLA breach is detected, how the notification
fires, and how the breach appears in the admin report.

Prerequisite: you have already completed the walkthrough in
`admin_analytics.md`. This file only covers the SLA breach scenario.

---

## 1. What "SLA breach" means here

Our driver report uses a threshold: any delivery whose turnaround
(from assignment to delivery) exceeds 45 minutes is counted as a
breach. The threshold lives in
`services/admin_service/analytics.bal` as the constant `SLA_MINUTES`.

When a breach occurs, two notifications should fire:

- One to the customer: "We're sorry - your order is running late."
- One to the driver: "You've exceeded the SLA on this delivery."

Both are declared in the subscription matrix in
`modules/admin_domain/subscription_matrix.bal` under the event type
`delivery.sla_breach`.

---

## 2. Pre-demo setup

Same as `admin_analytics.md` section 2: Docker up, topics exist,
notification and admin service JARs built.

Also clear the audit log so the demo is clean:

```powershell
Remove-Item services\notification_service\audit.log -ErrorAction SilentlyContinue
```
