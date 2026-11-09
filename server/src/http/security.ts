// The checks that keep a web page or another local client from reaching a server that can run
// commands. Each one runs before anything else can happen.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

const TICKET_TTL_MS = 30_000;

export class Security {
  readonly token = randomBytes(32).toString("base64url");
  private port = 0;
  private tokenFile: string;
  private sessions = new Set<string>();
  private tickets = new Map<string, number>();

  constructor(dataDir: string) {
    this.tokenFile = path.join(dataDir, "token");
  }

  // The token file only exists until the first login. No command can run before someone has
  // logged in, so child processes running as the same user never get to read it.
  writeTokenFile(): void {
    // Replaced, not written through: a symlink planted at the name is never followed.
    rmSync(this.tokenFile, { force: true });
    writeFileSync(this.tokenFile, this.token, { mode: 0o600, flag: "wx" });
    chmodSync(this.tokenFile, 0o600);
  }

  removeTokenFile(): void {
    rmSync(this.tokenFile, { force: true });
  }

  setPort(port: number): void {
    this.port = port;
  }

  // The artifact preview server. The app may frame that one origin and nothing else.
  private previewOrigin: string | null = null;

  setPreviewOrigin(origin: string): void {
    this.previewOrigin = origin;
  }

  get origins(): string[] {
    return [`http://127.0.0.1:${this.port}`, `http://localhost:${this.port}`];
  }

  get link(): string {
    return `http://127.0.0.1:${this.port}/#token=${this.token}`;
  }

  hostAllowed(req: IncomingMessage): boolean {
    const host = req.headers.host;
    return host === `127.0.0.1:${this.port}` || host === `localhost:${this.port}`;
  }

  // Mutations and upgrades need an exact Origin. Browsers always send it there, and a missing
  // header is refused so a non-browser client must state one too.
  originAllowed(req: IncomingMessage, required: boolean): boolean {
    const origin = req.headers.origin;
    if (origin === undefined) return !required;
    return this.origins.includes(origin);
  }

  private get cookieName(): string {
    return `ad_session_${this.port}`; // Cookies are not separated by port.
  }

  exchange(res: ServerResponse, token: unknown): boolean {
    if (typeof token !== "string") return false;
    const given = createHash("sha256").update(token).digest();
    const real = createHash("sha256").update(this.token).digest();
    if (!timingSafeEqual(given, real)) return false;
    const session = randomBytes(32).toString("base64url");
    this.sessions.add(session);
    res.setHeader("set-cookie", `${this.cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/`);
    this.removeTokenFile();
    return true;
  }

  authenticated(req: IncomingMessage): boolean {
    for (const part of (req.headers.cookie ?? "").split(";")) {
      const [name, value] = part.trim().split("=");
      if (name === this.cookieName && value && this.sessions.has(value)) return true;
    }
    return false;
  }

  issueTicket(): string {
    const ticket = randomBytes(24).toString("base64url");
    const now = Date.now();
    for (const [old, expires] of this.tickets) if (expires < now) this.tickets.delete(old);
    this.tickets.set(ticket, now + TICKET_TTL_MS);
    return ticket;
  }

  // One use only: a ticket is spent by the first attempt, valid or not.
  redeemTicket(ticket: string | null): boolean {
    if (!ticket) return false;
    const expires = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    return expires !== undefined && expires >= Date.now();
  }

  contentSecurityPolicy(): string {
    const sockets = this.origins.map((origin) => origin.replace("http://", "ws://")).join(" ");
    return [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'", // CodeMirror and xterm inject style elements.
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src 'self' ${sockets}`,
      "worker-src 'self'",
      `frame-src ${this.previewOrigin ?? "'none'"}`,
      "manifest-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join("; ");
  }

  applyHeaders(res: ServerResponse): void {
    res.setHeader("content-security-policy", this.contentSecurityPolicy());
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("cross-origin-opener-policy", "same-origin");
    res.setHeader("cross-origin-resource-policy", "same-origin");
  }
}
