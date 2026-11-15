---
name: web-qa
description: Test en nettside i appens nettleser og rapporter funn med bevis. Bruk når brukeren ber om test av en side.
args: "[adresse og hva som skal testes]"
mode: code
---
# Web QA in the app browser

Target and scope: {{args}}

If no address is given: for a static page, open the project file with `browser_navigate` (for example `index.html`). For an app that needs a server, use the address from the README or the manifest if it is already running; otherwise ask the user to start it with Playtest or in the terminal panel and give you the address. Do not start servers with `run_command`; it stops them when the command ends.

## 1. Plan
List the pages and flows you will test: the main page, navigation, each form, the feature that was changed, plus empty and error states. Keep the list short enough to finish.

## 2. For every page or flow
1. `browser_navigate` to the address.
2. `browser_snapshot` and read it before you act. Act on what the snapshot shows, not on what you expect.
3. Interact with `browser_click` and `browser_type`: follow links, press buttons, fill forms with valid input, then with empty and invalid input.
4. After each action take a new `browser_snapshot` and compare with what should have happened.
5. `browser_console` after loading and after each important action. Errors there are findings even when the page looks fine.
6. `browser_screenshot` when layout or visual state matters, and for every problem you report.

## 3. What to look for
- **Function:** actions that do nothing, wrong results, lost input, broken links, forms that accept bad data.
- **Errors:** console errors, page errors, error pages.
- **Layout:** overlapping or cut-off content, unreadable contrast. You cannot resize the browser: judge narrow layouts from the CSS breakpoints and say that they were not seen.
- **States:** loading, empty, error and long-content states.
- **Keyboard and labels:** controls reachable and named.

## 4. Report
For each issue: severity, the page, the steps to reproduce, what you expected, what happened, and the console line or screenshot that shows it. Merge duplicates. Most serious first.

Say which flows passed and which you did not get to. Only report what you observed through the browser tools; you cannot see the user's screen. If you were asked to fix the problems, fix them and then repeat the affected steps.
