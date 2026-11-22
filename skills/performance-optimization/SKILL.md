---
name: performance-optimization
description: "Manual only. Use on explicit request to measure, diagnose, and verify a targeted performance improvement or regression."
disable-model-invocation: true
args: "[slow scenario or metric]"
mode: code
---

# Performance Optimization

If supplied, use this scenario: {{args}}

Use only on explicit request, such as **“Use the performance-optimization skill to investigate slow search”** or **“Bruk performance-optimization skill.”** Deliberate selection in the skill menu also counts. A bare name or mention of slow behavior does not activate it.

## Measure → Diagnose → Change → Verify

1. **Define success.** Pick one representative scenario and one primary metric tied to the complaint: startup time, input delay, frame time, request latency, throughput, or memory. Use the project's existing budget or agree on a meaningful improvement; don't invent a universal target. Identify what must not regress, especially correctness, data freshness, and resource use.
2. **Establish a baseline.** Prefer the existing benchmark, trace, or profiler. Record the command, revision, build mode, dataset, relevant hardware or network conditions, and whether the run is warm or cold. Repeat noisy measurements and report the sample count and spread. Use production telemetry if already available and authorized; otherwise state what the local measurement can and cannot show. If you cannot get a credible baseline, report what is missing rather than making a speculative optimization.
3. **Follow the evidence.** Profile the slow path and separate time spent working from time spent waiting. For a web UI, use a waterfall or main-thread trace to isolate loading, rendering, or interaction. For desktop or background work, check startup phases, UI-thread stalls, CPU, allocations, and I/O as relevant. For an API or database, separate queueing, network, dependency, and query time; check query counts and plans on a representative test dataset before proposing an index. Do not run production load tests or add telemetry without authorization.
4. **Try the smallest fix.** If edits are authorized, change one measured bottleneck at a time. Preserve required work and behavior. Add caching, indexes, dependencies, or concurrency only when the evidence warrants their maintenance cost and trade-offs. For caching, state the key, authorization boundary, invalidation, and acceptable staleness. For an index, check its plan impact and write cost. A diagnosis-only request does not authorize edits.
5. **Compare like for like.** Re-run the same scenario under comparable conditions, using the same sampling method, then run focused correctness checks. Keep the change only if the gain is meaningful relative to noise and the agreed guardrails hold. If the result is worse or inconclusive, remove only your own experimental changes when safe; otherwise report what remains and why. Never claim a local synthetic result proves a production improvement.

## Stop and report

Default to one bottleneck and at most two experiments. If neither gives a credible gain, stop and report the evidence and the cheapest next measurement. Suggest one regression check for the primary metric if the existing tooling makes it stable; do not add monitoring or CI gates by default.

Report the baseline and result with units and conditions, the observed bottleneck, which experiments were kept or discarded, correctness checks, and any remaining uncertainty. For web work, use field Core Web Vitals at the 75th percentile when available: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. Treat them as web-specific reference points, not requirements for every job.
