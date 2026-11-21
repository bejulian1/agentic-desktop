import { lookupMessage, language } from "../../lib/i18n";
// The search field in Innstillinger. Pages are rendered one at a time, so the rows are listed
// here by hand: the page id, the row title as it stands on the page, and extra words people may
// search for. A hit opens the page and points at the row with that title. The shortcuts come
// from their own table.
import { SHORTCUTS } from "../../state/shortcuts";
import { permissionTitle } from "../permission-copy";

export interface Entry {
  page: string;
  label: string;
  words?: string;
}

// Older entry points remain valid even though navigation now shows two combined pages.
export function canonicalSettingsPage(id: string): string {
  return id === "worktrees" ? "git" : id === "models" ? "providers" : id === "harness" ? "config" : id === "chat-personal" ? "personalization" : id;
}

export const ENTRIES: Entry[] = [
  { page: "general", label: "Språk", words: "language språk" },
  { page: "code", label: "Fargetema for kode", words: "lyst mørkt syntaks tema kodeutseende preview diff farger" },
  { page: "code", label: "Egen kodeskrift", words: "font skrift monospace egendefinert" },
  { page: "code", label: "Standard samtalevisning", words: "transkript normal tenkning detaljert verktøy trinn" },
  ...["config", "personalization"].flatMap((page) => [
    { page, label: "Lokal dato og tid", words: "kontekst context injection ukedag klokkeslett tidssone dato" },
    { page, label: "Modell og leverandør", words: "kontekst context modellnavn modell-id endepunkt provider" },
    { page, label: "Omtrentlig posisjon", words: "kontekst by land sted ip posisjon location" },
  ]),
  { page: "general", label: "Åpne appen i", words: "oppstart start modus chat kode standardmodus" },
  { page: "general", label: "Samtale ved oppstart", words: "blank tom ny samtale fortsett gjenoppta sist brukt start" },
  { page: "appearance", label: "Faner i sidepanelet", words: "felles topprad separate rader nettleser terminal verktøy tabs" },
  { page: "appearance", label: "Pluss i sidepanelet", words: "ny fane startside verktøy bare nettleser plus tabs" },
  { page: "general", label: "Spill av en lyd", words: "lyd ferdig tur varsel sound" },
  { page: "general", label: "Systemvarsel", words: "varsler notification ferdig tur fokus" },
  { page: "general", label: "Spør før fanen lukkes", words: "bekreft avslutt lukk quit" },
  { page: "general", label: "Enter i meldingsfeltet", words: "enter send ny linje ctrl shift linjeskift tast" },
  { page: "general", label: "Modell til autofullføring", words: "egen modell autocomplete tab forslag leverandør" },
  { page: "general", label: "Autofullfør meldinger med TAB", words: "autocomplete autofullføring ghost tekstforslag prompt tab modellkall" },
  { page: "general", label: "Vis tenkesammendrag", words: "tenkning resonnering thinking reasoning" },
  { page: "general", label: "Skallutdata utvidet", words: "shell terminal kommandoer verktøy utvid" },
  { page: "general", label: "Meldinger mens agenten jobber", words: "kø styr send med en gang steer queue melding tur" },
  { page: "general", get label() { return permissionTitle(); }, words: "kode tillatelser godkjenning full tilgang hjemmemappen" },
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
  { page: "code", label: "Kodeskrift", words: "monospace font skrift editor" },
  { page: "code", label: "Skriftstørrelse for kode", words: "kode font editor størrelse" },
  { page: "code", label: "Tabulatorbredde", words: "tab tabulator innrykk editor kode" },
  { page: "code", label: "Bryt lange linjer", words: "linjebryting wrap editor kode" },
  { page: "providers", label: "Standardmodell", words: "modell standard default" },
  { page: "providers", label: "Komprimering", words: "kontekst kontekstvindu compact komprimer automatisk autoCompact historikk sammendrag av på" },
  { page: "providers", label: "Steg per tur", words: "verktøykall grense maks tur maxsteps maxStepsPerTurn modellsteg" },
  { page: "providers", label: "Tilkoblede leverandører", words: "modeller per leverandør api-nøkkel nøkkel koble fra test tilkobling rediger modell hent modeller legg til modell" },
  { page: "providers", label: "Leverandørkatalog", words: "søk koble til inferens sky gateway lokal drift openrouter abliteration anthropic openai modell-id api nøkkel" },
  { page: "providers", label: "Lokale modellservere", words: "finn oppdag ollama lm studio lmstudio llama.cpp vllm localhost lan lokalnett openai-kompatibel verktøykall" },
  { page: "providers", label: "Modellanbefaling", words: "anbefal modell maskinvare ram gpu ledig minne" },
  { page: "providers", label: "Egendefinert oppsett", words: "openai-kompatibel anthropic adresse egen lokal modellserver" },
  { page: "git", label: "Grener og arbeidstrær", words: "git branch main gren bytt opprett arbeidstre worktree lokalt repo" },
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
  { page: "config", label: "Global settings.json", words: "settings.json konfigurasjon" },
  { page: "chat", label: "Personlighet", words: "svar tone personality personlighet stil standard profesjonell vennlig ærlig spesiell nerdete effektiv skeptisk varm entusiastisk overskrifter lister emoji mer mindre aktiv chat utkast" },
  { page: "personalization", label: "Minner på tvers av tråder", words: "minne memory husk remember av på" },
  { page: "personalization", label: "Lagrede minner", words: "minne memory søk endre slett alle legg til memory.md" },
  // Round 9b (SPEC 22): the harness, Chat's own personalisation, the memory upgrade and skill import.
  { page: "config", label: "Spør før store endringer", words: "harness grunn systemprompt store endringer spør først godkjenning" },
  { page: "config", label: "Kjør tester etter endringer", words: "harness verifisering test typesjekk bygg påminnelse" },
  { page: "config", label: "Grunn-harness", words: "kode-harness harness grunnregler" },
  { page: "config", label: "Global AGENTS.md", words: "instruksjoner alle prosjekter konfigurasjon harness agents.md gjenopprett standard tilbakestill sikkerhetskopi backup diff forskjell" },
  { page: "config", label: "Forhåndsvisning", words: "systemprompt lag tokens prompt harness identitet miljø" },
  { page: "personalization", label: "Systeminstruks", words: "chat-personalisering chat personalisering instruks system prompt egendefinert" },
  { page: "personalization", label: "Om deg", words: "chat personalisering om meg profil" },
  { page: "personalization", label: "Tone", words: "chat stil kort vennlig grundig formell uformell" },
  { page: "personalization", label: "Oppdater minnet av seg selv", words: "chat minne automatisk husk memory" },
  { page: "personalization", label: "Lagrede Chat-minner", words: "chat minner slett endre legg til" },
  { page: "personalization", label: "Foreslå opprydding av seg selv", words: "minneoppgradering rydd slå sammen duplikater utdaterte memory upgrade" },
  { page: "personalization", label: "Rydd i minnene nå", words: "minneoppgradering rydd slå sammen duplikater utdaterte forslag" },
  { page: "skills", label: "Når agenten foreslår en skill", words: "skills selvforbedring propose_skill spør auto av hermes" },
  { page: "skills", label: "Alle skills", words: "skill.md ny lag endre fjern slå av på mappe importer import mange filer dra slipp" },
  { page: "shortcuts", label: "Hurtigtaster", words: "taster tastatur snarveier keybindings" },
  ...SHORTCUTS.map((s) => ({ page: "shortcuts", label: s.label, words: "hurtigtast snarvei taster" })),
  { page: "mcp", label: "MCP-servere", words: "mcp verktøy tjenere servere github playwright model context protocol koble til" },
  { page: "mcp", label: "Legg til MCP-server", words: "mcp github playwright token stdio http npx egen server" },
  { page: "mcp", label: "Verktøy fra MCP-servere", words: "mcp verktøy av på grense godkjenning automatisk" },
  { page: "hooks", label: "Hooks", words: "skript hooks kommando før etter verktøykall pretooluse posttooluse userpromptsubmit stop formater varsel notify-send blokker" },
  { page: "hooks", label: "Ny hook", words: "hook lag legg til kommando bash eksempel" },
  { page: "browser", label: "Kjører headless", words: "chrome nettleser" },
  { page: "browser", label: "Playtest", words: "spill test" },
  { page: "browser", label: "Importer fra Chrome", words: "bokmerker historikk import chromium" },
  { page: "browser", label: "Informasjonskapsler", words: "cookies innlogget logg inn importer firefox chromium glem" }, // round 12
  { page: "browser", label: "Spør før agenter bruker innloggede nettsteder", words: "agent godkjenning cookies innlogget" }, // round 12
  { page: "providers", label: "Diktering", words: "mikrofon lyd tale til tekst transkripsjon whisper" },
  { page: "permissions", get label() { return permissionTitle(); }, words: "tillatelser spør godta redigeringer full tilgang godkjenning hjemmemappen" },
  { page: "permissions", label: "Prosjekter", words: "tillatelser per prosjekt" },
  { page: "archived", label: "Arkiverte tråder", words: "gjenopprett arkiv" },
  { page: "about", label: "Versjon", words: "om versjon byggnummer" },
];

const fold = (text: string) => text.toLocaleLowerCase(language()).normalize("NFC");

// Every word in the query must be found in the page name, the row title or the extra words.
// Hits in the title come first.
export function search(query: string, pageLabel: (id: string) => string): Entry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: Array<{ entry: Entry; score: number }> = [];
  for (const entry of ENTRIES) {
    const label = fold(lookupMessage(entry.label));
    const haystack = `${fold(pageLabel(entry.page))} ${label} ${fold(entry.label)} ${fold(entry.words ?? "")}`;
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
