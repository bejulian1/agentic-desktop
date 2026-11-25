// The code font and size from Settings (state/look.ts puts them on <html>).
export function terminalFont(): { fontFamily: string; fontSize: number } {
  const css = getComputedStyle(document.documentElement);
  const size = parseFloat(css.getPropertyValue("--code-font-size"));
  return { fontFamily: css.getPropertyValue("--font-mono").trim() || "monospace", fontSize: size > 0 ? size : 13 };
}
