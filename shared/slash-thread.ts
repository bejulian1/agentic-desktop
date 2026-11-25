import type { CommandInfo } from "./protocol.ts";

export const THREAD_SLASH_COMMANDS: CommandInfo[] = [
  { name: "title", aliases: ["rename", "tittel"], args: "[ny tittel]", description: "Gi denne tråden nytt navn", kind: "builtin", group: "conversation" },
  { name: "copy", aliases: ["utklipp"], args: "[text|markdown|last|id]", description: "Kopier samtalen som tekst eller Markdown, siste svar eller tråd-ID", kind: "builtin", group: "conversation" },
  { name: "save", aliases: ["export", "eksporter"], description: "Last ned denne samtalen som Markdown", kind: "builtin", group: "conversation" },
  { name: "pin", aliases: ["fest"], args: "[on|off]", description: "Fest eller løsne tråden i sidefanen", kind: "builtin", group: "conversation" },
  { name: "archive", args: "[on|off]", description: "Arkiver tråden, eller hent den tilbake med off", kind: "builtin", group: "conversation" },
  { name: "settle", aliases: ["ferdig", "arkiver"], args: "[on|off]", description: "Ferdigstill og arkiver tråden med mulighet for å angre", kind: "builtin", group: "conversation" },
  { name: "fork-last", aliases: ["gaffel-siste"], description: "Lag en ny tråd med siste melding og svaret som hører til", kind: "builtin", group: "conversation" },
  { name: "window", aliases: ["vindu"], description: "Åpne denne tråden i et eget vindu", kind: "builtin", group: "conversation" },
  { name: "snooze", aliases: ["utsett"], args: "[1h|3h|tomorrow|week|off]", description: "Utsett tråden til et valgt tidspunkt, eller hent den tilbake", kind: "builtin", group: "conversation" },
];
