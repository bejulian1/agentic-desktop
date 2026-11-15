---
name: tdd
description: Test-først – en test som feiler, minste kode som består, og opprydding. Bruk når brukeren ber om TDD eller test-først.
args: "[hva som skal lages eller rettes]"
mode: code
---
# Test-first change

Change to make: {{args}}

If nothing is given above, use what the user asked for in the conversation.

## Before you start
- Find how tests are run: look at "Checks" in the environment, `package.json` scripts, `pytest.ini`, `Cargo.toml`, `Makefile`.
- Find an existing test for the same area with `glob` and `search`, and copy its structure and naming.
- Run the existing tests once so you know the starting state. Note failures that were there before you.

## The cycle
Repeat for one small behaviour at a time:

1. **Red.** Write one test for the next behaviour. Run it. It must fail, and for the right reason (an assertion, not a syntax error or missing import).
2. **Green.** Write the least code that makes it pass. Run the test.
3. **Tidy.** Remove duplication and unclear names while the tests stay green. Run them again.

## Rules
- Test behaviour through the public interface, not private details.
- One reason to fail per test. Name it after the behaviour: `returns empty list when no users match`.
- Cover the normal case, one edge case and one error case. Do not write tests for things that cannot happen.
- Never weaken or delete an existing test to get green. If a test is wrong, say why and ask.
- Do not mock the thing you are testing.

## Done when
- The new tests fail without your code change and pass with it.
- The whole related test suite passes, or only the failures that existed before remain (list them).

Report the tests you added, the command you ran and the pass/fail counts.
