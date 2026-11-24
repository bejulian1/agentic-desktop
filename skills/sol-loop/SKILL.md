---
name: sol-loop
description: "Manual only. Use only when the user explicitly asks to use the sol-loop skill for a bounded code review with GPT Sol."
disable-model-invocation: true
args: "[change or paths to review]"
mode: code
---

# Sol Review Loop

Run only on an explicit request such as **“Use the sol-loop skill to review this change”** or **“Bruk sol-loop skill.”** A bare name, a mention of Sol, or an ordinary review request is not activation. If unclear, ask before starting a reviewer.

Explicit selection in the skill menu also counts. If supplied, use this brief: {{args}}

1. **Freeze the scope.** Record the intended behavior, paths, and review base. Inspect tracked and relevant untracked changes without touching unrelated work. For a PR, verify its base and head. For local work, use the agreed branch base, or `HEAD` for an uncommitted-only review. If the scope cannot be separated, ask. Run focused checks and note missing or pre-existing failures.
2. **Start one read-only reviewer.** Use the requested GPT Sol model, or choose an available GPT Sol model. Do not silently substitute another model family. In T3 Code, follow the host's delegation rules: use a fresh review task per round, wait for its completion signal, and do not poll or use a top-level thread for review. Elsewhere, use a supported review agent that actually runs Sol. If unavailable, report that the loop did not run.
3. **Send a self-contained brief.** Include the repo and revision or snapshot, base, paths, intent, exclusions, and checks. Ask for `APPROVE` or `CHANGES` and stable finding IDs with `blocker`, `should`, or `nit`, file and line, evidence, and a focused fix. No editing, publication, or nested delegation. Keep the snapshot stable during review.
4. **Triage before editing.** Verify findings independently. Track accepted, disputed, declined, and resolved items with reasons. Fix only verified issues within scope and only if changes are authorized. Prefer the smallest fix and rerun relevant checks. For a review-only request, return findings without editing.
5. **Bound the loop.** Default to three rounds: one full pass and up to two focused rechecks of changed behavior and unresolved findings. Extend to five only at the user's request or for an evidenced, unresolved high-impact issue. Stop for nits alone, repeated disagreement, or lack of progress. A timeout, budget exhaustion, or approval of an older diff is not approval of the current diff.

Report the actual model, rounds, findings and outcomes, checks, and verdict. Include usage only if exposed. Do not commit, push, or update a PR unless separately authorized.
