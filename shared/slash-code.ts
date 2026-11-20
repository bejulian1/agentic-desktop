import type { CommandInfo } from "./protocol.ts";

// Panel commands use the same scopes as their normal entry points in Kode.
export const CODE_SLASH_COMMANDS: CommandInfo[] = [
  { name: "browser", aliases: ["nettleser"], args: "[ny]", description: "Åpne nettleserpanelet eller opprett en ny fane", kind: "builtin", scope: "code", group: "workspace" },
  { name: "files", aliases: ["filer"], description: "Åpne filene i prosjektet eller hjemmemappen", kind: "builtin", scope: "code", group: "workspace" },
  { name: "terminal", args: "[ny]", description: "Åpne terminalpanelet eller opprett en ny terminal", kind: "builtin", scope: "code", group: "workspace" },
  { name: "session", aliases: ["økt"], description: "Vis trådens miljø, kontekst og bakgrunnsoppgaver", kind: "builtin", scope: "code", group: "workspace" },
  { name: "overview", aliases: ["oversikt"], description: "Åpne oversikten for prosjektet eller denne datamaskinen", kind: "builtin", scope: "code", group: "workspace" },
  { name: "panel", aliases: ["verktøypanel"], description: "Velg et verktøy i sidepanelet", kind: "builtin", scope: "code", group: "workspace" },
  { name: "branches", aliases: ["grener"], description: "Vis lokale Git-grener og arbeidstrær for prosjektet", kind: "builtin", scope: "project", group: "workspace" },
  { name: "github", description: "Vis pull requests og issues for prosjektets GitHub-repo", kind: "builtin", scope: "project", group: "workspace" },
  { name: "project-settings", aliases: ["prosjektinnstillinger"], description: "Åpne agentinnstillingene for prosjektet", kind: "builtin", scope: "project", group: "workspace" },
  { name: "project-sources", aliases: ["prosjektkilder"], description: "Se hvor prosjektets agentinnstillinger kommer fra", kind: "builtin", scope: "project", group: "workspace" },
];
