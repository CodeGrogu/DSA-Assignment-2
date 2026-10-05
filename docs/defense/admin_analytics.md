# Admin Analytics & Notification — Defense Walkthrough

Who: Liina Massipa
Time budget: 15–30 minutes
Format: Live demo, followed by Q&A

This document is the runbook for the live demonstration. Every command
has an expected output so we can spot problems early during rehearsal.

---

## 1. What actually works vs. what is scaffolded

**Fully working:**

- `notification_service` — Kafka consumer, event parser, subscription rules,
  audit log, `GET /notifications/recipient/{id}`
- `admin_service` — `/health`, `/admin/stats/overview`,
  `/admin/reports/restaurant`, `/admin/reports/driver`
- `admin_domain` module — the shared types and rules

**Scaffolded only:**

- `order_service`, `payment_service`, `delivery_service`, `restaurant_service`,
  `customer_service` — each has a health endpoint on its own port and a
  dependency on the `events` contract module. No business logic yet.

We chose to demo what works rather than fake the rest.

---

## 2. Pre-demo checklist (do this 10 minutes before the slot)

Run these once. If any fails, fix it before the audience arrives.

### 2.1 Docker containers up

```powershell
docker ps
```
