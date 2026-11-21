import { sourceText } from "../../../shared/i18n.ts";
// The user's own text for a built-in layer of the system prompt (Innstillinger → Konfigurasjon →
// Forhåndsvisning). A layer is generated at run time, so an edited copy would freeze what was true
// when it was edited: the project, the tools on, the date. The live parts are therefore
// placeholders. The editor gets the generated text with each live part replaced by {{name}}, and
// what the model gets is the saved text with each {{name}} filled in again for that thread.
//
// An override belongs to one mode and variant (Kode with a project, Kode without one, Chat),
// because the built-in text differs between them. Miljø is not editable: it is only live state.
// The user's own layers (global AGENTS.md, Chat-personalisering) have their own editors.
import type { PromptLayer } from "./context.ts";

export const EDITABLE_LAYERS = ["base", "chat-base", "skills", "ui-mods", "mcp"];
export const MAX_OVERRIDE_CHARS = 40_000;

export type OverrideVariant = "project" | "none" | "chat";

export function overridePrefix(mode: "code" | "chat", hasProject: boolean): string {
  return `${mode}/${mode === "chat" ? "chat" : hasProject ? "project" : "none"}`;
}

export function overrideKey(mode: "code" | "chat", hasProject: boolean, layerId: string): string {
  return `${overridePrefix(mode, hasProject)}/${layerId}`;
}

// The live parts of a layer, by placeholder name. Empty values are left out.
export type LayerVars = Record<string, string>;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Generated text → what the editor shows. Longest values first, so a value that contains another
// (a project path that contains the project's name) is replaced whole. A short single word, like a
// project called "api", is only replaced where it stands alone.
export function toTemplate(text: string, vars: LayerVars): string {
  let out = text;
  const entries = Object.entries(vars).filter(([, value]) => value.trim().length >= 2).sort((a, b) => b[1].length - a[1].length);
  for (const [name, value] of entries) {
    const word = !/\s/.test(value) && value.length < 40;
    out = word ? out.replace(new RegExp(`(?<![\\w/{-])${escapeRegExp(value)}(?![\\w/}-])`, "g"), () => `{{${name}}}`) : out.split(value).join(`{{${name}}}`);
  }
  return out;
}

// Saved text → what the model gets. An unknown placeholder is left as it is written.
export function fromTemplate(text: string, vars: LayerVars): string {
  return text.replace(/\{\{([a-z_]+)\}\}/g, (whole, name: string) => (Object.hasOwn(vars, name) ? vars[name] : whole));
}

// The list lines of a skills layer ("- name: description"), as one live part.
export function skillLines(text: string): string {
  return text.split("\n").filter((line) => /^- [a-z0-9][a-z0-9-]*: /.test(line)).join("\n");
}

export interface OverlaidLayer extends PromptLayer {
  editable: boolean;
  overridden: boolean;
  template?: string; // what the editor starts from: the saved text, or the built-in one with placeholders
  placeholders?: string[]; // the names that may be used in this layer
}

// Applies the saved texts for one mode and variant. vars: the live parts per layer id.
export function overlay(layers: PromptLayer[], overrides: Record<string, string>, prefix: string, vars: Record<string, LayerVars>): OverlaidLayer[] {
  return layers.map((layer) => {
    if (!EDITABLE_LAYERS.includes(layer.id)) return { ...layer, editable: false, overridden: false };
    const live = Object.fromEntries(Object.entries(vars[layer.id] ?? {}).filter(([, value]) => value));
    const saved = overrides[`${prefix}/${layer.id}`];
    const placeholders = Object.keys(live);
    if (typeof saved !== "string" || !saved.trim()) return { ...layer, editable: true, overridden: false, template: toTemplate(layer.text, live), placeholders };
    return { ...layer, text: fromTemplate(saved, live), source: sourceText("Din egen tekst, lagret i Forhåndsvisning"), sourceMessage: undefined, editable: true, overridden: true, template: saved, placeholders };
  });
}
