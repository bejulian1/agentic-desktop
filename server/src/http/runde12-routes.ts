// Round 12 (SPEC 26), part A: cookies from the user's browser (26.4) and Økt (26.2). Kept apart
// from api.ts so the round's agents do not edit the same lines.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CookieImportResult, Settings, Thread } from "../../../shared/protocol.ts";
import { chromeConfigHome } from "../chrome-import.ts";
import { defaultHome, listCookieProfiles, listCookieSites, readCookies } from "../cookie-import.ts";
import { HttpError } from "../errors.ts";
import { EndedServers, sessionInfo, stopSessionTask } from "../session-info.ts";
import type { ApiDeps } from "./api.ts";

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
}

type Route = (method: string, spec: string, handler: (ctx: Ctx) => unknown) => void;

// The settings this round adds, checked for PATCH /api/settings. null resets to the default.
export function runde12Settings(body: any): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (body.browserAskSignedIn !== undefined) {
    if (body.browserAskSignedIn !== null && typeof body.browserAskSignedIn !== "boolean") throw new HttpError(400, "Ugyldig verdi for browserAskSignedIn");
    out.browserAskSignedIn = body.browserAskSignedIn ?? undefined;
  }
  if (body.cookieOffer !== undefined) {
    if (body.cookieOffer !== null && body.cookieOffer !== "never" && body.cookieOffer !== "done") throw new HttpError(400, "Ugyldig verdi for cookieOffer");
    out.cookieOffer = body.cookieOffer ?? undefined;
  }
  return out;
}

export function runde12Routes(route: Route, deps: ApiDeps, h: { thread: (id: string) => Thread }): void {
  // Profiles are found from the home folder: tests give a temporary one, so they never reach the
  // user's real browser.
  const home = () => deps.homeDir ?? defaultHome();
  const configHome = () => deps.chromeConfigHome ?? chromeConfigHome();
  const jar = () => {
    if (!deps.importedCookies) throw new HttpError(404, "Nettleseren er ikke tilgjengelig");
    return deps.importedCookies;
  };

  route("GET", "/api/browser/cookie-profiles", () => listCookieProfiles(home(), configHome()));
  route("POST", "/api/browser/cookie-sites", ({ body }) => listCookieSites(home(), configHome(), body ?? {}));
  route("POST", "/api/browser/cookie-import", async ({ body }): Promise<CookieImportResult> => {
    const cookies = jar();
    const read = await readCookies(home(), configHome(), body ?? {});
    if (!read.cookies.length) {
      throw new HttpError(422, read.keyringMissing ? "Fant ikke nøkkelen i nøkkelringen, så informasjonskapslene kunne ikke leses" : "Fant ingen informasjonskapsler å importere for nettstedene du valgte");
    }
    cookies.add(read.cookies, read.label);
    for (const site of new Set(read.cookies.map((c) => c.site))) deps.cookieBrowser?.dropSignedInGrants(site);
    // Into Chrome now if it runs; else they wait in the data folder until it starts.
    const applied = await deps.cookieBrowser?.syncCookies().catch(() => null);
    const sites = new Set(read.cookies.map((c) => c.site)).size;
    return { sites, cookies: read.cookies.length - (applied?.refused ?? 0), skipped: read.skipped + (applied?.refused ?? 0), keyringMissing: read.keyringMissing };
  });
  route("GET", "/api/browser/cookies", () => deps.importedCookies?.list() ?? []);
  route("DELETE", "/api/browser/cookies/:site", async ({ params }) => {
    const site = decodeURIComponent(params.site).toLowerCase();
    if (!jar().forget(site).length) throw new HttpError(404, "Fant ikke nettstedet");
    deps.cookieBrowser?.dropSignedInGrants(site);
    await deps.cookieBrowser?.syncCookies().catch(() => null);
  });
  route("DELETE", "/api/browser/cookies", async () => {
    jar().forget();
    deps.cookieBrowser?.dropSignedInGrants();
    await deps.cookieBrowser?.syncCookies().catch(() => null);
  });

  // Økt (SPEC 26.2): what the panel shows for a thread, and Stopp for its background tasks.
  const ended = new EndedServers();
  const sessionDeps = () => ({
    ended,
    github: deps.github,
    store: deps.store,
    runner: deps.runner,
    secrets: deps.secrets,
    terminals: deps.terminals,
    servers: deps.servers,
    browser: deps.browser,
    importedCookies: deps.importedCookies,
  });
  route("GET", "/api/threads/:id/session", ({ params }) => sessionInfo(sessionDeps(), h.thread(params.id)));
  route("POST", "/api/threads/:id/session/stop", async ({ params, body }) => {
    await stopSessionTask(sessionDeps(), h.thread(params.id), body?.taskId);
  });
}
