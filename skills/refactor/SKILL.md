---
name: refactor
description: Endre struktur uten å endre oppførsel, i små trygge steg. Bruk når brukeren ber om opprydding, omdøping eller oppdeling.
args: "[hva som skal ryddes]"
mode: code
---
# Refactor safely

What to restructure: {{args}}

If nothing is given above, use what the user asked for in the conversation. A refactor changes structure, never behaviour. If you find a bug on the way, report it; do not fix it inside the refactor unless the user says so.

## Before you touch anything
1. Run the tests and type check. Note the result. If the code has no tests covering it, say so, and add a few tests that pin down the current behaviour first when that is feasible.
2. Find every use of what you will change with `search` (also in tests, config, docs and string references).
3. Decide the target shape and say it in one or two sentences.

## Work in small steps
One kind of change per step, for example:
- rename a symbol everywhere
- extract a function or module
- move a file and update imports
- remove dead code you have confirmed is unused
- replace duplication with one shared function

After each step run the type check or the fastest relevant tests. If something breaks, fix it or undo that step before going on.

## Keep it honest
- Do not change public names, signatures, file formats, routes or output unless the user asked for it. If you must, list every caller you updated.
- Do not mix in new features, formatting sweeps or dependency upgrades.
- Keep the project's existing style and patterns, even if you would choose differently.
- Three similar lines are fine. Do not add abstractions for one caller.

## Done when
- Tests and type check give the same result as before, or better.
- Every file you changed belongs to the refactor. Changes in the folder that you did not make belong to the user or another thread: leave them alone.

Report what changed in structure, what you ran, and anything you chose to leave alone and why.
