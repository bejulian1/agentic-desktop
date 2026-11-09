// Theme is a data attribute on <html>. public/theme.js sets it before first paint from the copy
// in localStorage, and this keeps that copy and the attribute correct afterwards.
import type { ThemeSetting } from "../../../shared/protocol";

const STORAGE_KEY = "ad-theme";
const media = matchMedia("(prefers-color-scheme: dark)");
let current: ThemeSetting = "system";

function apply(): void {
  const dark = current === "dark" || (current === "system" && media.matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

export function setTheme(theme: ThemeSetting): void {
  current = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private mode: only this page load keeps the choice.
  }
  apply();
}

media.addEventListener("change", apply);

export function isDark(): boolean {
  return document.documentElement.getAttribute("data-theme") === "dark";
}
