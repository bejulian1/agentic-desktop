---
name: skill-creator
description: Lag eller forbedre en skill i Agentic Desktop. Bruk når brukeren ber om en ny skill, eller en framgangsmåte bør kunne gjenbrukes.
args: "[hva skillen skal gjøre]"
mode: code
---
# Create a skill for Agentic Desktop

Skill to create or improve: {{args}}

A skill is a short set of instructions the agent loads when a task matches. It teaches a procedure or project knowledge the model does not already have. It gives no extra tools or permissions.

## When a skill is worth it
- The same multi-step procedure will be needed again.
- There is project-specific knowledge that is not obvious from the code: how to deploy, how to run a tricky test setup, a house style.
- The user taught you how they want something done.

Not worth it: a one-off task, general knowledge any model has, or a log of what happened today.

## Format
One folder with one file, `SKILL.md`:

```markdown
---
name: run-e2e-tests
description: Kjør ende-til-ende-testene mot lokal server og tolk resultatet. Bruk før en endring i innlogging eller betaling regnes som ferdig.
args: "[testfil eller område]"
---
Steps in Markdown. Write the word args inside double curly braces where the user's text after the command should be inserted.
```

- `name`: lowercase letters, digits and hyphens, at most 64 characters, same as the folder name. Do not reuse the name of a built-in command (`plan`, `status`, `model`, `help`, …).
- `description`: at most 1024 characters. It is the only part always in the system prompt, so it decides whether the skill gets used. Say what it does and when to use it, with the words a user would use.
- `args`: optional hint shown in the `/` menu.
- `mode`: optional, `code` or `chat`. Set `code` when the steps use file, command or browser tools, so the skill is not offered in Chat. Leave it out for a skill that works in both.
- The body is the only file that is loaded. Do not depend on extra files next to it. In a project skill you may point to files in the project by relative path; the agent can read those.

## Where skills live
- For every project: the user's skills folder (`~/.config/agentic-desktop/skills/<name>/SKILL.md`).
- For one project: `.agentic/skills/<name>/SKILL.md` in the project folder.
- The skills that ship with the app are read-only. To change one, create your own with the same name; it wins.

## How to save it
Use the `propose_skill` tool with `name`, `description`, `instructions` (the body) and `scope` (`user` or `project`). The user may be asked to approve it. At most one new skill per task. `propose_skill` writes the frontmatter itself, with only `name` and `description`: put no frontmatter in `instructions`. When `args` or `mode` is needed, tell the user to add that line in Innstillinger → Skills.

If `propose_skill` is not offered, the user has turned skills from the agent off. Describe the skill in your answer instead; do not write the file another way.

When a verified correction changes an existing user or project procedure, load the skill and use `propose_skill_edit` with the smallest unique old passage and its replacement. The user reviews the change before it is written.

## Writing the body
- Start with one line saying what the task is, with the args placeholder (the word args in double curly braces) where the user's text goes. Add a fallback line for when it is empty.
- Numbered steps in the order they are done. Exact commands, file paths and tool names.
- Say what "done" looks like and how to check it.
- Name the two or three mistakes that are easy to make.
- Keep it under about 400 words. Leave out anything a capable model would do anyway.
- Write general steps, not a story about this session. No dates, no "today we".
- Never put keys, tokens or passwords in a skill. Refer to an environment variable by name instead.

## Test it
Read the description alone and ask: would this be picked for the right task, and left alone for the wrong one? Then read the steps as someone who has not seen this conversation, and fix every place where they would have to guess. Do not redo work to test it.

Tell the user the skill's name, where it was saved and how to run it (`/name` in the message field).
