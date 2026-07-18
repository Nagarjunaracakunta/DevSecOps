// Demo file for the code analyzer to scan. Intentionally vulnerable.
function chargeCustomer(amount, customerId) {
  const stripeApiKey = "sk_live_51Hxxxxxxxxxxxxxxxxxxxx"; // hardcoded secret
  console.log(`Charging ${customerId} amount ${amount} with key ${stripeApiKey}`);
  return { status: "charged", amount };
}

module.exports = { chargeCustomer };
