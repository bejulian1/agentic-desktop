import type { CommandInfo } from "./protocol.ts";
import { CODE_SLASH_COMMANDS } from "./slash-code.ts";
import { THREAD_SLASH_COMMANDS } from "./slash-thread.ts";

// The API supplies this catalog alongside dynamically discovered skills.
export const BUILTIN_COMMANDS: CommandInfo[] = [
  { name: "new", aliases: ["ny", "reset"], args: "[navn]", description: "Start en ny tråd", kind: "builtin", group: "conversation" },
  { name: "mode", aliases: ["modus"], description: "Bytt mellom Chat og Kode", kind: "builtin", group: "app" },
  { name: "model", aliases: ["modell"], args: "[navn]", description: "Velg modell for tråden", kind: "builtin", group: "model" },
  { name: "reasoning", aliases: ["tenkning"], args: "[none|low|medium|high|xhigh|max]", description: "Velg hvor mye modellen skal tenke", kind: "builtin", group: "model" },
  { name: "agents", aliases: ["agenter", "tasks"], description: "Åpne prosjektets instanser, underagenter og meldinger", kind: "builtin", group: "workspace", scope: "project" },
  { name: "diff", aliases: ["endringer"], description: "Vis prosjektets filendringer", kind: "builtin", group: "workspace", scope: "project" },
  { name: "context", aliases: ["kontekst", "ctx"], description: "Vis hva som fyller modellens kontekstvindu", kind: "builtin", group: "conversation" },
  { name: "stop", aliases: ["stopp"], description: "Stopp bare kjøringen i denne samtalen", kind: "builtin", group: "conversation" },
  { name: "status", description: "Vis tråd-ID, kontekstbruk og grenser", kind: "builtin", group: "conversation" },
  { name: "compact", aliases: ["komprimer", "compress"], description: "Komprimer konteksten nå", kind: "builtin", group: "conversation" },
  { name: "fork", aliases: ["gaffel", "kopier", "branch"], description: "Lag en gaffel: en ny tråd med hele historikken", kind: "builtin", group: "conversation" },
  { name: "goal", aliases: ["mål"], args: "<mål>", description: "Sett et mål for tråden, vist i det festede sammendraget", kind: "builtin", group: "agent", scope: "code" },
  { name: "plan", args: "[on|off|status]", description: "Slå planmodus av eller på: modellen planlegger uten å endre filer", kind: "builtin", group: "agent", scope: "code" },
  { name: "init", description: "Lag en AGENTS.md-mal i prosjektet", kind: "builtin", group: "workspace", scope: "project" },
  { name: "project", aliases: ["prosjekt"], description: "Velg prosjekt for nye tråder", kind: "builtin", group: "workspace" },
  { name: "task", aliases: ["oppgave"], description: "Start en chat uten prosjekt", kind: "builtin", group: "conversation" },
  { name: "side", description: "Start en sidesamtale i en ny rute, uten å avbryte denne", kind: "builtin", group: "conversation" },
  { name: "btw", args: "<spørsmål>", description: "Et raskt sidespørsmål uten verktøy eller lagring i samtalen", kind: "builtin", group: "agent" },
  { name: "background", aliases: ["bakgrunn", "bg"], args: "<oppgave>", description: "Start en egen bakgrunnsøkt med samtalens kontekst", kind: "builtin", group: "agent" },
  { name: "queue", aliases: ["kø", "q"], args: "[instruksjon | list | add …]", description: "Vis køen eller legg en melding etter den aktive turen", kind: "builtin", group: "agent" },
  { name: "steer", aliases: ["styr"], args: "<korrigering>", description: "Send korrigeringen inn ved neste steg i den aktive turen", kind: "builtin", group: "agent" },
  { name: "personality", aliases: ["personlighet"], args: "[navn]", description: "Velg personlighet for svarene", kind: "builtin", group: "model" },
  { name: "undo", aliases: ["angre"], description: "Angre siste tur", kind: "builtin", group: "agent", scope: "project" },
  { name: "playtest", args: "[start|stop]", description: "Start eller stopp prosjektets playtest", kind: "builtin", group: "workspace", scope: "project" },
  { name: "vscode", description: "Åpne prosjektet i VS Code", kind: "builtin", group: "workspace", scope: "project" },
  { name: "review-changes", aliases: ["review", "gjennomgå"], args: "[fokus]", description: "Kodegjennomgang av endringene i tråden", kind: "builtin", group: "agent", scope: "project" },
  { name: "mcp", description: "Vis MCP-serverne og statusen deres", kind: "builtin", group: "app" },
  { name: "memories", aliases: ["minner"], description: "Minner på tvers av tråder: se og endre dem i Innstillinger → Personalisering og minner", kind: "builtin", group: "app" },
  { name: "worktree", aliases: ["arbeidstre"], description: "Velg grener eller opprett et eget arbeidstre for prosjektet", kind: "builtin", group: "workspace", scope: "project" },
  { name: "storage", aliases: ["lagring"], description: "Vis hvor mye plass appen bruker, og rydd opp", kind: "builtin", group: "app" },
  { name: "help", aliases: ["hjelp", "commands"], args: "[søk]", description: "Søk i kommandoer og skills", kind: "builtin", group: "app" },
  { name: "sessions", aliases: ["resume", "history", "tråder"], args: "[søk]", description: "Finn og åpne en lagret tråd", kind: "builtin", group: "conversation" },
  { name: "find", aliases: ["finn"], description: "Søk i meldingene i denne samtalen", kind: "builtin", group: "conversation" },
  { name: "retry", aliases: ["prøv-igjen"], description: "Lag siste svar på nytt etter bekreftelse", kind: "builtin", scope: "chat", group: "conversation" },
  { name: "temporary", aliases: ["midlertidig"], description: "Start en midlertidig Chat uten lagrede minner", kind: "builtin", scope: "plain-chat", group: "conversation" },
  { name: "tools", aliases: ["verktøy"], description: "Åpne verktøyvalgene for denne chatten", kind: "builtin", scope: "chat", group: "model" },
  { name: "babysit", aliases: ["følg"], args: "[task|pr <lenke eller #nr>|status|stop]", description: "Følg en aktiv kjøring eller GitHub-PR og få statusvarsler", kind: "builtin", group: "agent" },
  { name: "busy", args: "[queue|steer|status]", description: "Se eller endre hvordan meldinger sendes mens modellen jobber", kind: "builtin", group: "agent" },
  { name: "palette", aliases: ["palett"], args: "[søk]", description: "Søk i handlingspaletten", kind: "builtin", group: "app" },
  { name: "skills", description: "Åpne biblioteket med skills", kind: "builtin", group: "app" },
  { name: "usage", aliases: ["bruk"], description: "Åpne statistikken for tokens og modellkostnader", kind: "builtin", group: "app" },
  { name: "settings", aliases: ["innstillinger"], description: "Åpne innstillingene for aktiv modus", kind: "builtin", group: "app" },
  { name: "config", aliases: ["konfigurasjon"], description: "Åpne innstillingene for modellinstruksjoner og kontekst", kind: "builtin", group: "app" },
  { name: "shortcuts", aliases: ["hurtigtaster"], description: "Vis konfigurerte hurtigtaster", kind: "builtin", group: "app" },
  { name: "theme", aliases: ["skin", "tema"], args: "[lys|mørk|system]", description: "Velg appens fargetema", kind: "builtin", group: "app" },
  { name: "version", aliases: ["versjon"], description: "Vis appversjon og byggnummer", kind: "builtin", group: "app" },
  { name: "artifacts", description: "Åpne rommet for lagrede Artifacts", kind: "builtin", group: "app" },
  ...THREAD_SLASH_COMMANDS,
  ...CODE_SLASH_COMMANDS,
];

export const COMMAND_GROUPS = {
  conversation: "Samtale",
  model: "Modell og kontekst",
  agent: "Kjøring og kø",
  workspace: "Prosjekt og paneler",
  app: "App og innstillinger",
  skills: "Skills",
} as const;

export const commandGroup = (command: CommandInfo): keyof typeof COMMAND_GROUPS =>
  command.kind === "skill" ? "skills" : command.group ?? "app";

export interface CommandScope {
  code: boolean;
  project: boolean;
  chatProject: boolean;
  detached?: boolean;
}

const mainWindowActions = new Set(["new", "sessions", "palette", "mode", "task", "side", "fork", "fork-last", "temporary", "skills", "artifacts"]);

export function commandUnavailable(command: CommandInfo, scope: CommandScope): string | undefined {
  if (command.kind === "skill") {
    if (command.mode && command.mode !== (scope.code ? "code" : "chat")) {
      return `/${command.name} er bare tilgjengelig i ${command.mode === "code" ? "Kode" : "Chat"}.`;
    }
    if (scope.chatProject && command.source !== "app") return "Chat-prosjekter bruker bare innebygde app-skills og prosjektets egne instruksjoner.";
  }
  if (command.scope === "project" && (!scope.code || !scope.project)) return `/${command.name} krever Kode-modus og et prosjekt.`;
  if (command.scope === "code" && !scope.code) return `/${command.name} er bare tilgjengelig i Kode.`;
  if ((command.scope === "chat" || command.scope === "plain-chat") && scope.code) return `/${command.name} er bare tilgjengelig i Chat.`;
  if (scope.chatProject && command.scope === "plain-chat") return `/${command.name} er tilgjengelig i Chat utenfor et prosjekt.`;
  if (scope.detached && command.kind === "builtin" && (command.group === "workspace" || mainWindowActions.has(command.name))) {
    return `Bruk /${command.name} i hovedvinduet.`;
  }
  if (scope.chatProject && command.name === "personality" && command.kind === "builtin") return "Dette prosjektet bruker sine egne instruksjoner. Endre dem i Rediger prosjekt.";
}

export function visibleCommands(commands: CommandInfo[], scope: CommandScope): CommandInfo[] {
  return commands.filter(command => !commandUnavailable(command, scope));
}
