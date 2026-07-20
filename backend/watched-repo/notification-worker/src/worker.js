// Demo file for the code analyzer to scan. Intentionally buggy: no guard
// against a malformed message with a missing user, so the worker crashes
// instead of skipping it.
function process(message) {
  return handleNotification(message.payload.user.id, message.payload.template);
}

module.exports = { process };
