---
name: review
description: Kodegjennomgang uten å endre filer. Bruk når brukeren ber om en gjennomgang eller vurdering av kode.
args: "[fil, område eller problemstilling]"
mode: code
---
# Code review

Review this: {{args}}

If nothing is given above, use what the user asked for in the conversation. Only if they named no file or area, review the uncommitted changes (`git diff` and `git status`); if there are none, pick a clearly bounded area and say which one you chose.

Do not change any files during the review.

## Read first
- The diff or the files in scope, completely. Do not review code you have not read.
- The code the changes call and the code that calls them (`search` for the function names).
- The project's own instructions and conventions (AGENTS.md, README, nearby tests).

## Look for, in this order
1. **Wrong behaviour:** logic errors, off-by-one, wrong condition, missing await, unhandled null or empty input, wrong error handling.
2. **Regressions:** callers that relied on the old behaviour, changed defaults, removed checks.
3. **Security:** unvalidated input reaching a query, a shell command, a file path or HTML; secrets in code; missing permission checks.
4. **Data loss and concurrency:** overwrites, races, partial writes, missing transactions.
5. **Missing tests** for the new or changed behaviour.

Skip pure style preferences and things a formatter or linter handles.

## Confirm each finding
For every finding, re-read the exact lines and check that the problem is real. Describe the concrete situation that triggers it and what goes wrong. If you are not sure, say it is uncertain instead of presenting it as a fact.

## Answer
Most serious first. For each finding give:
- severity (critical, high, medium, low)
- file and line
- what triggers it and what happens
- a concrete suggested fix

End with what you did not check. If you found nothing, say so plainly.
