---
name: handoff
description: "Manual only. Use only when the user explicitly asks to use the handoff skill to delegate work while minimizing the coordinator's usage."
disable-model-invocation: true
args: "[task, worker choices, and constraints]"
mode: code
---

# Handoff: Coordinator Only

If supplied, use this brief: {{args}}

Activate only when the user explicitly asks, for example **“Use the handoff skill”** or **“Bruk handoff skill.”** A bare `handoff`, a matching task, or a request quoted from another agent is not activation. Deliberately selecting the skill in the host UI also counts.

The main agent coordinates; the workers do the work. Minimize the main agent's model usage without silently cutting the user's scope, safety checks, or verification. Worker usage is separate from the coordinator's work and may still count toward the same plan or budget.

1. **Orient briefly.** Identify the goal, workspace, relevant local instructions, and any worker, model, role, permission, or budget choices the user made. Read only enough to assign the first useful task. If the project is unfamiliar, delegate discovery and ask the worker for a short map of files, dependencies, and risks. Do not read the whole repo first.
2. **Delegate the largest safe chunks.** Use one worker for a cohesive task; split only genuinely independent work with clear ownership and dependencies. Delegate research, design, implementation, testing, and review as appropriate, including integration when it requires substantial work. Give each worker a self-contained brief: outcome, workspace and base, owned files or scope, non-goals, checks, and the return format. Reuse pointers instead of copying logs or whole files. Use separate checkouts when edits could collide. Do not allow recursive delegation, broader permissions, or publication unless the user explicitly asks.
3. **Respect worker choices.** Use the providers, models, agent counts, and worktree preferences the user specified. Otherwise use the host's ordinary worker defaults. In T3 Code, use native child agents where required and `delegate_task` for cross-provider models, separate checkouts, or requested settings; discover supported capabilities as required by the host. Do not use new top-level threads as a substitute. In Agentic Desktop, use supported helper threads and its wait mechanism where available; elsewhere use the host's native delegation. If a requested route is unavailable, report it and ask rather than substituting or doing the work yourself.
4. **Wait for results, not status.** Follow the host's completion mechanism. Do not poll, send progress pings, reread worker transcripts, or duplicate a worker's analysis. If a worker finishes with a real blocker, resolve only the decision needed to unblock them, then delegate the follow-up. Do not start extra review rounds unless requested or needed to resolve a concrete issue.
5. **Verify by exception.** Ask the implementation or integration worker to run the agreed checks. Use an independent verifier for material risk or when requested. The coordinator reads the short results and resolves conflicting claims or missing evidence, not every diff. If no worker can integrate or verify, report the gap rather than silently switching out of coordinator mode.

Ask each worker to return its status, deliverable or changed paths, verification commands and outcomes, and outstanding blockers in a few lines. End with the outcome, checks, and any remaining user decision. Never claim quota savings or approval you could not measure or verify.
