// Symbols the UI fonts may not have, laid out once while the app is idle.
//
// The first time Chrome draws a character the first font in --font-sans lacks (→ in "Innstillinger
// → Personalisering", ⋯, ⌘), it asks for every family in the list in turn (-apple-system, Segoe UI,
// Inter, Roboto, …), a few milliseconds each over IPC, inside the frame that shows it. Measured with
// npm run perf: the first / menu took 35–40 ms instead of 7–12 ms, all of it in that lookup ("→"
// in the description of /memories). The answer is cached per weight, so each weight the UI uses
// is warmed in its own idle callback, and no single task gets long. Nothing is visible.
const GLYPHS = "→ ← ↑ ↓ ⋯ ⌘ − ≥ ≤ ≈";
const WEIGHTS = ["400", "500", "600"];

export function warmGlyphs(): void {
  const idle = (run: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(run, { timeout: 4000 }) : setTimeout(run, 1500));
  const step = (index: number) => {
    if (index >= WEIGHTS.length) return;
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = `position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;white-space:nowrap;font-weight:${WEIGHTS[index]}`;
    probe.innerHTML = `<span style="font-size:var(--text-sm)">${GLYPHS}</span><span style="font-size:var(--text-md)">${GLYPHS}</span><code>${GLYPHS}</code>`;
    document.body.append(probe);
    probe.getBoundingClientRect(); // Layout shapes the text, which is what looks the fonts up.
    probe.remove();
    idle(() => step(index + 1));
  };
  idle(() => step(0));
}
