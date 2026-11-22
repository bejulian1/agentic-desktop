---
name: council
description: "Manual only. Use only when the user explicitly asks to use the council skill for independent multi-model feedback."
disable-model-invocation: true
args: "[decision, change, or scope to review]"
mode: code
---

# Model Council

Run only on an explicit request such as **“Use the council skill to audit this PR”** or **“Bruk council skill.”** A bare name or ordinary request for feedback is not activation. Ask if unclear.

Explicit selection in the skill menu also counts. If supplied, use this brief: {{args}}

1. **Prepare a common brief.** State the decision or scope, constraints, evidence, and exact revision or snapshot. For code, run relevant checks where possible and identify known issues. Fix them before review only if implementation changes are in scope; skip that step when exploring replacements.
2. **Select three independent reviewers.** Honor named models or providers. Otherwise choose one capable model from each of three distinct providers, with high reasoning effort where available. If a named reviewer or a third provider is unavailable, report the gap and ask before substituting or reducing the council.
3. **Review in parallel.** Give each reviewer the same brief without the others' conclusions. Keep reviews read-only and don't edit the reviewed snapshot during the pass. In T3 Code, follow the native or cross-provider delegation rules as applicable, never top-level threads. Use fresh review tasks for rechecks and honor completion notifications. Elsewhere, use supported delegation tools.
4. **Synthesize, don't vote.** Verify important claims. Separate agreement, genuine disagreement, and unverified suggestions. For code reviews, request a score out of 10 with rationale; record `no score` if missing and never infer approval from a score. Do not wait for feedback explicitly marked non-blocking or count it in completed scores.
5. **Stop deliberately.** Default to one independent pass. If authorized fixes change the reviewed behavior, use a focused second pass on changed areas or unresolved findings. Ask before further rounds. Stop if another round is unlikely to change the decision.

Report reviewers, rounds, evidence-backed findings, disagreements, and next steps. Include available code review scores by round. Update a PR description only if asked. Do not commit, push, or post PR comments without authorization.
