// Seed customer profiles into customer_db.
// The script is idempotent: existing customers are updated instead
// of being inserted again.

const customers = [
  {
    id: "CUST-001",
    name: "Amelia Shilongo",
    email: "amelia.shilongo@example.com",
    phone: "+264811234501",
    addresses: [
      {
        id: "ADDR-001",
        tag: "Home",
        street: "12 Independence Avenue",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "10005",
        location: {
          type: "Point",
          coordinates: [17.0658, -22.5609]
        },
        deliveryInstructions: "Please call when you arrive.",
        isDefault: true
      }
    ]
  },
  {
    id: "CUST-002",
    name: "Daniel Amutenya",
    email: "daniel.amutenya@example.com",
    phone: "+264811234502",
    addresses: [
      {
        id: "ADDR-002",
        tag: "Home",
        street: "45 Sam Nujoma Drive",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "10006",
        location: {
          type: "Point",
          coordinates: [17.0836, -22.5687]
        },
        deliveryInstructions: "Leave the order with security if unavailable.",
        isDefault: true
      }
    ]
  },
  {
    id: "CUST-003",
    name: "Maria Ndeitunga",
    email: "maria.ndeitunga@example.com",
    phone: "+264811234503",
    addresses: [
      {
        id: "ADDR-003",
        tag: "Work",
        street: "8 Robert Mugabe Avenue",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "10007",
        location: {
          type: "Point",
          coordinates: [17.0894, -22.5671]
        },
        deliveryInstructions: "Deliver between 12:00 and 14:00.",
        isDefault: true
      }
    ]
  },
  {
    id: "CUST-004",
    name: "Thomas Nangolo",
    email: "thomas.nangolo@example.com",
    phone: "+264811234504",
    addresses: [
      {
        id: "ADDR-004",
        tag: "Home",
        street: "23 Dr Kenneth Kaunda Street",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "10008",
        location: {
          type: "Point",
          coordinates: [17.0762, -22.5515]
        },
        deliveryInstructions: "Gate is on the left side of the property.",
        isDefault: true
      }
    ]
  },
  {
    id: "CUST-005",
    name: "Selma Uusiku",
    email: "selma.uusiku@example.com",
    phone: "+264811234505",
    addresses: [
      {
        id: "ADDR-005",
        tag: "Home",
        street: "17 Nelson Mandela Avenue",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "10009",
        location: {
          type: "Point",
          coordinates: [17.0951, -22.5742]
        },
        deliveryInstructions: "Please ring the bell at the main entrance.",
        isDefault: true
      }
    ]
  },
  {
    id: "CUST-006",
    name: "Michael Katjivena",
    email: "michael.katjivena@example.com",
    phone: "+264811234506",
    addresses: [
      {
        id: "ADDR-006",
        tag: "Work",
        street: "31 Fidel Castro Street",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "10010",
        location: {
          type: "Point",
          coordinates: [17.0798, -22.5554]
        },
        deliveryInstructions: "Deliver to reception.",
        isDefault: true
      }
    ]
  },
  {
    id: "CUST-007",
    name: "Anna Hamutenya",
    email: "anna.hamutenya@example.com",
    phone: "+264811234507",
    addresses: [
      {
        id: "ADDR-007",
        tag: "Home",
        street: "6 Lazarette Street",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "10011",
        location: {
          type: "Point",
          coordinates: [17.0719, -22.5831]
        },
        deliveryInstructions: "Please do not leave the food outside.",
        isDefault: true
      }
    ]
  },
  {
    id: "CUST-008",
    name: "Samuel Iiyambo",
    email: "samuel.iiyambo@example.com",
    phone: "+264811234508",
    addresses: [
      {
        id: "ADDR-008",
        tag: "Work",
        street: "14 Hosea Kutako Drive",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "10012",
        location: {
          type: "Point",
          coordinates: [17.0735, -22.5398]
        },
        deliveryInstructions: "Call the customer upon arrival.",
        isDefault: true
      }
    ]
  },
  {
    id: "CUST-009",
    name: "Lydia Shapua",
    email: "lydia.shapua@example.com",
    phone: "+264811234509",
    addresses: [
      {
        id: "ADDR-009",
        tag: "Home",
        street: "29 Beethoven Street",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "10013",
        location: {
          type: "Point",
          coordinates: [17.1024, -22.5488]
        },
        deliveryInstructions: "Use the side gate for delivery.",
        isDefault: true
      }
    ]
  },
  {
    id: "CUST-010",
    name: "Joseph Nambahu",
    email: "joseph.nambahu@example.com",
    phone: "+264811234510",
    addresses: [
      {
        id: "ADDR-010",
        tag: "Home",
        street: "52 Bach Street",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "10014",
        location: {
          type: "Point",
          coordinates: [17.1102, -22.5617]
        },
        deliveryInstructions: "Deliver during normal business hours.",
        isDefault: true
      }
    ]
  }
];

const customerDb = db.getSiblingDB("customer_db");
const collection = customerDb.customers;

customers.forEach(function (customer) {
  const result = collection.updateOne(
    { id: customer.id },
    { $set: customer },
    { upsert: true }
  );

  print(
    customer.id +
    " -> " +
    (result.upsertedId ? "inserted" : "updated")
  );
});

print("Customer seed completed. Total customers: " + collection.countDocuments());
