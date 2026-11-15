---
name: verify
description: Sjekkliste for egne endringer før commit, eller når brukeren ber om en grundig kontroll.
args: "[hva som er endret]"
mode: code
---
# Verify before done

What was changed: {{args}}

Run this after you have changed code and before you tell the user it is finished, and before any commit.

## 1. Read your own diff
- `git status` and `git diff` (plus `git diff --cached` if something is staged). In a folder without git, re-read each file you changed.
- For every hunk you made in this thread ask: is this needed for the task? Remove your own leftover debug output, commented-out code, stray edits and TODOs.
- Changes you did not make belong to the user or another thread. Never revert them; mention them only if they break the checks.

## 2. Scan the added lines
- Secrets: keys, tokens, passwords, private URLs. Never commit them.
- Dangerous calls with outside input: `eval`, shell commands built from strings, SQL built from strings, file paths from user input.
- Error handling for I/O, network and parsing that can fail.

## 3. Run the checks
- Run the project's tests, type check, lint and build (see "Checks" in the environment), in single-run mode, not watch mode. For long output use `set -o pipefail; <command> | tail -40`, so a failure still shows as a failure.
- Compare with the state before your change: only failures you introduced count against you, but list the old ones too.
- For UI changes, open the page with the browser tools, exercise the changed part and read `browser_console`.

## 4. Fix and repeat
Fix what you found, then run the affected checks again. Stop after two rounds on the same failure and report it instead of guessing further.

## Report
- What changed (files).
- Which commands you ran and their results, with counts.
- What you could not check and why.

Never write "tested", "works" or "verified" for something you did not run. "Not tested" is an acceptable answer; a wrong "tested" is not.
