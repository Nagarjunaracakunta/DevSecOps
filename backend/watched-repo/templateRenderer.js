// Demo file for the code analyzer to scan. Intentionally vulnerable.
function renderTemplate(userExpression, context) {
  const result = eval(userExpression); // arbitrary code execution risk
  return result;
}

module.exports = { renderTemplate };
