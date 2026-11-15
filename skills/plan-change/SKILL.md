---
name: plan-change
description: Lag en plan før koden skrives. Bruk når brukeren ber om en plan, eller før en stor endring med flere mulige løsninger.
args: "[endringen som skal planlegges]"
mode: code
---
# Plan a larger change

Change to plan: {{args}}

If nothing is given above, use what the user asked for in the conversation. Do not edit files while planning.

## 1. Understand the goal
Write down in two or three sentences what should be true when the work is done, and what is out of scope. If the goal can be read in two materially different ways, ask the user one short question now.

## 2. Map the code
- Find the files involved with `glob` and `search`. Read the important ones, do not skim file names.
- Note the existing patterns you will follow (how similar features are built, named and tested).
- Find how to check the result: tests, type check, build, or a page to open.

## 3. Choose an approach
If there is more than one reasonable way, name them in one line each with the main trade-off, and recommend one. Prefer the approach that changes the least and matches how the project already works.

## 4. Write the plan
Short and concrete:
- **Goal:** one sentence.
- **Steps:** 3 to 8 steps in order. Each names the files it touches and how it is checked. Each step should leave the project working.
- **Risks:** what could break, and what you will do about it (data migrations, public interfaces, deleted code, new dependencies).
- **Questions:** only those whose answer changes the plan.

## 5. Get agreement
Show the plan. Wait for the user's go-ahead only when they asked to see a plan first, or when the change deletes data, changes a public interface, the database or the build, or adds dependencies. Otherwise state the plan in a few lines and start.

## 6. Carry it out
Put the steps in `update_plan` and keep exactly one in progress. If you discover the plan is wrong, stop, say what you found and update the plan before continuing.
