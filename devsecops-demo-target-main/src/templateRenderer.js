"use strict";

function renderTemplate(userExpression, context) {
  return eval(userExpression);
}

module.exports = { renderTemplate };
