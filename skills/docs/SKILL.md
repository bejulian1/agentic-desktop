---
name: docs
description: Skriv eller oppdater dokumentasjon som stemmer med koden. Bruk når brukeren ber om dokumentasjon.
args: "[hva som skal dokumenteres]"
mode: code
---
# Write documentation

What to document: {{args}}

If nothing is given above, use what the user asked for in the conversation.

## 1. Find the facts in the code
- Read the code you are documenting. Do not describe behaviour from memory or from the function name.
- Run every command you plan to show (install, run, test) when that is safe and cheap. If you could not run one, say so next to it.
- Read the existing docs first and match their language, tone, heading style and level of detail. Update the existing file instead of adding a second one that overlaps.

## 2. Decide who reads it
- **A new user** needs: what this is, how to install and start it, one working example.
- **A developer** needs: how the parts fit, how to run tests, the conventions to follow.
- **Someone looking something up** needs: exact names, options, defaults and return values.
Write for one of them at a time.

## 3. Write
- Start with what the thing is and what it is for, in one or two sentences.
- Put the most common task first. Show a complete, copyable example before the details.
- Use the exact names from the code. Put commands and code in code blocks.
- Short sentences, active voice, concrete words. Say what happens, not that something "can be leveraged".
- State limits and known problems plainly.

## 4. Comments in code
Comment why, not what: a constraint, a non-obvious reason, a trap. Do not add comments that repeat the code or describe your change history.

## 5. Check
- Every command, path, option and name in the text exists in the project right now (`search` for each).
- Links and file references resolve.
- Nothing describes a feature that is planned but not built, unless marked as such.

Report which files you wrote or changed and which commands you actually ran.
