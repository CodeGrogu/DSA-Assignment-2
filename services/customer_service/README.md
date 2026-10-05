# Customer Service (`services/customer_service`)

The **Customer Service** manages customer identities, user profiles, authentication metadata, and address books with strict Namibian postal and geospatial verification. It operates on HTTP port `9093`.

---

## 1. Responsibilities & Architecture

- **Customer Profiles & Identity**: Manages verified customer records (`CUST-001` .. `CUST-010`) including full name, unique email address, and E.164 Namibian mobile numbers (`+26481...`).
- **Namibian Address Validation**: Validates addresses according to Namibian standards:
  - Street, suburb, city (Windhoek, Oshakati, Swakopmund, Walvis Bay).
  - 14 Regions of Namibia (Khomas, Erongo, Oshana, Karas, etc.).
  - 5-digit postal code format.
- **Geospatial Coordinates**: Stores GeoJSON 2dsphere points (`[longitude, latitude]`) with validation ensuring coordinates fall within the geographical boundaries of Namibia (latitude -29° to -17°, longitude 11° to 26°).
- **Persistence**: Persists in MongoDB `customer_db.customers` with unique index on `email` and 2dsphere index on `addresses.location`.

---

## 2. HTTP Endpoints

| Method | Path | Description | Expected Response |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Microservice health check | `{"status": "UP", "service": "customer_service", "port": 9093}` |
| `GET` | `/metrics` | Prometheus metrics scrape | Prometheus text metrics |
| `GET` | `/customers` | List registered customer profiles | Array of `Customer` profiles |
| `GET` | `/customers/{id}` | Fetch customer by ID | `Customer` record or `404` |
| `POST` | `/customers` | Register a new customer | Request: `Customer` → `201 Created` |
| `GET` | `/customers/{id}/addresses` | List saved delivery addresses | Array of `Address` objects |
| `POST` | `/customers/{id}/addresses` | Add a new delivery address | Request: `Address` → `201 Created` |
| `POST` | `/customers/verify-address` | Validate address without saving | `{"valid": true, "sanitizedAddress": ...}` |

---

## 3. Configuration (`Config.toml`)

```toml
[customer_service]
port = 9093
mongoUri = "mongodb://customer_user:customer_password@localhost:27017/customer_db?authSource=customer_db"
```

Environment variable overrides:
- `MONGO_URI`: Overrides MongoDB connection string.
