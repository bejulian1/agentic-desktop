---
name: memory
description: Hva som skal huskes med remember og forget. Bruk når brukeren retter deg, sier en varig preferanse eller ber deg huske noe.
args: "[hva som skal huskes eller ryddes]"
mode: code
---
# Memory

What to remember or tidy: {{args}}

Agentic Desktop keeps short memories in plain Markdown files, one line per memory:
- **Global**, about the user: `MEMORY.md` in the app's configuration folder (`~/.config/agentic-desktop/`).
- **Project**, about this codebase: `.agentic/MEMORY.md` in the project folder.

The saved memories are added to your instructions at the start of each thread. Save with the `remember` tool (`text`, and `scope` `project` or `global`) and remove with `forget`. The user may be asked to approve. Never edit the MEMORY.md files directly. If the tools are not offered, memories are switched off: do not claim you saved anything.

## Save when
- **The user corrects you:** "no, use pnpm", "don't touch that folder", "I told you before". Save the rule, not the incident.
- **The user states a lasting preference:** "always answer in Norwegian", "I prefer small commits".
- **You learn a project fact that saves time next time:** the command that runs the tests, a port, a required environment variable (the name, never the value), a naming convention, a known trap.

## Do not save
- One-off instructions for the current task ("rename this variable").
- What you did today, progress notes, or anything already in the code, README or git history.
- Guesses. Never infer a preference from silence or from one example.
- Secrets: keys, tokens, passwords, personal data. They are refused.

## How to write a memory
One sentence, at most 300 characters, true on its own without this conversation:
- Good: `Run tests with "npm run test:server"; UI tests need a build first.`
- Good: `The user wants commit messages in Norwegian.`
- Bad: `Fixed the bug in the login today.`

Choose `global` for facts about the user and `project` for facts about this codebase.

## Keep it true
- Before saving, check the listed memories. Update the meaning by forgetting the old one and saving the new one; do not add a near-duplicate.
- When a memory turns out wrong or outdated, `forget` it at once.
- What the user says now always wins over an older memory.

## Memory or skill?
A fact or a preference is a memory. A procedure with several steps that will be needed again is a skill: load `skill-creator` and save it with `propose_skill`.

Do not interrupt the user's task to collect memories. Save at a natural pause, in one short call, and carry on.
