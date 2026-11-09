// Round 12 (SPEC 26.4): the cookies imported into the app's own browser profile, and what is known
// about them: which sites, how many, from where and when.
//
// Everything lives in the app's Chrome profile folder in the data folder (chrome-profile/), so
// «Tøm nettleserdata» in Lagring takes it with the profile. The file is readable by the user only.
// - sites: one entry per imported site, for Innstillinger → Nettleser and for the agent's check.
// - pending: cookies waiting for the app's Chrome. Chrome starts on first use; until then they wait
//   here and go into Chrome's own cookie store the moment it starts, and are then removed here.
// - session: cookies without an end date. Chrome forgets those when it closes, so they are given
//   to it again each time it starts, as long as their site is imported.
// - forget: sites to remove from Chrome's cookie store the next time it runs.
// - panelPending and panelForget: the same for the Electron app's Browser panel (SPEC 29.3), whose
//   pages keep their cookies in a session partition of their own. Each store takes its own copy when
//   it starts, so an import reaches both the app and `npm start`. A file from before this had only
//   the first two; what still waited there waits for the panel too.
//
// The file is only read with the type of playwright-core, never the module itself.
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import type { BrowserContext } from "playwright-core";
import type { ImportedCookieSite } from "../../shared/protocol.ts";
import type { BrowserCookie, ReadCookie } from "./cookie-import.ts";
import { siteOf } from "./cookie-import.ts";
import { writeAtomic } from "./write-atomic.ts";

export const COOKIE_FILE = "agentic-imported-cookies.json";

interface StoredCookie {
  site: string;
  cookie: BrowserCookie;
}

interface State {
  version: 1;
  sites: Record<string, { cookies: number; importedAt: number; source: string }>;
  pending: StoredCookie[];
  session: StoredCookie[];
  forget: string[];
  panelPending: StoredCookie[];
  panelForget: string[];
}

// Where the cookies go: the server's own Chrome profile, or the Electron app's panel partition.
export type CookieStore = "chrome" | "panel";

const empty = (): State => ({ version: 1, sites: {}, pending: [], session: [], forget: [], panelPending: [], panelForget: [] });

// Cookies whose domain is the site or a host under it.
function domainPattern(site: string): RegExp {
  const escaped = site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\.?([a-z0-9_-]+\\.)*${escaped}$`, "i");
}

export class ImportedCookies {
  private dataDir: string;
  private file: string;

  constructor(profileDir: string, dataDir: string) {
    this.dataDir = dataDir;
    this.file = path.join(profileDir, COOKIE_FILE);
  }

  // Read every time: Lagring may have removed the profile folder since.
  private state(): State {
    const stat = lstatSync(this.file, { throwIfNoEntry: false });
    if (!stat?.isFile()) return empty();
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8"));
      const list = (value: unknown): StoredCookie[] => (Array.isArray(value) ? value.filter((c) => c && typeof c.site === "string" && c.cookie && typeof c.cookie.name === "string") : []);
      const names = (value: unknown): string[] => (Array.isArray(value) ? value.filter((s: unknown) => typeof s === "string") : []);
      return {
        version: 1,
        sites: raw.sites && typeof raw.sites === "object" ? raw.sites : {},
        pending: list(raw.pending),
        session: list(raw.session),
        forget: names(raw.forget),
        panelPending: list(raw.panelPending ?? raw.pending),
        panelForget: names(raw.panelForget ?? raw.forget),
      };
    } catch {
      return empty();
    }
  }

  private save(state: State): void {
    writeAtomic(this.file, JSON.stringify(state), this.dataDir, 0o600);
  }

  list(): ImportedCookieSite[] {
    return Object.entries(this.state().sites)
      .map(([site, info]) => ({ site, cookies: info.cookies, importedAt: info.importedAt, source: info.source }))
      .sort((a, b) => a.site.localeCompare(b.site, "nb"));
  }

  has(site: string): boolean {
    return Object.hasOwn(this.state().sites, site);
  }

  // The imported site an address belongs to, if any. Only http and https.
  siteFor(url: string): string | null {
    let host: string;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      host = parsed.hostname;
    } catch {
      return null;
    }
    const site = siteOf(host);
    return this.has(site) ? site : null;
  }

  // New cookies replace what was imported for the same sites before.
  add(cookies: ReadCookie[], source: string): void {
    const state = this.state();
    const sites = new Set(cookies.map((c) => c.site));
    const at = Date.now();
    const counts = new Map<string, number>();
    for (const c of cookies) counts.set(c.site, (counts.get(c.site) ?? 0) + 1);
    for (const site of sites) state.sites[site] = { cookies: counts.get(site)!, importedAt: at, source };
    const lasting = cookies.filter((c) => c.cookie.expires !== -1);
    state.pending = [...state.pending.filter((c) => !sites.has(c.site)), ...lasting];
    state.panelPending = [...state.panelPending.filter((c) => !sites.has(c.site)), ...lasting];
    state.session = [...state.session.filter((c) => !sites.has(c.site)), ...cookies.filter((c) => c.cookie.expires === -1)];
    state.forget = state.forget.filter((s) => !sites.has(s));
    state.panelForget = state.panelForget.filter((s) => !sites.has(s));
    this.save(state);
  }

  // One site, or all of them. They are taken out of Chrome now if it runs, else when it starts.
  forget(site?: string): string[] {
    const state = this.state();
    const gone = site === undefined ? Object.keys(state.sites) : Object.hasOwn(state.sites, site) ? [site] : [];
    if (!gone.length) return [];
    for (const s of gone) delete state.sites[s];
    const set = new Set(gone);
    state.pending = state.pending.filter((c) => !set.has(c.site));
    state.panelPending = state.panelPending.filter((c) => !set.has(c.site));
    state.session = state.session.filter((c) => !set.has(c.site));
    state.forget = [...new Set([...state.forget, ...gone])];
    state.panelForget = [...new Set([...state.panelForget, ...gone])];
    this.save(state);
    return gone;
  }

  // Tøm nettlesingsdata in the panel cleared that store's cookies: nothing is imported any more, and
  // the other store forgets the sites the next time it starts.
  clearAll(store: CookieStore = "chrome"): void {
    if (!lstatSync(this.file, { throwIfNoEntry: false })) return;
    const state = this.state();
    const sites = Object.keys(state.sites);
    const next = empty();
    if (store === "chrome") next.panelForget = [...new Set([...state.panelForget, ...sites])];
    else next.forget = [...new Set([...state.forget, ...sites])];
    this.save(next);
  }

  // Into a store: first what was forgotten goes, then what waits, then the session cookies. A cookie
  // the store refuses does not stop the others.
  async apply(context: BrowserContext, store: CookieStore = "chrome"): Promise<{ added: number; refused: number }> {
    const state = this.state();
    const forget = store === "chrome" ? state.forget : state.panelForget;
    const pending = store === "chrome" ? state.pending : state.panelPending;
    for (const site of forget) await context.clearCookies({ domain: domainPattern(site) }).catch(() => undefined);
    const toAdd = [...pending, ...state.session].map((c) => c.cookie);
    let added = 0;
    let refused = 0;
    if (toAdd.length) {
      try {
        await context.addCookies(toAdd);
        added = toAdd.length;
      } catch {
        for (const cookie of toAdd) {
          try {
            await context.addCookies([cookie]);
            added++;
          } catch {
            refused++;
          }
        }
      }
    }
    // Only what was handled here: an import that came in meanwhile waits for the next round.
    if (forget.length || pending.length) {
      const done = new Set(pending.map((c) => JSON.stringify(c)));
      const forgotten = new Set(forget);
      const now = this.state();
      if (store === "chrome") this.save({ ...now, pending: now.pending.filter((c) => !done.has(JSON.stringify(c))), forget: now.forget.filter((s) => !forgotten.has(s)) });
      else this.save({ ...now, panelPending: now.panelPending.filter((c) => !done.has(JSON.stringify(c))), panelForget: now.panelForget.filter((s) => !forgotten.has(s)) });
    }
    return { added, refused };
  }
}
