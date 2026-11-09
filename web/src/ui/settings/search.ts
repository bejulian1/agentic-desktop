// The search field in Innstillinger. Pages are rendered one at a time, so the rows are listed
// here by hand: the page id, the row title as it stands on the page, and extra words people may
// search for. A hit opens the page and points at the row with that title. The shortcuts come
// from their own table.
import { SHORTCUTS } from "../../state/shortcuts";

export interface Entry {
  page: string;
  label: string;
  words?: string;
}

export const ENTRIES: Entry[] = [
  { page: "general", label: "Åpne appen i", words: "oppstart start modus chat kode standardmodus" },
  { page: "general", label: "Spill av en lyd", words: "lyd ferdig tur varsel sound" },
  { page: "general", label: "Systemvarsel", words: "varsler notification ferdig tur fokus" },
  { page: "general", label: "Spør før fanen lukkes", words: "bekreft avslutt lukk quit" },
  { page: "general", label: "Enter i meldingsfeltet", words: "enter send ny linje ctrl shift linjeskift tast" },
  { page: "general", label: "Vis tenkesammendrag", words: "tenkning resonnering thinking reasoning" },
  { page: "general", label: "Skallutdata utvidet", words: "shell terminal kommandoer verktøy utvid" },
  { page: "general", label: "Meldinger mens agenten jobber", words: "kø styr send med en gang steer queue melding tur" },
  { page: "general", label: "Alltid øverst", words: "vindu electron" },
  { page: "code", label: "Kode uten prosjekt", words: "startside hilsen prosjektkort hva skal vi bygge denne datamaskinen" },
  { page: "code", label: "Kode med prosjekt", words: "startside hilsen prosjektkort miljø github hva skal vi jobbe med" },
  { page: "code", label: "Festet sammendrag", words: "mål plan" },
  { page: "code", label: "Åpne agent-tråder i ny rute", words: "rute vindu agent" },
  { page: "chat", label: "Forhåndsvis HTML i chatten", words: "artifacts html sandkasse" },
  { page: "chat", label: "Prosjekter i Chat", words: "prosjekt samle chatter mappe" },
  { page: "appearance", label: "Tema", words: "lys mørk system farge dark light" },
  { page: "appearance", label: "Fargetema", words: "tema palett høy kontrast varm kald fjord solbleket farger arktisk sand" },
  { page: "appearance", label: "Aksentfarge", words: "farge blå fiolett grønn oransje rosa rød grafitt accent" },
  { page: "appearance", label: "Appikon", words: "ikon app-ikon favicon vindu statusfelt appbibliotek snakkeboble monogram terminal" },
  { page: "appearance", label: "Sidefane", words: "standard smart sidefane lister kort" },
  { page: "appearance", label: "Panelknapper", words: "toppfelt knapper samlet hver for seg panel terminal endringer nettleser filer" },
  { page: "appearance", label: "Sidepanel", words: "panel startside verktøy faner fliser høyre panel" },
  { page: "appearance", label: "Tekststørrelse", words: "skrift skriftstørrelse font størrelse zoom" },
  { page: "appearance", label: "Tetthet", words: "kompakt luftig rader density" },
  { page: "appearance", label: "Reduser bevegelse", words: "animasjoner overganger motion" },
  { page: "appearance", label: "Kodeskrift", words: "monospace font skrift editor" },
  { page: "appearance", label: "Skriftstørrelse for kode", words: "kode font editor størrelse" },
  { page: "appearance", label: "Tabulatorbredde", words: "tab tabulator innrykk editor kode" },
  { page: "appearance", label: "Bryt lange linjer", words: "linjebryting wrap editor kode" },
  { page: "models", label: "Standardmodell", words: "modell standard default" },
  { page: "models", label: "Komprimering", words: "kontekst kontekstvindu compact komprimer" },
  { page: "models", label: "Steg per tur", words: "verktøykall grense maks tur" },
  { page: "providers", label: "Tilkoblede leverandører", words: "api-nøkkel nøkkel koble fra" },
  { page: "providers", label: "Populære leverandører", words: "openrouter abliteration anthropic openai koble til nøkkel" },
  { page: "providers", label: "Egendefinert", words: "openai-kompatibel adresse lokal server" },
  { page: "git", label: "Dette prosjektet", words: "gren branch" },
  { page: "github", label: "Konto", words: "github token tilgangstoken personlig pull request issues koble til beta" },
  { page: "usage", label: "Bruk", words: "tokens profil navn" },
  { page: "usage", label: "Statistikk", words: "statistikk tokens økter meldinger rekke aktivitet aktivitetskart startside" },
  { page: "usage", label: "Kostnad", words: "kostnad pris dollar" },
  { page: "storage", label: "Fordeling", words: "lagring plass disk størrelse database bilder nettleser storage" },
  { page: "storage", label: "Rydd opp", words: "lagring slett buffer cache foreldreløse komprimer vacuum logger arkiverte" },
  { page: "storage", label: "Datamappe", words: "lagring sti mappe nedlastinger" },
  { page: "privacy", label: "Telemetri", words: "personvern data sporing" },
  { page: "privacy", label: "Nettverk", words: "personvern localhost" },
  { page: "privacy", label: "API-nøkler og GitHub-token", words: "nøkler nøkkelring keyring keys.json kryptert passord" },
  { page: "privacy", label: "Arkiverte tråder", words: "slett data historikk" },
  { page: "config", label: "Instruksjoner for alle prosjekter", words: "global agents.md konfigurasjon" },
  { page: "config", label: "Global settings.json", words: "settings.json konfigurasjon" },
  { page: "personalization", label: "Personlighet", words: "svar tone personality" },
  { page: "personalization", label: "Minner på tvers av tråder", words: "minne memory husk remember av på" },
  { page: "personalization", label: "Lagrede minner", words: "minne memory søk endre slett alle legg til memory.md" },
  // Round 9b (SPEC 22): the harness, Chat's own personalisation, the memory upgrade and skill import.
  { page: "harness", label: "Spør før store endringer", words: "harness grunn systemprompt store endringer spør først godkjenning" },
  { page: "harness", label: "Kjør tester etter endringer", words: "harness verifisering test typesjekk bygg påminnelse" },
  { page: "harness", label: "Global AGENTS.md", words: "harness agents.md gjenopprett standard tilbakestill sikkerhetskopi backup diff forskjell" },
  { page: "harness", label: "Forhåndsvisning", words: "systemprompt lag tokens prompt harness identitet miljø" },
  { page: "chat-personal", label: "Systeminstruks", words: "chat personalisering instruks system prompt egendefinert" },
  { page: "chat-personal", label: "Om deg", words: "chat personalisering om meg profil" },
  { page: "chat-personal", label: "Tone", words: "chat stil kort vennlig grundig formell uformell" },
  { page: "chat-personal", label: "Oppdater minnet av seg selv", words: "chat minne automatisk husk memory" },
  { page: "chat-personal", label: "Lagrede Chat-minner", words: "chat minner slett endre legg til" },
  { page: "personalization", label: "Foreslå opprydding av seg selv", words: "minneoppgradering rydd slå sammen duplikater utdaterte memory upgrade" },
  { page: "personalization", label: "Rydd i minnene nå", words: "minneoppgradering rydd slå sammen duplikater utdaterte forslag" },
  { page: "skills", label: "Når agenten foreslår en skill", words: "skills selvforbedring propose_skill spør auto av hermes" },
  { page: "skills", label: "Alle skills", words: "skill.md ny lag endre fjern slå av på mappe importer import mange filer dra slipp" },
  { page: "shortcuts", label: "Hurtigtaster", words: "taster tastatur snarveier keybindings" },
  ...SHORTCUTS.map((s) => ({ page: "shortcuts", label: s.label, words: "hurtigtast snarvei taster" })),
  { page: "mcp", label: "MCP-servere", words: "mcp verktøy tjenere kommer senere" },
  { page: "hooks", label: "Hooks", words: "skript hooks" },
  { page: "browser", label: "Kjører headless", words: "chrome nettleser" },
  { page: "browser", label: "Playtest", words: "spill test" },
  { page: "browser", label: "Importer fra Chrome", words: "bokmerker historikk import chromium" },
  { page: "browser", label: "Informasjonskapsler", words: "cookies innlogget logg inn importer firefox chromium glem" }, // round 12
  { page: "browser", label: "Spør før agenter bruker innloggede nettsteder", words: "agent godkjenning cookies innlogget" }, // round 12
  { page: "desktop", label: "Styr Linux-skrivebordet i bakgrunnen", words: "skrivebord computer use cua" },
  { page: "permissions", label: "Standard for nye prosjekter", words: "tillatelser spør godta redigeringer full tilgang godkjenning" },
  { page: "permissions", label: "Prosjekter", words: "tillatelser per prosjekt" },
  { page: "worktrees", label: "Worktrees", words: "git worktree" },
  { page: "archived", label: "Arkiverte tråder", words: "gjenopprett arkiv" },
  { page: "about", label: "Versjon", words: "om versjon byggnummer" },
];

const fold = (text: string) => text.toLocaleLowerCase("nb").normalize("NFC");

// Every word in the query must be found in the page name, the row title or the extra words.
// Hits in the title come first.
export function search(query: string, pageLabel: (id: string) => string): Entry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: Array<{ entry: Entry; score: number }> = [];
  for (const entry of ENTRIES) {
    const label = fold(entry.label);
    const haystack = `${fold(pageLabel(entry.page))} ${label} ${fold(entry.words ?? "")}`;
    if (!words.every((w) => haystack.includes(w))) continue;
    scored.push({ entry, score: words.filter((w) => label.includes(w)).length });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.entry);
}

// The pages with at least one hit, or whose name matches.
export function matchingPages(query: string, pages: Array<{ id: string; label: string }>): Set<string> {
  const hits = new Set(search(query, (id) => pages.find((p) => p.id === id)?.label ?? "").map((e) => e.page));
  const words = fold(query).split(/\s+/).filter(Boolean);
  for (const page of pages) if (words.length && words.every((w) => fold(page.label).includes(w))) hits.add(page.id);
  return hits;
}
