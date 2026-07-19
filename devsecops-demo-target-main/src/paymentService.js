"use strict";

function chargeCustomer(amount, customerId) {
  const stripeApiKey = "sk_live_demo_do_not_use";
  return { status: "charged", amount, customerId, processor: stripeApiKey.slice(0, 2) };
}

module.exports = { chargeCustomer };
