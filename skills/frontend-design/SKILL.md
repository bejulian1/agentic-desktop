---
name: frontend-design
description: Gjør et brukergrensesnitt gjennomarbeidet og kontroller det i nettleseren. Bruk når du bygger eller pusser på sider og komponenter.
args: "[hva som skal bygges eller forbedres]"
mode: code
---
# Frontend design

What to build or improve: {{args}}

If nothing is given above, use what the user asked for in the conversation. Use the project's existing design system, components and tokens when it has them; this skill is for the choices they leave open.

## Decide before you write code
- **Purpose:** what should the person do or understand on this screen? That thing gets the most visual weight.
- **One direction:** pick a clear look (calm and dense, bold and spacious, playful) and hold it everywhere. Generic defaults read as unfinished.

## Layout and spacing
- Use one spacing scale (for example 4, 8, 12, 16, 24, 32, 48) and nothing between.
- Group related things closely and separate groups clearly. More space between groups than inside them.
- Align to a grid. Limit text lines to about 60–80 characters.

## Type
- Two font sizes do most of the work; three or four in total. Make the difference between levels obvious.
- Body text 15–16px or larger with line height around 1.5. Headings tighter.
- Use weight and colour for emphasis before size.

## Colour
- A neutral scale for text and surfaces, one accent colour for the main action, and separate colours for success, warning and error.
- Text contrast at least 4.5:1 against its background. Do not rely on colour alone to carry meaning.
- Support light and dark if the project does. Define colours as variables.

## Components and states
Every interactive element needs: default, hover, focus (visible outline), active, disabled. Every data view needs: loading, empty, error and long-content states. Buttons and inputs are at least about 36px tall and have real labels.

## Motion
Short and purposeful (150–250ms) for state changes. Respect `prefers-reduced-motion`.

## Check in the browser
1. Open the page with `browser_navigate` and take a `browser_screenshot`.
2. Look at it critically: is the most important thing the most visible? Is anything misaligned, cramped, or cut off?
3. Try long text and empty states, and read `browser_console`. You cannot resize the browser: check narrow layouts by reading the CSS breakpoints, and ask the user to look at a narrow window when it matters.
4. Fix what you see and look again. Expect two or three rounds.

Report what you built, what you checked in the browser, and what you could not check.
