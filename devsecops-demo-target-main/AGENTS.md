# Repository repair instructions

- Inspect incident evidence before modifying code.
- Create a regression test before implementing a fix.
- Prove the regression test fails against the vulnerable code.
- Make the smallest safe change.
- Run all tests after the patch.
- Do not use `eval`, `Function`, shell execution, or dynamic code execution.
- Preserve public interfaces.
- Do not modify unrelated files.
- Report root cause, evidence, files changed, commands, before/after test results, and remaining risks.
