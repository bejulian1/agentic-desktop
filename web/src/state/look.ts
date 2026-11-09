// Settings from Innstillinger that act on the whole app (round 5, agent C). The look is data
// attributes and CSS variables on <html>, read by styles/settings.css. public/theme.js applies a
// copy from localStorage before the first paint, so a stored accent or text size never flashes.
// The rest are small behaviours: the mode the app opens in, a sound or a system notification when
// a turn ends, and asking before the tab closes while a thread runs.
import type { Settings, Thread } from "../../../shared/protocol";
import { on } from "../lib/socket";
import { app, mode, setMode } from "./app";

const LOOK_KEY = "ad-look";
let current: Partial<Settings> = {};

interface Look {
  attrs: Record<string, string>;
  vars: Record<string, string>;
}

function lookOf(settings: Partial<Settings>): Look {
  const attrs: Record<string, string> = {};
  const vars: Record<string, string> = {};
  if (settings.accent && settings.accent !== "blue") attrs["data-accent"] = settings.accent;
  // Round 8: a colour theme from styles/extra.css. Light or dark is still data-theme (lib/theme.ts).
  if (settings.themePreset && settings.themePreset !== "standard") attrs["data-palette"] = settings.themePreset;
  if (settings.density && settings.density !== "normal") attrs["data-density"] = settings.density;
  if (settings.uiFontSize && settings.uiFontSize !== 14) attrs["data-ui-size"] = String(settings.uiFontSize);
  if (settings.codeFont && settings.codeFont !== "system") attrs["data-code-font"] = settings.codeFont;
  if (settings.reduceMotion) attrs["data-motion"] = "reduce";
  if (settings.wrapCode) attrs["data-wrap-code"] = "on";
  if (settings.codeFontSize) {
    attrs["data-code-size"] = String(settings.codeFontSize);
    vars["--code-font-size"] = `${settings.codeFontSize}px`;
  }
  vars["--tab-size"] = String(settings.tabSize ?? 4);
  return { attrs, vars };
}

const ATTRS = ["data-accent", "data-palette", "data-density", "data-ui-size", "data-code-font", "data-motion", "data-wrap-code", "data-code-size"];
const VARS = ["--code-font-size", "--tab-size"];

// Called with the settings as the server sent them, so a field that was reset is gone here too.
export function applyLook(settings: Partial<Settings>): void {
  current = settings;
  const root = document.documentElement;
  const look = lookOf(settings);
  for (const name of ATTRS) {
    if (look.attrs[name] === undefined) root.removeAttribute(name);
    else root.setAttribute(name, look.attrs[name]);
  }
  for (const name of VARS) {
    if (look.vars[name] === undefined) root.style.removeProperty(name);
    else root.style.setProperty(name, look.vars[name]);
  }
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(look));
  } catch {
    // Private mode: the look is applied after the first paint instead.
  }
  wire();
}

// Only when the app starts, and not in a window that shows a single thread.
let started = false;
export function applyStartMode(settings: Partial<Settings>): void {
  const start = settings.startMode;
  if (started || new URLSearchParams(location.search).has("rute")) return;
  started = true;
  if ((start === "chat" || start === "code") && mode() !== start) setMode(start);
}

// A short two-note chime made with Web Audio, so there is no sound file to load.
let audio: AudioContext | undefined;
export function chime(): void {
  try {
    audio ??= new AudioContext();
    void audio.resume();
    const start = audio.currentTime + 0.02;
    [660, 880].forEach((freq, i) => {
      const at = start + i * 0.12;
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
      osc.connect(gain).connect(audio!.destination);
      osc.start(at);
      osc.stop(at + 0.3);
    });
  } catch {
    // No audio in this browser. Nothing else depends on the sound.
  }
}

// Asks for permission from a click in Innstillinger. Returns whether notifications may be shown.
export async function allowNotifications(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "default") await Notification.requestPermission().catch(() => undefined);
  return Notification.permission === "granted";
}

function notify(thread: Thread): void {
  const when = current.notifyOnDone ?? "off";
  if (when === "off" || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (when === "unfocused" && document.visibilityState === "visible" && document.hasFocus()) return;
  const text = thread.lastStatus === "error" ? `«${thread.title}» stoppet med en feil.` : `«${thread.title}» er ferdig.`;
  try {
    new Notification("Agentic Desktop", { body: text, tag: `ad-turn-${thread.id}` });
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}

let wired = false;
const wasRunning = new Map<string, boolean>();

function wire(): void {
  if (wired) return;
  wired = true;
  for (const thread of Object.values(app.threads)) if (thread) wasRunning.set(thread.id, thread.running);
  on("thread.changed", ({ thread }) => {
    const before = wasRunning.get(thread.id) ?? false;
    wasRunning.set(thread.id, thread.running);
    if (!before || thread.running) return;
    if (thread.lastStatus !== "done" && thread.lastStatus !== "error") return;
    if (current.soundOnDone) chime();
    notify(thread);
  });
  addEventListener("beforeunload", (event) => {
    if (!current.confirmQuit || !Object.values(app.threads).some((t) => t?.running)) return;
    event.preventDefault(); // enough for the browser to ask, in current Chrome and Firefox
  });
}
