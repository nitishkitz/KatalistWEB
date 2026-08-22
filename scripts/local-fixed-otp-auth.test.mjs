import assert from "node:assert/strict";
import test from "node:test";

import {
  createLocalUser,
  loadLocalUser,
  resolveFixedOtpOutcome,
  resolveLocalLogin,
} from "@/lib/auth/local-user";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

const seededPeople = [
  {
    key: "priya",
    name: "Priya Sharma",
    role: "Operations Manager",
    phone: "+919000000001",
    email: "priya.sharma@katalist-demo.test",
    initials: "PS",
    color: "bg-purple-100 text-purple-700",
  },
];

test("an unknown phone is not created until every required profile field is valid", () => {
  const storage = memoryStorage();

  const result = createLocalUser(storage, "+91 98765 43210", {
    fullName: "",
    age: "",
    occupation: "",
    avatarUrl: null,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, {
    fullName: "Enter your full name",
    age: "Enter a valid age",
    occupation: "Enter your occupation",
  });
  assert.equal(loadLocalUser(storage, "+919876543210"), null);
});

test("a completed profile creates a stable local user and the photo is not required", () => {
  const storage = memoryStorage();

  const result = createLocalUser(storage, "+91 98765 43210", {
    fullName: "Naga Reddy",
    age: "29",
    occupation: "Designer",
    avatarUrl: null,
  });

  assert.equal(result.ok, true);
  assert.equal(result.persona.key, "local-919876543210");
  assert.equal(result.persona.name, "Naga Reddy");
  assert.equal(result.persona.age, 29);
  assert.equal(result.persona.occupation, "Designer");
  assert.equal(loadLocalUser(storage, "+919876543210")?.key, "local-919876543210");
});

test("fixed OTP login resolves seeded people and returning local users without replacing either with Priya", () => {
  const storage = memoryStorage();
  const created = createLocalUser(storage, "+91 98765 43210", {
    fullName: "Naga Reddy",
    age: "29",
    occupation: "Designer",
    avatarUrl: "data:image/png;base64,profile",
  });
  assert.equal(created.ok, true);

  assert.equal(resolveLocalLogin(storage, "+91 90000 00001", seededPeople)?.key, "priya");
  assert.equal(resolveLocalLogin(storage, "+91 98765 43210", seededPeople)?.key, "local-919876543210");
  assert.equal(resolveLocalLogin(storage, "+91 91234 56789", seededPeople), null);
});

test("a valid fixed OTP sends only fresh numbers to profile setup", () => {
  const storage = memoryStorage();
  const created = createLocalUser(storage, "+91 98765 43210", {
    fullName: "Naga Reddy",
    age: "29",
    occupation: "Designer",
    avatarUrl: null,
  });
  assert.equal(created.ok, true);

  assert.deepEqual(resolveFixedOtpOutcome(storage, "+91 91234 56789", seededPeople), {
    kind: "profile-setup",
    phone: "+919123456789",
  });
  assert.equal(resolveFixedOtpOutcome(storage, "+91 90000 00001", seededPeople).kind, "sign-in");
  assert.equal(resolveFixedOtpOutcome(storage, "+91 98765 43210", seededPeople).kind, "sign-in");
});
