// Demo file for the code analyzer to scan. Intentionally buggy: a single
// slow/unresponsive upstream call fails the whole charge with no retry.
async function chargeViaGateway(gateway, chargeRequest) {
  const response = await gateway.post("/charge", chargeRequest, { timeoutMs: 5000 });
  return response;
}

module.exports = { chargeViaGateway };
