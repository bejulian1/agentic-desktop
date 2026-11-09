// Round 13 (SPEC 27.2): web search and reading a web page, for Chat and for Kode.
//
// A search goes one of three ways (webSearchRoute in shared/protocol.ts): the provider's own search
// when the model has it (handled in the provider, not here), the app's own headless browser on the
// search page set in Innstillinger → Chat, or, for the demo model without a search page, made-up
// sources that say they are made up. Reading a page always goes through the app's browser.
import type { WebSource } from "../../../shared/protocol.ts";
// Types only: tools.ts imports this file, so nothing is taken from it at run time.
import type { Tool, ToolContext, ToolResult } from "./tools.ts";

const MAX_PAGE_CHARS = 20_000;
const MAX_QUERY = 300;

export interface WebPage {
  url: string;
  title: string;
  text: string;
  favicon?: string;
}

// What the app's browser gives: the results on a search page, and the text of a page.
export interface WebReader {
  searchPage(url: string, signal?: AbortSignal): Promise<WebSource[]>;
  readPage(url: string, signal?: AbortSignal): Promise<WebPage>;
}

export interface WebAccess {
  route: "browser" | "demo";
  search(query: string, signal: AbortSignal): Promise<WebSource[]>;
  read(url: string, signal: AbortSignal): Promise<WebPage>;
}

export function searchUrlFor(template: string, query: string): string {
  return template.replaceAll("{q}", encodeURIComponent(query));
}

export function browserWeb(reader: WebReader, searchUrl: string | undefined): WebAccess {
  return {
    route: "browser",
    async search(query, signal) {
      if (!searchUrl) throw new Error("Ingen søkemotor er satt opp. Legg inn en søke-adresse i Innstillinger → Chat.");
      return reader.searchPage(searchUrlFor(searchUrl, query), signal);
    },
    read: (url, signal) => reader.readPage(url, signal),
  };
}

const slug = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "sok";

// The demo model's search: three sources on .invalid addresses, which can never be real sites,
// each marked as a demo in the title and the flag. Reading a page still uses the real browser.
export function demoSources(query: string): WebSource[] {
  const q = query.trim() || "søket";
  const s = slug(q);
  return [
    { title: `Demo: ${q}, kort forklart`, url: `https://demo-kilde.invalid/${s}`, snippet: `En oppdiktet kilde fra demo-modellen om «${q}». Ingen ekte nettside er besøkt.`, demo: true },
    { title: `Demo: Vanlige spørsmål om ${q}`, url: `https://eksempel-wiki.invalid/wiki/${s}`, snippet: "Spørsmål og svar laget av demo-modellen, for å vise hvordan kilder ser ut.", demo: true },
    { title: `Demo: Notater og lenker om ${q}`, url: `https://notater.invalid/${s}/lenker`, snippet: "Tredje demo-kilde. Med en ekte modell står ekte sider her.", demo: true },
  ];
}

export function demoWeb(reader: WebReader | undefined): WebAccess {
  return {
    route: "demo",
    async search(query, signal) {
      await new Promise((resolve) => setTimeout(resolve, 600)); // long enough to see «Søker på nettet…»
      signal.throwIfAborted();
      return demoSources(query);
    },
    async read(url, signal) {
      if (!reader) throw new Error("Nettleseren er ikke tilgjengelig");
      return reader.readPage(url, signal);
    },
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// The text the model gets: numbered sources with address and snippet. The UI shows the sources
// as cards from the event, not from this text.
export function sourcesText(query: string, sources: WebSource[]): string {
  if (!sources.length) return `Ingen treff for «${query}». Prøv andre ord, eller svar uten nettsøk.`;
  const demo = sources.some((s) => s.demo) ? "\n\n(Dette er demo-kilder fra demo-modellen. De er ikke ekte nettsider.)" : "";
  return sources.map((s, i) => `${i + 1}. ${s.title}\n   ${s.url}${s.snippet ? `\n   ${s.snippet}` : ""}`).join("\n") + demo;
}

const fail = (text: string): ToolResult => ({ text, isError: true });

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n\n[Siden er kuttet etter ${max} tegn.]` : text;
}

function web(ctx: ToolContext): WebAccess {
  if (!ctx.web) throw new Error("Nettsøk er ikke tilgjengelig her");
  return ctx.web;
}

export const webSearchTool: Tool = {
  kind: "read",
  def: {
    name: "web_search",
    description:
      "Search the web. Returns the top results with title, address and a snippet. Use it for current facts, documentation and anything you are unsure of; " +
      "cite the sources you use with their address. Read a result in full with web_fetch when it is offered.",
    parameters: { type: "object", properties: { query: { type: "string", description: "What to search for, a few words" } }, required: ["query"], additionalProperties: false },
  },
  summary: (input) => String(input.query ?? "").slice(0, MAX_QUERY),
  async run(input, ctx) {
    const query = String(input.query ?? "").trim().slice(0, MAX_QUERY);
    if (!query) return fail("query mangler");
    const sources = await web(ctx).search(query, ctx.signal);
    return { text: sourcesText(query, sources), sources };
  },
};

export const webFetchTool: Tool = {
  kind: "read",
  def: {
    name: "web_fetch",
    description: "Read a web page the user gave you, or one from web_search, as plain text. Only http and https addresses.",
    parameters: { type: "object", properties: { url: { type: "string", description: "The full address, starting with http:// or https://" } }, required: ["url"], additionalProperties: false },
  },
  summary: (input) => String(input.url ?? ""),
  async run(input, ctx) {
    const url = String(input.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) return fail("Adressen må begynne med http:// eller https://");
    const page = await web(ctx).read(url, ctx.signal);
    const source: WebSource = { title: page.title || hostOf(page.url), url: page.url, ...(page.favicon ? { favicon: page.favicon } : {}) };
    const body = clip(page.text.trim() || "(siden har ingen tekst)", Math.min(MAX_PAGE_CHARS, ctx.maxResultChars ?? MAX_PAGE_CHARS));
    return { text: `Side: ${page.url}\nTittel: ${page.title || "(uten tittel)"}\n\n${body}`, sources: [source] };
  },
};

export const WEB_TOOLS = [webSearchTool, webFetchTool];
