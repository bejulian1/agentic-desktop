---
name: interface-recreation
description: "Manual only. Use only when the user explicitly asks to use the interface-recreation skill for an authorized UI recreation."
disable-model-invocation: true
args: "[authorized reference and scope]"
mode: code
---

# Interface Recreation

Run only on an explicit request such as **“Use the interface-recreation skill to recreate this screen”** or **“Bruk interface-recreation skill.”** A bare name, a reference to an existing app, or an ordinary redesign request is not activation. Ask if unclear.

Explicit selection in the skill menu also counts. If supplied, use this brief: {{args}}

1. **Confirm the target and scope.** Identify the authorized reference (URL, design, screenshots, or source), screens, and interactions. Clarify faithful reproduction versus redesign. Default to the smallest useful scope. If access or reuse rights are unclear, use materials the user supplies or has licensed and ask about what is missing. Do not bypass restrictions.
2. **Observe read-only.** Record the minimum useful evidence: layout at relevant widths, visible states, interaction steps, accessibility behavior, and key measurements. Use the host's supported preview tools when requested and available. Distinguish observed facts, assumptions, and unverified behavior. Do not collect credentials, personal data, or private traffic, or reuse code and assets without authorization.
3. **Specify and build independently.** Record layout, tokens, component behavior, and acceptance criteria. Use the project's stack and reusable components. Use licensed assets or placeholders and synthetic data or local mocks. For fidelity work, document apparent quirks rather than quietly redesigning them. Avoid deceptive impersonation and live imitations of another service's login or payment flow.
4. **Compare and report.** Check representative widths and states, keyboard use, and agreed interactions. Compare screenshots and geometry when useful; use pixel diffs only when conditions allow a fair comparison. Run relevant local checks. Record intentional differences and unverified behavior. Keep the result local unless publishing is explicitly authorized.
