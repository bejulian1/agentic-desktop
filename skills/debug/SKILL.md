---
name: debug
description: Finn og rett årsaken til en feil – reproduser, finn årsaken, rett og bevis. Bruk når noe feiler, krasjer eller oppfører seg uventet.
args: "[feilmelding eller symptom]"
mode: code
---
# Debug

Problem to solve: {{args}}

If nothing is given above, use the failure the user described in the conversation.

Fix the cause, not the symptom. Do not change code until you can say what is wrong and why.

## 1. Reproduce
- Get the exact error: run the failing command or test with `run_command` and read the whole message and stack trace. For a web page, use `browser_navigate` and `browser_console`.
- If you cannot reproduce it, read the code path the error points to. Fix only when you can point to the line that causes it, and say that the fix is unverified. Otherwise ask for the missing input, command or steps.

## 2. Locate
- Start from the first frame of the stack trace that is in this project, not in a library.
- Use `search` for the error text, the function name and where it is called. Read the code around it with `read_file`.
- Check what changed recently: `git log --oneline -10` and `git diff`.

## 3. Find the cause
- Write one sentence: "It fails because X, which happens when Y."
- Test that sentence before fixing: add a temporary log line, run a smaller case, or read the value at the failing line.
- If the test disproves it, drop the idea and form a new one. After three wrong ideas, stop and re-read the error from the top.

## 4. Fix
- Make the smallest change that removes the cause. Keep the style of the surrounding code.
- Do not hide the error with a broad try/catch, a default value or a skipped test.
- Remove temporary logging.

## 5. Prove it
- Run the original failing command again. It must pass.
- Add or update a test that fails without the fix, when the project has tests.
- Run the related tests to check nothing else broke.

## Report
State the cause in one or two sentences, the files you changed, and the commands you ran with their results. If something is still unverified, say which part.
