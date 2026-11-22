// The colour themes in Innstillinger → Utseende (round 8, agent G). The tokens themselves are in
// styles/extra.css; this is what the picker shows: a name, a line about the theme, and the few
// colours its small preview is drawn with, for the light and the dark variant. server/test/temaer
// checks that these colours are the ones in the stylesheet, so the preview never lies.
import { t } from "../lib/i18n";
import type { ThemePreset } from "../../../shared/protocol";

export interface PreviewColors {
  bg: string;
  side: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  keyword: string;
  string: string;
  fn: string;
}

export interface ThemeInfo {
  id: ThemePreset;
  name: string;
  text: string;
  light: PreviewColors;
  dark: PreviewColors;
}

export const THEMES: ThemeInfo[] = [
  {
    id: "standard",
    get name() { return t("Standard"); },
    get text() { return t("Nøytrale grånyanser og blå aksent."); },
    light: { bg: "#ffffff", side: "#f8f8f7", surface: "#f4f4f3", text: "#1b1b1a", muted: "#6b6b64", accent: "#2f6fe4", keyword: "#8a3ea8", string: "#2c7a4b", fn: "#2558b5" },
    dark: { bg: "#1b1b1b", side: "#252526", surface: "#2b2b2c", text: "#ececec", muted: "#9d9d9a", accent: "#2b6fe6", keyword: "#cf9df0", string: "#8fcf9f", fn: "#9db8f2" },
  },
  {
    id: "ocean",
    get name() { return t("Ocean"); },
    get text() { return t("Kjølig havskifer og klar blågrønn aksent."); },
    light: { bg: "#f5f9fc", side: "#ebf2f8", surface: "#e6eef5", text: "#14202c", muted: "#52627a", accent: "#0d7c86", keyword: "#5543b8", string: "#19714f", fn: "#2152ab" },
    dark: { bg: "#141c24", side: "#10171f", surface: "#222e3b", text: "#e6eef6", muted: "#98a9bb", accent: "#4dd4d0", keyword: "#b9adff", string: "#84d9b1", fn: "#97b9ff" },
  },
  {
    id: "rosa",
    get name() { return t("Rosa"); },
    get text() { return t("Dyp plomme og varm rosa aksent."); },
    light: { bg: "#fdf6f9", side: "#f7ebf0", surface: "#f4e7ed", text: "#2a1620", muted: "#6b4f5f", accent: "#c2185b", keyword: "#8d3a9e", string: "#26704a", fn: "#3b55b0" },
    dark: { bg: "#1e141b", side: "#191016", surface: "#2f2129", text: "#f5e8ef", muted: "#b9a0ae", accent: "#f06292", keyword: "#f29ac6", string: "#9fd8a8", fn: "#a9b7f5" },
  },
  {
    id: "skog",
    get name() { return t("Skog"); },
    get text() { return t("Rolig skogskifer og salvie."); },
    light: { bg: "#f6faf7", side: "#ebf3ee", surface: "#e5eee8", text: "#13221a", muted: "#4f6557", accent: "#1f7a4d", keyword: "#6a3fa8", string: "#1f6f45", fn: "#2152ab" },
    dark: { bg: "#141c17", side: "#101713", surface: "#212e27", text: "#e5efe9", muted: "#98ad9f", accent: "#52c98e", keyword: "#c0a8f5", string: "#8fdcaa", fn: "#97b9ff" },
  },
  {
    id: "glod",
    get name() { return t("Glød"); },
    get text() { return t("Varm kullgrå og kobber."); },
    light: { bg: "#fcf8f4", side: "#f5ede4", surface: "#f1e8dd", text: "#2a1d14", muted: "#6a5646", accent: "#b54d1d", keyword: "#983372", string: "#48701c", fn: "#2f58a8" },
    dark: { bg: "#1c1714", side: "#171310", surface: "#2d251f", text: "#f3e8dd", muted: "#b3a08d", accent: "#e88c54", keyword: "#e8a0ca", string: "#b8d68e", fn: "#9db8f2" },
  },
  {
    id: "iris",
    get name() { return t("Iris"); },
    get text() { return t("Midnattsindigo og lavendel."); },
    light: { bg: "#f8f7fc", side: "#eeecf7", surface: "#e9e6f4", text: "#1b1830", muted: "#5a5678", accent: "#5e47c7", keyword: "#5e47c7", string: "#19714f", fn: "#2152ab" },
    dark: { bg: "#171622", side: "#13121c", surface: "#272639", text: "#ebeaf7", muted: "#a09ebf", accent: "#a38bff", keyword: "#c4b0ff", string: "#84d9b1", fn: "#97b9ff" },
  },
  {
    id: "kontrast",
    get name() { return t("Høy kontrast"); },
    get text() { return t("Svart og hvitt, tydelige kanter og tykkere fokusring."); },
    light: { bg: "#ffffff", side: "#f4f4f4", surface: "#efefef", text: "#000000", muted: "#333333", accent: "#0040b8", keyword: "#6a1a8c", string: "#0a5c25", fn: "#00379c" },
    dark: { bg: "#000000", side: "#0c0c0c", surface: "#191919", text: "#ffffff", muted: "#d2d2d2", accent: "#5aa2ff", keyword: "#e6aaff", string: "#a3f2ad", fn: "#adcbff" },
  },
  {
    id: "varm",
    get name() { return t("Varm"); },
    get text() { return t("Papir, sand og terrakotta."); },
    light: { bg: "#fdfaf5", side: "#f6f0e6", surface: "#f3ede3", text: "#2b2118", muted: "#6a5b4d", accent: "#b14b22", keyword: "#983372", string: "#48701c", fn: "#91440f" },
    dark: { bg: "#1f1a16", side: "#27211c", surface: "#312923", text: "#f1e7db", muted: "#b3a493", accent: "#e3855c", keyword: "#e8a0ca", string: "#b8d68e", fn: "#f4b585" },
  },
  {
    id: "kald",
    get name() { return t("Kald"); },
    get text() { return t("Blågrått og blågrønt."); },
    light: { bg: "#f8fafc", side: "#eef2f6", surface: "#eaf0f5", text: "#15212e", muted: "#536276", accent: "#0d7482", keyword: "#5543b8", string: "#19714f", fn: "#2152ab" },
    dark: { bg: "#121820", side: "#18202a", surface: "#212c39", text: "#e4ecf4", muted: "#98a8ba", accent: "#3cc2d3", keyword: "#b9adff", string: "#84d9b1", fn: "#97b9ff" },
  },
  {
    id: "fjord",
    get name() { return t("Fjord"); },
    get text() { return t("Polarnatt, snø og frost. I stil med en kjent arktisk kodepalett."); },
    light: { bg: "#eceff4", side: "#e5e9f0", surface: "#e2e7ee", text: "#2e3440", muted: "#4c566a", accent: "#4c6e98", keyword: "#4b5f94", string: "#4a7135", fn: "#39608d" },
    dark: { bg: "#2e3440", side: "#2a2f3a", surface: "#353c4a", text: "#eceff4", muted: "#bcc4d2", accent: "#88c0d0", keyword: "#a3bdd9", string: "#b1c99c", fn: "#8fc6d6" },
  },
  {
    id: "solbleket",
    get name() { return t("Solbleket"); },
    get text() { return t("Sand og havblått med presise toner. I stil med en kjent kodepalett."); },
    light: { bg: "#fdf6e3", side: "#f5eedb", surface: "#eee8d5", text: "#073642", muted: "#4c6168", accent: "#1d72b0", keyword: "#5a6900", string: "#136c65", fn: "#1a64a0" },
    dark: { bg: "#002b36", side: "#01313d", surface: "#0a3c49", text: "#eee8d5", muted: "#a3afae", accent: "#3a9ae0", keyword: "#b0c132", string: "#4cc4ba", fn: "#5eaeea" },
  },
];

// The token each preview colour stands for, for the test that compares them with the stylesheet.
export const PREVIEW_TOKENS: Record<keyof PreviewColors, string> = {
  bg: "--bg",
  side: "--bg-sidebar",
  surface: "--surface-2",
  text: "--text",
  muted: "--text-3",
  accent: "--accent",
  keyword: "--tok-keyword",
  string: "--tok-string",
  fn: "--tok-function",
};

export function themeInfo(id: ThemePreset | undefined): ThemeInfo {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

// Changes the look in one go: with the View Transitions API the old page fades into the new one on
// the compositor (opacity only), instead of every colour changing at its own pace. Not with reduced
// motion, and not where the browser lacks it.
// A choice made while one fade runs (the arrow keys held down) applies at once instead.
type Fade = { ready: Promise<void>; finished: Promise<void>; updateCallbackDone: Promise<void> };
let running: Fade | null = null;
export function withThemeTransition(change: () => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => Fade };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduce";
  if (!doc.startViewTransition || reduced || running) return change();
  const fade = doc.startViewTransition(change);
  running = fade;
  // A skipped fade rejects these; the change itself has still been made.
  fade.ready.catch(() => undefined);
  fade.updateCallbackDone.catch(() => undefined);
  void fade.finished.catch(() => undefined).finally(() => {
    if (running === fade) running = null;
  });
}

// The terminal's colours from the same tokens, so a theme reaches xterm too. Colours a program
// prints are kept readable on both light and dark backgrounds: "white" is the strong text colour
// on a light theme, and "black" a quiet grey on a dark one.
export function terminalColors(dark: boolean): Record<string, string> {
  const css = getComputedStyle(document.documentElement);
  const t = (name: string) => css.getPropertyValue(name).trim();
  return {
    background: t("--bg-panel"),
    foreground: t("--text"),
    cursor: t("--text"),
    cursorAccent: t("--bg-panel"),
    selectionBackground: t("--selection"),
    black: dark ? t("--surface-3") : t("--text"),
    brightBlack: t("--text-3"),
    red: t("--danger"),
    brightRed: t("--del-text"),
    green: t("--ok"),
    brightGreen: t("--add-text"),
    yellow: t("--warn"),
    brightYellow: t("--tok-number"),
    blue: t("--accent-text"),
    brightBlue: t("--tok-function"),
    magenta: t("--tok-keyword"),
    brightMagenta: t("--tok-keyword"),
    cyan: t("--tok-type"),
    brightCyan: t("--tok-type"),
    white: t("--text-2"),
    brightWhite: t("--text"),
  };
}
