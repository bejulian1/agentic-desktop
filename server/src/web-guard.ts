// Security fix for round 13 (SPEC 27.2): web search and web reading only ever reach public addresses.
//
// Two layers, both used by web-browser.ts:
// - WebGuard checks an address: http or https, never the app itself, never a name like localhost,
//   *.local or *.internal, and every address DNS gives for the name must be public. Loopback,
//   private nets, link-local, CGNAT, multicast, 0.0.0.0 and the like are refused, also when they
//   hide inside an IPv6 address (::ffff:127.0.0.1, 64:ff9b::a00:1, 2002:7f00:1::).
// - WebGuardProxy is the only way the web reader's Chrome reaches the network. Chrome sends every
//   request to it (loopback included, see web-browser.ts), and it connects to the exact address
//   the check approved. Chrome never looks a name up itself, so a name that answers a public
//   address to the check and a private one a moment later (DNS rebinding) still only reaches the
//   public one. Redirects and everything a page loads go through it too.
//
// The Browser panel and Kode's browser tools do not use this: they may open localhost for
// development servers (browser.ts).
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import net from "node:net";
import type { AddressInfo, Socket } from "node:net";

export const PRIVATE_WEB_MESSAGE = "Lokale og private adresser kan ikke leses med nettlesing";
// On a refusal from the proxy for a plain http request, so the reader can tell it from a page.
export const BLOCK_HEADER = "x-agentic-web-blokkert";

// A refusal. The message is short and for the model.
export class WebBlockedError extends Error {
  constructor(message = PRIVATE_WEB_MESSAGE) {
    super(message);
    this.name = "WebBlockedError";
  }
}

export type Resolver = (host: string) => Promise<string[]>;

// ONLY FOR TESTS. startApp() takes it from AppOptions.webTesting, which only the test harness sets:
// index.ts starts the app without it, and no setting, API field or environment variable can turn it
// on. Without it every check below is in force.
export interface WebTesting {
  // Let loopback through (127.0.0.0/8, ::1 and the name localhost), so the tests can read a fake
  // site on 127.0.0.1. Private nets, link-local and the rest stay refused.
  allowLoopback?: boolean;
  // Stands in for DNS. Without it, tests resolve only localhost, so nothing is looked up for real.
  lookup?: Resolver;
  // Where the proxy really connects for an approved address, so a test can give a name a public
  // address and still serve it from a local test server.
  connect?: (address: string, port: number) => { host: string; port: number };
}

export interface WebGuardOptions {
  appOrigins: () => string[];
  testing?: WebTesting;
}

export interface CheckedAddress {
  url: string;
  host: string; // without brackets
  port: number;
  addresses: string[];
}

const LOOKUP_TIMEOUT_MS = 5_000;
const CACHE_MS = 60_000;
const MAX_CACHE = 500;

// Names that are local by definition, whatever DNS says.
const LOCAL_NAMES = /(^|\.)(localhost|local|internal|localdomain|home\.arpa|lan)$/;

function v4Number(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

// [first address, prefix length] of every IPv4 range that is not the public internet.
const V4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network", 0.0.0.0
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT, also Alibaba's metadata 100.100.100.200
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, also the cloud metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and 255.255.255.255
];
const V4_RANGES = V4_BLOCKED.map(([base, bits]) => ({ base: v4Number(base)!, size: 2 ** (32 - bits) }));

function v4Kind(n: number): "public" | "loopback" | "private" {
  if (n >= 0x7f000000 && n <= 0x7fffffff) return "loopback";
  return V4_RANGES.some((r) => n >= r.base && n < r.base + r.size) ? "private" : "public";
}

// The eight 16-bit groups of an IPv6 address, or null.
function v6Groups(raw: string): number[] | null {
  let ip = raw.split("%")[0].toLowerCase();
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (tail) {
    const n = v4Number(tail[1]);
    if (n === null) return null;
    ip = `${ip.slice(0, -tail[1].length)}${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string) => (s ? s.split(":").map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN)) : []);
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...new Array<number>(fill).fill(0), ...rest];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g)) ? groups : null;
}

function v6Kind(g: number[]): "public" | "loopback" | "private" {
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  const v4 = (hi: number, lo: number) => v4Kind(hi * 65536 + lo);
  if (zero(0, 8)) return "private"; // ::
  if (zero(0, 7) && g[7] === 1) return "loopback"; // ::1
  if (zero(0, 5) && g[5] === 0xffff) return v4(g[6], g[7]); // ::ffff:a.b.c.d
  if (zero(0, 6)) return v4(g[6], g[7]); // ::a.b.c.d, old IPv4-compatible
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return v4(g[6], g[7]); // NAT64
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return "private"; // local NAT64
  if (g[0] === 0x2002) return v4(g[1], g[2]); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return "private"; // Teredo hides an address we cannot check
  if (g[0] === 0x100 && zero(1, 4)) return "private"; // discard
  if ((g[0] & 0xfe00) === 0xfc00) return "private"; // fc00::/7, also fd00:ec2::254
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return "private"; // link- and site-local
  if ((g[0] & 0xff00) === 0xff00) return "private"; // multicast
  return "public";
}

// "public", "loopback" or "private" for an IP address. Anything that does not parse is private.
export function addressKind(ip: string): "public" | "loopback" | "private" {
  const bare = ip.replace(/^\[|\]$/g, "");
  if (net.isIPv4(bare)) return v4Kind(v4Number(bare)!);
  const groups = net.isIPv6(bare.split("%")[0]) ? v6Groups(bare) : null;
  return groups ? v6Kind(groups) : "private";
}

const realLookup: Resolver = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);
// The tests' DNS when they give none: localhost and nothing else, so no lookup leaves the machine.
const testLookup: Resolver = async (host) => {
  if (host === "localhost") return ["127.0.0.1"];
  throw new Error(`ENOTFOUND ${host}`);
};

export class WebGuard {
  private options: WebGuardOptions;
  private lookup: Resolver;
  private cache = new Map<string, { at: number; addresses: Promise<string[]> }>();

  constructor(options: WebGuardOptions) {
    this.options = options;
    this.lookup = options.testing ? (options.testing.lookup ?? testLookup) : realLookup;
  }

  private allowed(ip: string): boolean {
    const kind = addressKind(ip);
    return kind === "public" || (kind === "loopback" && this.options.testing?.allowLoopback === true);
  }

  // The addresses a host may be reached on, or a refusal. A name is looked up once a minute at
  // most, so the check and the proxy agree on the addresses.
  async addresses(hostname: string): Promise<string[]> {
    const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
    if (!host) throw new WebBlockedError();
    if (net.isIP(host.split("%")[0])) {
      if (!this.allowed(host)) throw new WebBlockedError();
      return [host];
    }
    if (LOCAL_NAMES.test(host) && !(this.options.testing?.allowLoopback && /(^|\.)localhost$/.test(host))) throw new WebBlockedError();
    const found = await this.resolve(host);
    if (!found.length) throw new Error(`Fant ikke adressen ${host}`);
    if (!found.every((a) => this.allowed(a))) throw new WebBlockedError();
    return found;
  }

  private resolve(host: string): Promise<string[]> {
    const cached = this.cache.get(host);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.addresses;
    let timer: NodeJS.Timeout | undefined;
    const addresses = Promise.race([
      this.lookup(host),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("tidsavbrudd")), LOOKUP_TIMEOUT_MS);
      }),
    ])
      .then((list) => list.map((a) => a.replace(/^\[|\]$/g, "")))
      .catch(() => {
        this.cache.delete(host); // a failed lookup is tried again next time
        throw new Error(`Fant ikke adressen ${host}`);
      })
      .finally(() => clearTimeout(timer));
    if (this.cache.size >= MAX_CACHE) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(host, { at: Date.now(), addresses });
    return addresses;
  }

  // A whole address: http or https, not the app, and a public host.
  async check(raw: string): Promise<CheckedAddress> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new WebBlockedError(`Ugyldig adresse: ${raw.slice(0, 200)}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new WebBlockedError("Bare http- og https-adresser kan leses med nettlesing");
    if (this.options.appOrigins().includes(url.origin)) throw new WebBlockedError("Appens egen adresse kan ikke åpnes her");
    const addresses = await this.addresses(url.hostname);
    const port = Number(url.port) || (url.protocol === "https:" ? 443 : 80);
    return { url: url.href, host: url.hostname.replace(/^\[|\]$/g, ""), port, addresses };
  }

  // Where to really connect for an approved address: the address itself, except in tests.
  target(address: string, port: number): { host: string; port: number } {
    return this.options.testing?.connect?.(address, port) ?? { host: address, port };
  }
}

// Headers that belong to one hop and are not passed on.
const HOP_HEADERS = new Set(["connection", "proxy-connection", "proxy-authorization", "proxy-authenticate", "keep-alive", "te", "trailer", "transfer-encoding", "upgrade"]);

function endToEnd(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) if (value !== undefined && !HOP_HEADERS.has(name)) out[name] = value;
  return out;
}

const CONNECT_TIMEOUT_MS = 15_000;

// A small forward proxy on 127.0.0.1 for the web reader's Chrome: plain http requests and CONNECT
// tunnels (https, wss), each checked with WebGuard and sent to an approved address.
export class WebGuardProxy {
  private guard: WebGuard;
  private onBlocked: () => void;
  private server?: http.Server;
  private sockets = new Set<Socket>();

  constructor(guard: WebGuard, onBlocked: () => void) {
    this.guard = guard;
    this.onBlocked = onBlocked;
  }

  async start(): Promise<string> {
    const server = http.createServer((req, res) => void this.forward(req, res));
    server.on("connect", (req, socket: Socket, head: Buffer) => void this.tunnel(req, socket, head));
    server.on("upgrade", (_req, socket: Socket) => socket.destroy()); // Chrome tunnels WebSockets with CONNECT
    server.on("connection", (socket: Socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    this.server = server;
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (server) await new Promise((resolve) => server.close(resolve));
  }

  // Checked, or null after the refusal has been answered.
  private async approve(raw: string, refuse: (status: number, message: string, blocked: boolean) => void): Promise<{ host: string; port: number } | null> {
    try {
      const checked = await this.guard.check(raw);
      return this.guard.target(checked.addresses[0], checked.port);
    } catch (err) {
      const blocked = err instanceof WebBlockedError;
      if (blocked) this.onBlocked();
      refuse(blocked ? 403 : 502, (err as Error).message, blocked);
      return null;
    }
  }

  private async forward(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const raw = req.url ?? "";
    if (!/^http:\/\//i.test(raw)) return void res.writeHead(400).end();
    const target = await this.approve(raw, (status, message, blocked) => {
      res.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...(blocked ? { [BLOCK_HEADER]: "1" } : {}) }).end(message);
    });
    if (!target) return;
    const url = new URL(raw);
    const upstream = http.request({
      host: target.host,
      port: target.port,
      method: req.method,
      path: `${url.pathname}${url.search}`,
      headers: { ...endToEnd(req.headers), host: url.host },
      setHost: false,
      agent: false,
      timeout: CONNECT_TIMEOUT_MS,
    });
    upstream.on("response", (answer) => {
      res.writeHead(answer.statusCode ?? 502, endToEnd(answer.headers));
      answer.pipe(res);
    });
    upstream.on("timeout", () => upstream.destroy(new Error("tidsavbrudd")));
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502).end();
      else res.destroy();
    });
    req.pipe(upstream);
  }

  private async tunnel(req: http.IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
    socket.on("error", () => undefined);
    let raw: string;
    try {
      raw = new URL(`https://${req.url ?? ""}`).href; // host:port, checked as an https address
    } catch {
      return void socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    }
    const target = await this.approve(raw, (status) => socket.end(`HTTP/1.1 ${status} ${status === 403 ? "Forbidden" : "Bad Gateway"}\r\n\r\n`));
    if (!target) return;
    const upstream = net.connect({ host: target.host, port: target.port, timeout: CONNECT_TIMEOUT_MS });
    upstream.once("connect", () => {
      upstream.setTimeout(0);
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => {
      if (socket.writable) socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    });
    upstream.on("close", () => socket.destroy());
    socket.on("close", () => upstream.destroy());
  }
}
