---
name: benchmark
description: Mål en bestemt operasjon i kodeprosjektet og sammenlign ytelse under like forhold. Bruk ved spørsmål om tidsbruk, ressursbruk eller en mulig regresjon.
args: "[operasjon, måltall og eventuell sammenligning]"
mode: code
---
# Measure a specific operation

{{args}}

Take the operation, comparison and resource limits from the request or conversation. Choose a metric with a unit and a clear start and end. For a user-visible delay, include work up to the point the user can actually proceed.

- Look for the project's existing benchmark or a short, representative command. Check its inputs and side effects before running it. Use a disposable fixture when the command writes data. Keep the user's checkout, caches and open app intact. An existing pair of comparable measurements may already answer the question.
- Hold input, runtime version and measurement boundaries constant across variants. Record cache state. Separate warm-up from timed runs when measuring warm behaviour. For cold-start measurements, reset only disposable state you control. Keep trials serial and bounded by the user's resource budget.
- Verify each run produced the expected result. Retain failed runs as failures, outside the timing summary. Repeat short trials when practical, alternate variant order to reduce drift, and report successes out of attempts, median and range per variant. With one observation, label it as such.
- For a difference, name the baseline and show units and direction. If the difference is small compared with the variation, say that the measurements are inconclusive. Attribute a bottleneck only to work actually isolated by a timer or profile. When execution is unavailable, identify what remains to be measured.

Include the command or measurement procedure and enough conditions to repeat it. Leave implementation changes to a request for a fix or optimization.
