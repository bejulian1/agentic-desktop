import { language, t } from "../../lib/i18n";
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
  { page: "general", get label() { return t("Språk"); }, get words() { return t("language språk"); } },
  { page: "general", get label() { return t("Velkomstskjerm"); } },
  { page: "general", get label() { return t("Importer fra andre kodeapper"); } },
  { page: "code", get label() { return t("Fargetema for kode"); }, get words() { return t("lyst mørkt syntaks tema kodeutseende preview diff farger"); } },
  { page: "code", get label() { return t("Egen kodeskrift"); }, get words() { return t("font skrift monospace egendefinert"); } },
  { page: "code", get label() { return t("Standard samtalevisning"); }, get words() { return t("transkript normal tenkning detaljert verktøy trinn"); } },
  ...["config", "personalization"].flatMap((page) => [
    { page, get label() { return t("Lokal dato og tid"); }, get words() { return t("kontekst context injection ukedag klokkeslett tidssone dato"); } },
    { page, get label() { return t("Modell og leverandør"); }, get words() { return t("kontekst context modellnavn modell-id endepunkt provider"); } },
    { page, get label() { return t("Omtrentlig posisjon"); }, get words() { return t("kontekst by land sted ip posisjon location"); } },
  ]),
  { page: "general", get label() { return t("Åpne appen i"); }, get words() { return t("oppstart start modus chat kode standardmodus"); } },
  { page: "general", get label() { return t("Samtale ved oppstart"); }, get words() { return t("blank tom ny samtale fortsett gjenoppta sist brukt start"); } },
  { page: "appearance", get label() { return t("Faner i sidepanelet"); }, get words() { return t("felles topprad separate rader nettleser terminal verktøy tabs"); } },
  { page: "appearance", get label() { return t("Pluss i sidepanelet"); }, get words() { return t("ny fane startside verktøy bare nettleser plus tabs"); } },
  { page: "general", get label() { return t("Trådvarsler"); }, get words() { return t("varsler lyd ferdig feil godkjenning svar notification sound"); } },
  { page: "general", get label() { return t("Varsler i appen"); }, get words() { return t("varsel toast annen tråd fokus in-app notification godkjenning"); } },
  { page: "general", get label() { return t("Spør før fanen lukkes"); }, get words() { return t("bekreft avslutt lukk quit"); } },
  { page: "general", get label() { return t("Enter i meldingsfeltet"); }, get words() { return t("enter send ny linje ctrl shift linjeskift tast"); } },
  { page: "general", get label() { return t("Modell til autofullføring"); }, get words() { return t("egen modell autocomplete tab forslag leverandør"); } },
  { page: "general", get label() { return t("Autofullfør meldinger med TAB"); }, get words() { return t("autocomplete autofullføring ghost tekstforslag prompt tab modellkall"); } },
  { page: "general", get label() { return t("Vis tenkesammendrag"); }, get words() { return t("tenkning resonnering thinking reasoning"); } },
  { page: "general", get label() { return t("Skallutdata utvidet"); }, get words() { return t("shell terminal kommandoer verktøy utvid"); } },
  { page: "general", get label() { return t("Meldinger mens agenten jobber"); }, get words() { return t("kø styr send med en gang steer queue melding tur"); } },
  { page: "general", get label() { return permissionTitle(); }, get words() { return t("kode tillatelser godkjenning full tilgang hjemmemappen"); } },
  { page: "code", get label() { return t("Kode uten prosjekt"); }, get words() { return t("startside hilsen prosjektkort hva skal vi bygge denne datamaskinen"); } },
  { page: "code", get label() { return t("Kode med prosjekt"); }, get words() { return t("startside hilsen prosjektkort miljø github hva skal vi jobbe med"); } },
  { page: "code", get label() { return t("Festet sammendrag"); }, get words() { return t("mål plan"); } },
  { page: "code", get label() { return t("Åpne agent-tråder i ny rute"); }, get words() { return t("rute vindu agent"); } },
  { page: "chat", get label() { return t("Forhåndsvis HTML i chatten"); }, get words() { return t("artifacts html sandkasse"); } },
  { page: "chat", get label() { return t("Prosjekter i Chat"); }, get words() { return t("prosjekt samle chatter mappe"); } },
  { page: "projects", get label() { return t("Prosjektikon"); }, get words() { return t("prosjekt ikon emoji monogram favicon bilde fil logo farge"); } },
  { page: "projects", get label() { return t("Fest prosjekt"); }, get words() { return t("prosjekt festet pin sidefane"); } },
  { page: "projects", get label() { return t("Utsjekkinger"); }, get words() { return t("prosjekt mappe sti bytt mappe folder gren checkout kildemappe"); } },
  { page: "projects", get label() { return t("Arkiver prosjekt"); }, get words() { return t("prosjekt arkiv arkiver skjul gjenopprett archive"); } },
  { page: "projects", get label() { return t("Handlinger"); }, get words() { return t("prosjekt handlinger prosjektskript skript kommando actions hurtigtast terminal"); } },
  { page: "projects", get label() { return t("Arbeidsområde"); }, get words() { return t("prosjekt nye tråder arbeidstre worktree gjeldende mappe"); } },
  { page: "projects", get label() { return t("Tenkeinnsats"); }, get words() { return t("prosjekt nye tråder tenkning innsats effort reasoning"); } },
  { page: "projects", get label() { return t("Standardmodell"); }, get words() { return t("prosjekt nye tråder modell"); } },
  { page: "projects", get label() { return t("Tillatelsesmodus"); }, get words() { return t("prosjekt tillatelser spør godta redigeringer full tilgang"); } },
  { page: "projects", get label() { return t("Agenttilgang til nettleseren"); }, get words() { return t("prosjekt nettleser agent tilgang"); } },
  { page: "projects", get label() { return t("Instruksjoner for prosjektet"); }, get words() { return t("prosjekt agents.md instruksjoner .agentic"); } },
  { page: "projects", get label() { return t("Fjern prosjektet"); }, get words() { return t("prosjekt slett fjern faresone"); } },
  { page: "appearance", get label() { return t("Tema"); }, get words() { return t("lys mørk system farge dark light"); } },
  { page: "appearance", get label() { return t("Fargetema"); }, get words() { return t("tema palett høy kontrast varm kald fjord solbleket farger arktisk sand"); } },
  { page: "appearance", get label() { return t("Aksentfarge"); }, get words() { return t("farge blå fiolett grønn oransje rosa rød grafitt accent"); } },
  { page: "appearance", get label() { return t("Appikon"); }, get words() { return t("ikon app-ikon favicon vindu statusfelt appbibliotek snakkeboble monogram terminal"); } },
  { page: "appearance", get label() { return t("Sidefane"); }, get words() { return t("standard smart sidefane lister kort"); } },
  { page: "appearance", get label() { return t("Prosjektrekkefølge"); }, get words() { return t("sidefane prosjekter sorter rekkefølge siste brukermelding sist opprettet navn alfabetisk kommandopalett"); } },
  { page: "appearance", get label() { return t("Trådgruppering"); }, get words() { return t("innboks og rydding innboks-liste etter prosjekt sidefane"); } },
  { page: "appearance", get label() { return t("Skjul tråder mens de jobber"); }, get words() { return t("innboks sidefane jobber kjører skjul"); } },
  { page: "appearance", get label() { return t("Ferdigstill automatisk ved inaktivitet"); }, get words() { return t("innboks arkiver gamle tråder dager timer"); } },
  { page: "appearance", get label() { return t("Ferdigstill automatisk når tilknyttet GitHub-PR lukkes eller flettes"); }, get words() { return t("innboks arkiver GitHub pull request PR lukket flettet"); } },
  { page: "appearance", get label() { return t("Vekk utsatte tråder ved ny aktivitet"); }, get words() { return t("innboks våkne utsett snooze hent tilbake"); } },
  { page: "appearance", get label() { return t("Panelknapper"); }, get words() { return t("toppfelt knapper samlet hver for seg panel terminal endringer nettleser filer"); } },
  { page: "appearance", get label() { return t("Sidepanel"); }, get words() { return t("panel startside verktøy faner fliser høyre panel"); } },
  { page: "appearance", get label() { return t("Tekststørrelse"); }, get words() { return t("skrift skriftstørrelse font størrelse zoom"); } },
  { page: "appearance", get label() { return t("Skrifttype for grensesnittet"); }, get words() { return t("typografi skrift font inter ubuntu noto skrifttype"); } },
  { page: "appearance", get label() { return t("Skrift for kode"); }, get words() { return t("typografi monospace kodeskrift font liberation jetbrains fira"); } },
  { page: "appearance", get label() { return t("Tetthet"); }, get words() { return t("kompakt luftig rader density"); } },
  { page: "appearance", get label() { return t("Reduser bevegelse"); }, get words() { return t("animasjoner overganger motion"); } },
  { page: "code", get label() { return t("Kodeskrift"); }, get words() { return t("monospace font skrift editor"); } },
  { page: "code", get label() { return t("Skriftstørrelse for kode"); }, get words() { return t("kode font editor størrelse"); } },
  { page: "code", get label() { return t("Tabulatorbredde"); }, get words() { return t("tab tabulator innrykk editor kode"); } },
  { page: "code", get label() { return t("Bryt lange linjer"); }, get words() { return t("linjebryting wrap editor kode"); } },
  { page: "providers", get label() { return t("Standardmodell"); }, get words() { return t("modell standard default"); } },
  { page: "providers", get label() { return t("Komprimering"); }, get words() { return t("kontekst kontekstvindu compact komprimer automatisk autoCompact historikk sammendrag av på"); } },
  { page: "providers", get label() { return t("Steg per tur"); }, get words() { return t("verktøykall grense maks tur maxsteps maxStepsPerTurn modellsteg"); } },
  { page: "providers", get label() { return t("Tilkoblede leverandører"); }, get words() { return t("modeller per leverandør api-nøkkel nøkkel koble fra test tilkobling rediger modell hent modeller legg til modell"); } },
  { page: "providers", get label() { return t("Leverandørkatalog"); }, get words() { return t("søk koble til inferens sky gateway lokal drift openrouter abliteration anthropic openai modell-id api nøkkel"); } },
  { page: "providers", get label() { return t("Lokale modellservere"); }, get words() { return t("finn oppdag ollama lm studio lmstudio llama.cpp vllm localhost lan lokalnett openai-kompatibel verktøykall"); } },
  { page: "providers", get label() { return t("Modellanbefaling"); }, get words() { return t("anbefal modell maskinvare ram gpu ledig minne"); } },
  { page: "providers", get label() { return t("Egendefinert oppsett"); }, get words() { return t("openai-kompatibel anthropic adresse egen lokal modellserver"); } },
  { page: "git", get label() { return t("Grener og arbeidstrær"); }, get words() { return t("git branch main gren bytt opprett arbeidstre worktree lokalt repo"); } },
  { page: "github", get label() { return t("Åpne pull request-lenker i Agentic Desktop"); } },
  { page: "github", get label() { return t("Konto"); }, get words() { return t("github token tilgangstoken personlig pull request issues koble til gh cli"); } },
  { page: "usage", get label() { return t("Bruk"); }, get words() { return t("tokens profil navn"); } },
  { page: "usage", get label() { return t("Statistikk"); }, get words() { return t("statistikk tokens økter meldinger rekke aktivitet aktivitetskart startside"); } },
  { page: "usage", get label() { return t("Kostnad"); }, get words() { return t("kostnad pris dollar"); } },
  { page: "storage", get label() { return t("Fordeling"); }, get words() { return t("lagring plass disk størrelse database bilder nettleser storage"); } },
  { page: "storage", get label() { return t("Rydd opp"); }, get words() { return t("lagring slett buffer cache foreldreløse komprimer vacuum logger arkiverte"); } },
  { page: "storage", get label() { return t("Datamappe"); }, get words() { return t("lagring sti mappe nedlastinger"); } },
  { page: "privacy", get label() { return t("Telemetri"); }, get words() { return t("personvern data sporing"); } },
  { page: "privacy", get label() { return t("Nettverk"); }, get words() { return t("personvern localhost"); } },
  { page: "privacy", get label() { return t("API-nøkler og GitHub-token"); }, get words() { return t("nøkler nøkkelring keyring keys.json kryptert passord"); } },
  { page: "privacy", get label() { return t("Arkiverte tråder"); }, get words() { return t("slett data historikk"); } },
  { page: "config", get label() { return t("Global settings.json"); }, get words() { return t("settings.json konfigurasjon"); } },
  { page: "chat", get label() { return t("Personlighet"); }, get words() { return t("svar tone personality personlighet stil standard profesjonell vennlig ærlig spesiell nerdete effektiv skeptisk varm entusiastisk overskrifter lister emoji mer mindre aktiv chat utkast"); } },
  { page: "personalization", get label() { return t("Minner på tvers av tråder"); }, get words() { return t("minne memory husk remember av på"); } },
  { page: "personalization", get label() { return t("Lagrede minner"); }, get words() { return t("minne memory søk endre slett alle legg til memory.md"); } },
  // Round 9b (SPEC 22): the harness, Chat's own personalisation, the memory upgrade and skill import.
  { page: "config", get label() { return t("Spør før store endringer"); }, get words() { return t("harness grunn systemprompt store endringer spør først godkjenning"); } },
  { page: "config", get label() { return t("Kjør tester etter endringer"); }, get words() { return t("harness verifisering test typesjekk bygg påminnelse"); } },
  { page: "config", get label() { return t("Grunn-harness"); }, get words() { return t("kode-harness harness grunnregler"); } },
  { page: "config", get label() { return t("Global AGENTS.md"); }, get words() { return t("instruksjoner alle prosjekter konfigurasjon harness agents.md gjenopprett standard tilbakestill sikkerhetskopi backup diff forskjell"); } },
  { page: "config", get label() { return t("Forhåndsvisning"); }, get words() { return t("systemprompt lag tokens prompt harness identitet miljø"); } },
  { page: "personalization", get label() { return t("Systeminstruks"); }, get words() { return t("chat-personalisering chat personalisering instruks system prompt egendefinert"); } },
  { page: "personalization", get label() { return t("Om deg"); }, get words() { return t("chat personalisering om meg profil"); } },
  { page: "personalization", get label() { return t("Tone"); }, get words() { return t("chat stil kort vennlig grundig formell uformell"); } },
  { page: "personalization", get label() { return t("Oppdater minnet av seg selv"); }, get words() { return t("chat minne automatisk husk memory"); } },
  { page: "personalization", get label() { return t("Lagrede Chat-minner"); }, get words() { return t("chat minner slett endre legg til"); } },
  { page: "personalization", get label() { return t("Foreslå opprydding av seg selv"); }, get words() { return t("minneoppgradering rydd slå sammen duplikater utdaterte memory upgrade"); } },
  { page: "personalization", get label() { return t("Rydd i minnene nå"); }, get words() { return t("minneoppgradering rydd slå sammen duplikater utdaterte forslag"); } },
  { page: "skills", get label() { return t("Når agenten foreslår en skill"); }, get words() { return t("skills selvforbedring propose_skill spør auto av hermes"); } },
  { page: "skills", get label() { return t("Alle skills"); }, get words() { return t("skill.md ny lag endre fjern slå av på mappe importer import mange filer dra slipp"); } },
  { page: "shortcuts", get label() { return t("Hurtigtaster"); }, get words() { return t("taster tastatur snarveier keybindings"); } },
  ...SHORTCUTS.map((s) => ({ page: "shortcuts", get label() { return s.label; }, get words() { return t("hurtigtast snarvei taster"); } })),
  { page: "mcp", get label() { return t("MCP-servere"); }, get words() { return t("mcp verktøy tjenere servere github playwright model context protocol koble til"); } },
  { page: "mcp", get label() { return t("Legg til MCP-server"); }, get words() { return t("mcp github playwright token stdio http npx egen server"); } },
  { page: "mcp", get label() { return t("Verktøy fra MCP-servere"); }, get words() { return t("mcp verktøy av på grense godkjenning automatisk"); } },
  { page: "hooks", get label() { return t("Hooks"); }, get words() { return t("skript hooks kommando før etter verktøykall pretooluse posttooluse userpromptsubmit stop formater varsel notify-send blokker"); } },
  { page: "hooks", get label() { return t("Ny hook"); }, get words() { return t("hook lag legg til kommando bash eksempel"); } },
  { page: "diffs", get label() { return t("Diff-oppsett"); }, get words() { return t("diff differ endringer stablet side ved side stacked split layout"); } },
  { page: "diffs", get label() { return t("Skjul mellomromsendringer"); }, get words() { return t("diff differ mellomrom innrykk whitespace endringer"); } },
  { page: "diffs", get label() { return t("Standard filvisning"); }, get words() { return t("diff differ filer utvidet sammenslått expanded collapsed"); } },
  { page: "diffs", get label() { return t("Diff-farger"); }, get words() { return t("diff differ farger rød grønn blå oransje fargeblind tillegg slettinger"); } },
  { page: "browser", get label() { return t("Agenttilgang til nettleseren"); }, get words() { return t("nettleser agent tilgang delt nettleser prosjekt"); } },
  { page: "browser", get label() { return t("Åpne lenker i"); }, get words() { return t("lenker links standardnettleser nettleser chat terminal ctrl cmd"); } },
  { page: "browser", get label() { return t("Søkemotor"); }, get words() { return t("søk søkeside nettsøk duckduckgo google bing brave kagi ecosia egendefinert adressefelt"); } },
  { page: "browser", get label() { return t("Standard nettleserzoom"); }, get words() { return t("nettleser zoom forstørrelse avansert standard"); } },
  { page: "browser", get label() { return t("Standard utseende i nettleseren"); }, get words() { return t("nettleser utseende tema lys mørk system prefers-color-scheme avansert"); } },
  { page: "browser", get label() { return t("Kjører headless"); }, get words() { return t("chrome nettleser"); } },
  { page: "browser", get label() { return t("Playtest"); }, get words() { return t("spill test"); } },
  { page: "browser", get label() { return t("Importer fra Chrome"); }, get words() { return t("bokmerker historikk import chromium"); } },
  { page: "browser", get label() { return t("Informasjonskapsler"); }, get words() { return t("cookies innlogget logg inn importer firefox chromium glem"); } }, // round 12
  { page: "browser", get label() { return t("Spør før agenter bruker innloggede nettsteder"); }, get words() { return t("agent godkjenning cookies innlogget"); } }, // round 12
  { page: "providers", get label() { return t("Diktering"); }, get words() { return t("mikrofon lyd tale til tekst transkripsjon whisper"); } },
  { page: "permissions", get label() { return permissionTitle(); }, get words() { return t("tillatelser spør godta redigeringer full tilgang godkjenning hjemmemappen"); } },
  { page: "permissions", get label() { return t("Prosjekter"); }, get words() { return t("tillatelser per prosjekt"); } },
  { page: "archived", get label() { return t("Arkiverte tråder"); }, get words() { return t("gjenopprett arkiv"); } },
  { page: "about", get label() { return t("Versjon"); }, get words() { return t("om versjon byggnummer"); } },
];

const fold = (text: string) => text.toLocaleLowerCase(language()).normalize("NFC");

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
