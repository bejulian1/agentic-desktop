---
name: explore
description: Kartlegg en ukjent kodebase: struktur, inngangspunkter, bygg og test. Bruk når brukeren ber om oversikt over prosjektet.
args: "[område eller spørsmål]"
mode: code
---
# Explore a codebase

Focus: {{args}}

If nothing is given above, use what the user asked for in the conversation; only if they named no area, give an overview of the whole project. This skill only reads; do not change files.

## 1. Read what the project says about itself
`README*`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING*`, `docs/`. Then the manifest: `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Makefile`. From these get: language and framework, how to install, run, test and build.

## 2. Map the structure
- `list_dir` on the top level and the main source folders. Use `glob` for patterns like `src/**/*.ts`.
- Find the entry points: `main`, `index`, `app`, the scripts in the manifest, route or command definitions.
- Follow one real path through the code from entry point to result (for example one request or one command) and read each file on the way.

## 3. Answer the question
For a focused question, search for the names involved, read the definitions and their callers, and stop when you can answer with file and line references.

## 4. Check, do not assume
- Run the test or build command once if it is cheap, to confirm it works here.
- Do not describe files you have not opened. Mark anything you inferred from names as an assumption.

## Report
Keep it short and useful for the next task:
- what the project is and its main technologies
- the folder layout, one line per important folder
- entry points and the path you followed
- the exact commands to run, test and build, and whether you ran them
- conventions worth following and anything surprising

If `remember` is offered and you learned a lasting fact that will save time later (the test command, a required environment variable name, a naming rule), save it in one short call, scope project.
