---
name: gauntlet-loop
description: Flere runder med bygging, uavhengig kritikk og forbedring. Bruk når brukeren skriver gauntlet eller uttrykkelig ber om flere kritikkrunder.
args: "[oppgaven]"
mode: code
---

Task: {{args}}

If nothing is given above, apply this to the user's current request.

# Gauntlet Loop

Complete the user's requested task to an exceptional professional standard. Preserve the requested scope, deliverables, technology choices, and constraints.

Treat quality as something to demonstrate through the finished result, independent inspection, and relevant verification.

## Establish the quality target

Identify the requirements and define observable acceptance criteria appropriate to the task.

Cover the dimensions that materially affect the result, such as correctness, completeness, usability, visual quality, performance, reliability, accessibility, and maintainability.

When suitable references are available, use leading examples in the relevant field as concrete benchmarks. Inspect the references before making comparisons.

## Delegate the work

Fan out subagents across meaningful, independent workstreams when delegation is available. Give each agent a clear responsibility, acceptance criteria, and relevant context.

Coordinate shared interfaces and file ownership. Integrate the contributions into a coherent result and verify that they work together.

When subagents are unavailable, perform the same workstreams sequentially and disclose that limitation.

In Agentic Desktop, subagents are helper threads: start one with `thread_create` (give it a self-contained task), follow it with `thread_wait` and `thread_read`, and send follow-ups with `thread_send`. Helper threads share the project folder, so give each one its own files. Unless the user asks for more, run at most two helper threads at a time and at most three rounds of critique, and stop earlier when a round finds nothing material.

## Run independent critique

Assign a separate reviewer to inspect the actual result. The reviewer must be demanding, specific, and evidence-driven. In Agentic Desktop, use a new helper thread that receives only the result and the acceptance criteria, not your reasoning.

For visual work, inspect rendered output, screenshots, or the running interface. For functional work, exercise realistic workflows and inspect relevant test results. For other deliverables, evaluate the finished artifact using appropriate domain criteria.

Reviewers must identify concrete deficiencies, explain their impact, and describe what would satisfy the quality target. They must not approve work merely because the implementation agent considers it finished.

## Repeat the gauntlet

Repeat this cycle:

1. Build or improve the result.
2. Inspect and verify the actual output.
3. Obtain independent critique.
4. Prioritize and fix the identified deficiencies.
5. Recheck the changes and their effects on the integrated result.

Continue beyond the first working draft. Address substantive gaps throughout the requested scope.

Compare the result against the chosen references under comparable conditions. Use anonymized comparisons where practical, but claim a blind evaluation only when one was actually conducted.

## Completion

Finish when the acceptance criteria are satisfied, relevant checks pass, and independent review finds no unresolved material deficiencies.

Do not claim perfection, benchmark superiority, or successful verification without evidence.

If a genuine blocker, unavailable capability, or explicit resource limit prevents completion, report what remains and what is needed to continue.

Deliver the finished result with a concise account of verification and any remaining limitations.

Interpret “loop” as this iterative workflow. Use specialized loop commands only when the environment actually supports them.
