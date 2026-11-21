import "./styles/ui-mods.css";
import "./styles/chat-files.css";
import { render } from "solid-js/web";
import { ApiError, get, post, setUnauthorizedHandler } from "./lib/api";
import { expire } from "./lib/socket";
import { app, applyBootstrap, wireServerEvents } from "./state/app";
import { applyLanguage } from "./lib/i18n";
import { createEffect, createRoot, onCleanup } from "solid-js";
import { desktop } from "./lib/desktop";
import { wireGridEvents } from "./state/grid";
import { prepareStartup } from "./state/startup";
import { wireThreadEvents } from "./state/thread-model";
import { installArtifactBoxes } from "./markdown/artifact-card";
import { ExpiredScreen, Shell, SoloApp } from "./ui/App";
import { wireNotifications } from "./state/home";
import { warmGlyphs } from "./lib/warm-glyphs";
import { preloadPalette } from "./ui/dialogs";
import type { Bootstrap } from "../../shared/protocol";
import "./styles.css";
import "./styles/kode.css";
import "./styles/code-appearance.css";
import "./styles/nav.css";
import "./styles/settings.css";
import "./styles/grid.css";
import "./styles/chat.css";
import "./styles/motion.css";
import "./styles/extra.css"; // round 8: colour themes, mini editor, GitHub
import "./styles/harness.css"; // round 9b: Kode-harness, Chat-personalisering, memory upgrade, skill import
import "./styles/runde11.css"; // round 11: top bar, panel buttons, the side panel's start page, sidebar ⋯ and sections
import "./styles/runde11b.css"; // round 11b: the Kode start page choices and Annoter in the Browser panel
import "./styles/runde12a.css"; // round 12, part A: the locked message field and the dimmed project when the folder is gone
import "./styles/runde13.css"; // round 13: the steps of a Kode turn, the now-line and summary, web sources, and the Chat tool menu
import "./styles/design.css"; // the design round (SPEC 28): polish after rounds 11 to 13, see docs/review/design-runde.md
import "./styles/runde14.css"; // round 14 (SPEC 30): key fields, app icons, forks, the archive and the missing folder bar
import "./styles/runde15.css"; // round 15 (SPEC 31): the artifact box and panel, and the «Tekst» mark

// The token is in the fragment so it never reaches a log. It leaves the address bar at once.
function takeToken(): string | null {
  const match = /^#token=(.+)$/.exec(location.hash);
  if (!match) return null;
  history.replaceState(null, "", location.pathname + location.search);
  return decodeURIComponent(match[1]);
}

// Pasting a new link into this tab only changes the fragment, so nothing would reload by itself.
addEventListener("hashchange", () => {
  const token = takeToken();
  if (token) post("/api/auth/exchange", { token }).then(() => location.reload()).catch(() => undefined);
});

// public/boot.js has already exchanged the token and asked for /api/bootstrap while this code loaded.
// Without it (a page that did not run it), the same two requests are made from here.
type EarlyBoot = { url: string; res: Response };
async function bootstrapFromEarly(early: Promise<EarlyBoot>): Promise<Bootstrap> {
  let answer: EarlyBoot;
  try {
    answer = await early;
  } catch {
    throw new ApiError(0, "Får ikke kontakt med serveren");
  }
  const body = await answer.res.json().catch(() => undefined);
  if (!answer.res.ok) throw new ApiError(answer.res.status, body?.error ?? `Feil ${answer.res.status}`, body);
  return body as Bootstrap;
}

async function boot(): Promise<void> {
  const root = document.getElementById("app")!;
  const early = (window as unknown as { __adEarly?: Promise<EarlyBoot> }).__adEarly;
  const token = early ? null : takeToken();
  const expired = () => render(() => <ExpiredScreen />, root);
  let dispose = () => {};
  setUnauthorizedHandler(() => {
    expire();
    dispose();
    root.textContent = "";
    dispose = expired();
  });
  try {
    if (early) applyBootstrap(await bootstrapFromEarly(early));
    else {
      if (token) await post("/api/auth/exchange", { token });
      applyBootstrap(await get<Bootstrap>("/api/bootstrap"));
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      if (!root.hasChildNodes()) dispose = expired();
      return;
    }
    root.textContent = (err as Error).message;
    return;
  }
  const sync = () => {
    const setting = app.settings.language ?? "system";
    return applyLanguage(setting, desktop?.setLanguage?.(setting));
  };
  await sync();
  createRoot(() => {
    createEffect(() => void sync());
    addEventListener("languagechange", sync);
    onCleanup(() => removeEventListener("languagechange", sync));
  });
  prepareStartup();
  wireServerEvents();
  wireThreadEvents();
  wireGridEvents();
  installArtifactBoxes();
  wireNotifications();
  const solo = new URLSearchParams(location.search).get("rute");
  dispose = render(() => (solo ? <SoloApp threadId={solo} /> : <Shell />), root);
  warmGlyphs();
  // The command palette is not part of the first view, but Mod+K should open it at once.
  requestIdleCallback(preloadPalette, { timeout: 3000 });
}

void boot();
