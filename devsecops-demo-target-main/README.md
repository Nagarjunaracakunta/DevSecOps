# DevSecOps Copilot demo target

This deliberately vulnerable CommonJS project is the only repository the
SEC-103 workflow may repair. Its normal behavior tests pass before a repair.
The SQL-injection regression test is intentionally absent: a live Codex run
creates it from incident evidence before changing application code.

```bash
npm install
npm test
npm run lint
npm run security
```

`src/paymentService.js`, `src/templateRenderer.js`, and `src/userSearch.js`
retain intentional vulnerabilities for demonstration purposes.
