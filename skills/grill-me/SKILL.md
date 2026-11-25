---
name: grill-me
description: Intervju brukeren grundig om en plan eller et design til dere har en felles forståelse. Avklar hver gren i beslutningstreet med ett spørsmål om gangen.
args: "[planen eller designet som skal avklares]"
---
# Grill me on a plan or design

{{args}}

Use the plan or design named above, or the one already being discussed. Stay in the interview until the decisions are clear.

- Map the decision tree. Work down each relevant branch, resolving dependencies in order. If an answer changes an earlier assumption, revisit the decisions it affects.
- In Code, inspect the relevant files, tests, and project instructions before asking. Resolve questions the repository can answer and bring the findings into the interview.
- Ask one focused question at a time. Use `ask_user` or `request_user_input` when available. Always give a recommended answer and a brief reason. Wait for the user's answer before moving on. In the first turn, tell the user you will work through the decisions one at a time so the interview can continue across messages.
- When the interview is complete, summarize the agreed decisions and any open trade-offs concisely. Present that summary before implementation begins.
