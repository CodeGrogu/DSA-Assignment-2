# Real-Time Operations Web Dashboard

A lightweight, zero-dependency operations monitor for the Food Delivery Microservices platform.

## Features
- **Real-Time KPI Cards**: Total Orders, Gross Merchandise Value (NAD), Successful Payments, Failed Payments, and Active Deliveries queried directly from `admin_service` (`GET :9098/admin/stats/overview`).
- **Live Health Status Grid**: Visual indicators (`UP` / `DOWN`) across all 7 platform microservices:
  - `order_service` (:9091)
  - `customer_service` (:9093)
  - `payment_service` (:9094)
  - `restaurant_service` (:9095)
  - `delivery_service` (:9096)
  - `notification_service` (:9097)
  - `admin_service` (:9098)
- **Automatic 5s Polling**: Refreshes metrics every 5 seconds with status indicators and a manual "Refresh Now" trigger.
- **Audit Table**: Shows recent dispatched notifications from `notification_service`.

## Running the Dashboard

Ensure backend services are running:
```bash
docker compose -f docker/docker-compose.services.yml up -d
```

### Option 1: Python HTTP Server (Recommended)
```bash
python -m http.server 3000 -d web/admin_dashboard
```
Then visit `http://localhost:3000` in any web browser.

### Option 2: Direct File Open
You can open `web/admin_dashboard/index.html` directly in modern web browsers (Chrome, Edge, Firefox).
