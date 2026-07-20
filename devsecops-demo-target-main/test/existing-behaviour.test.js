"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { chargeCustomer } = require("../src/paymentService");
const { renderTemplate } = require("../src/templateRenderer");
const { searchUsersByName } = require("../src/userSearch");

test("chargeCustomer preserves its public result", () => {
  const result = chargeCustomer(4200, "cus_demo");
  assert.equal(result.status, "charged");
  assert.equal(result.amount, 4200);
  assert.equal(result.customerId, "cus_demo");
});

test("renderTemplate evaluates the existing arithmetic example", () => {
  assert.equal(renderTemplate("2 + 3", {}), 5);
});

test("searchUsersByName submits a query and returns the database result", async () => {
  const calls = [];
  const db = {
    query(sql, params) {
      calls.push({ sql, params });
      return Promise.resolve([{ id: 7, name: "Ada" }]);
    }
  };

  assert.deepEqual(await searchUsersByName(db, "Ada"), [{ id: 7, name: "Ada" }]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /^SELECT \* FROM users WHERE name = /);
});
