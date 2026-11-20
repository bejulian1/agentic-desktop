# Agentic Desktop: spesifikasjon for localhost-demoen

Dette er fasiten for byggingen. Bakgrunn og kilder ligger i `research/standardfunksjoner.md`.

## 1. Hva appen er

En åpen wrapper rundt modell-API-er. Brukeren velger en mappe, snakker med en modell, og modellen lager kodefiler der og kan playteste dem. Vi finner ikke opp noe nytt: vi setter sammen det som fungerer i Claude Code/Claude desktop, Codex og T3 Code. Det skal føles kjent.

All tekst i UI-et er på norsk.

## 2. Stack og mappestruktur

Språk er TypeScript i ES-moduler. Node 26 er installert. Bruk npm workspaces, ikke pnpm eller bun.

```
agentic-desktop/
  package.json        workspaces: server, web
  version.json        { "version": "0.1.0", "build": 1 }
  shared/protocol.ts  felles typer, eneste kontrakt mellom server og web
  server/             Node-server, agentmotor, verktøy
  web/                Vite + Solid + CodeMirror 6 + xterm.js
  docs/  research/
```

- **Server:** `node:http` + `ws`, `node:sqlite` (innebygd), `node-pty`, `playwright-core`. Hvis `node-pty` ikke bygger på Node 26, finn en vedlikeholdt fork eller en annen løsning, og dokumenter valget.
- **Nettleser:** `playwright-core` med `channel: "chrome"`. Chrome 153 er installert. Ikke last ned Playwrights egne nettlesere.
- **Avhengigheter:** Få og vedlikeholdte. Hvert bibliotek må fortjene plassen sin.

Appdata ligger i `$AD_DATA_DIR`, ellers `~/.local/share/agentic-desktop`. Der ligger SQLite-basen, token-filen og Chrome-profilen. Filer som inneholder hemmeligheter skal ha rettighet 0600.

`npm start` bygger om nødvendig, starter på `127.0.0.1:4317` (eller `$AD_PORT`, `0` gir tilfeldig ledig port), skriver ut lenken og åpner den i standardnettleseren. `--no-open` hindrer åpning, og alle tester skal bruke det.

## 3. Grensesnitt

Tre kolonner, som Claude desktop:

- **Toppstripe:** To tydelige knapper, **Chat** og **Kode**, midt i eller øverst til venstre. Valgt modus styrer hva innholdsflaten viser.
- **Venstre sidefane:** Prosjekter med tråder under, sortert på sist brukt. Ny tråd, gi nytt navn, arkiver, søk. Tråder uten prosjekt ligger under "Chatter". Innstillinger nederst.
- **Midten:** Samtalen og meldingsfeltet med modellvelger.
- **Høyre panel (bare i Kode):** Faner for **Filer**, **Endringer**, **Terminal** og **Nettleser**. Lastes først når de åpnes. Panelet kan skjules og endres i bredde.
- **Kode-toppstripe:** Prosjektnavn og sti, **Åpne i VS Code**, og **Playtest**.
- **Statuslinje:** Tilkobling, kontekstbruk, tokens, kostnad, og versjon med byggnummer.

### Chat-modus

Vanlig samtale uten verktøy og uten prosjekt.

### Kode-modus

Krever et prosjekt, altså en mappe brukeren velger. Modellen får verktøyene. I samtalen vises:

- **Tenkesammendrag:** En sammenfoldet rad, "Tenker…" under kjøring og "Tenkte i 12 s" etterpå, som kan åpnes.
- **Kommandobruk:** Hvert verktøykall er en sammenfoldet rad med ikon, navn og kort sammendrag, for eksempel `npm test` eller `src/app.ts +12 -3`. Den viser status og utdata live.
- **Godkjenningskort:** Kommando eller endring, med **Tillat**, **Tillat alltid** og **Avslå**.
- **Stopp:** Avbryter kjøringen når som helst. Melding sendt under kjøring legges i kø.

### Innstillinger

- Tema: **Lys**, **Mørk**, **System**. System følger `prefers-color-scheme` live. Valget gjelder med en gang, uten blink ved oppstart.
- Modeller og leverandører: legg til, rediger, slett, test tilkobling.
- Tillatelsesmodus: Spør, Godta redigeringer, Full tilgang.
- Om: **Agentic Desktop**, versjon, byggnummer, byggdato, kopier info, og nederst signaturen **Code Pro**.

Design: rolig, flatt og nøytralt, med én aksentfarge. Ikke blur, tunge skygger eller pyntanimasjoner. Bruk systemets font-stack, og monospace til kode. Mørkt og lyst tema defineres som CSS-variabler.

## 4. Modeller

Tre leverandørtyper i `server/src/providers/`:

- **`openai-compatible`:** `baseUrl` + nøkkel + modell. Dekker OpenRouter, OpenAI, Ollama, LM Studio, Groq og andre. Les `reasoning`, `reasoning_content` og lignende felter som tenkning. Støtt verktøykall i strømmen.
- **`anthropic`:** Messages API med strømming, verktøy og tenkesammendrag.
- **`mock`:** Demo-modell uten nettverk, se under.

Nøkler: Leses fra `apiKeyEnv` eller lagres i en 0600-fil i datamappen. De sendes aldri tilbake til UI-et, som bare får vite om en nøkkel er satt. Nøkler skal aldri i logger eller hendelser.

Prisen per million tokens kan settes per modell. Kostnad vises bare når pris er satt, ellers vises tokens alene.

### Demo-modellen

Det er ingen API-nøkler på maskinen, så `mock` må gjøre hele appen testbar. Den er forhåndsvalgt når ingen annen modell er satt opp, og tydelig merket "Demo-modell (uten API)".

Den er et deterministisk skript som går gjennom den ekte agent-løkka og de ekte verktøyene. Ingen snarveier forbi tillatelser eller hendelser. Når brukeren ber den lage noe, strømmer den tenkning, skriver `index.html` til prosjektmappen, kjører en kommando, åpner siden i nettleserverktøyet, tar et øyeblikksbilde og strømmer et svar. I Chat-modus svarer den med strømmet Markdown, inkludert kodeblokker. Den skal også kunne utløse et godkjenningskort og en lang strøm for ytelsestest.

## 5. Agentmotor

Løkka: modellen strømmer, verktøy kjøres, resultater går tilbake, til modellen er ferdig eller brukeren stopper. Grense på 50 steg per kjøring.

**Verktøy i Kode-modus:** `read_file`, `write_file`, `edit_file` (eksakt erstatning), `list_dir`, `search` (ripgrep), `run_command`, `browser_navigate`, `browser_snapshot` (tilgjengelighetstre), `browser_click`, `browser_type`, `browser_screenshot`, `browser_console`.

- Alle filstier skal holde seg innenfor prosjektmappen etter `realpath`, så symlenker ikke kan føre ut av den.
- `run_command` kjører med prosjektmappen som cwd, har tidsavbrudd, strømmer utdata og kan avbrytes med hele prosessgruppen.
- Miljøet til barneprosesser skal ikke inneholde API-nøkler, sesjonstoken eller `AD_*`.

**Tillatelser:**

| Modus | Lesing og søk | Filendring | Kommandoer og nettleser |
|---|---|---|---|
| Spør | Tillatt | Spør | Spør |
| Godta redigeringer | Tillatt | Tillatt | Spør |
| Full tilgang | Tillatt | Tillatt | Tillatt |

"Tillat alltid" lagres per prosjekt, som nøyaktig kommando eller verktøy. `.env*` og `.git/hooks` krever alltid godkjenning, også i Full tilgang. Hvis samme verktøykall med samme input gjentas tre ganger på rad, spør appen brukeren.

**Kontekst:** Les `AGENTS.md` eller `CLAUDE.md` fra prosjektet. Når konteksten nærmer seg grensen, komprimeres eldre verktøyresultater først, så oppsummeres eldre meldinger med modellen. Vis det som en rad i samtalen.

**Endringer:** Filverktøyene lagrer innhold før og etter per tur. Panelet Endringer viser diff per tur, og **Angre tur** tilbakestiller filene. Endringer gjort av kommandoer fanges ikke, og UI-et skal si det.

**Parallelle tråder:** Flere tråder kan kjøre samtidig. Kjøringer er knyttet til tråd, ikke global tilstand.

**Lagring:** SQLite med WAL. Hver tråd har en sekvensnummerert hendelseslogg. Tekstdeltaer slås sammen før lagring. Etter krasj eller omstart merkes kjøringer som var aktive som avbrutt, og tråden kan fortsette. Avbrutte verktøykall kjøres ikke på nytt.

## 6. Paneler

- **Filer:** Tre over prosjektmappen, som respekterer `.gitignore` og skjuler `node_modules` og `.git`. Fil åpnes skrivebeskyttet i CodeMirror. Oppdateres når agenten endrer filer.
- **Terminal:** xterm.js med WebGL-renderer og fallback hvis konteksten mistes. Ekte PTY i prosjektmappen. Flere faner. Skal overleve panelbytte og sidelast.
- **Nettleser:** Ekte Chrome styrt av Playwright, headless, med egen profil. Panelet viser CDP-skjermstrøm (`Page.startScreencast`) på et canvas og sender mus, tastatur og scroll tilbake. Adressefelt, tilbake, frem og last på nytt. Brukeren og agenten ser **samme** side. Chrome startes først ved første bruk, og lukkes når ingen tråd har brukt den på en stund.
- **Playtest:** Hvis prosjektet har `dev` eller `start` i `package.json`, startes det som egen tjeneste med utdata i terminalfanen, og nettleserpanelet åpner adressen. Ellers serveres `index.html` statisk. Forhåndsvisning skal alltid ha en **annen port** enn appen, altså en annen origin.
- **Åpne i VS Code:** Starter `code <prosjektmappe>`, frakoblet serveren. Viser feilmelding hvis `code` mangler.

## 7. Sikkerhet

Serveren kan kjøre kommandoer, så en feil her er det alvorligste appen kan ha. Dette skal være på plass før `run_command` virker, og hvert punkt skal ha en automatisk test:

1. Bind bare til `127.0.0.1`.
2. Tilfeldig token per kjøring, 32 byte. Skriv det til en 0600-fil og legg det i URL-fragmentet. UI-et fjerner det fra adressen med en gang.
3. Tokenet veksles inn i en `HttpOnly`, `SameSite=Strict`-cookie. WebSocket bruker en kortvarig engangsbillett.
4. Host-sjekk: avvis alt som ikke er nøyaktig `127.0.0.1:<port>` eller `localhost:<port>`.
5. Origin-sjekk med eksakt liste på alle tilstandsendrende kall og på WebSocket-upgrade, før upgrade håndteres.
6. Ingen CORS-headere.
7. Streng CSP, ingen inline-skript. Markdown renses og rå HTML vises aldri som HTML. Agentutdata og nettsider er upålitelig innhold.
8. Tokenet er aldri tilgjengelig for agent, terminal eller barneprosesser.
9. All stihåndtering i API-et går gjennom samme kontroll som agentverktøyene.

## 8. Ytelse

Maskinen har 240 Hz-skjerm, og brukeren merker lagg. Det er 4,17 ms per bilde, så dette er krav fra første commit:

- Scrolling skjer på kompositortråden. Vanlig `overflow`-scrolling, passive lyttere, ingen JS-drevet scrolling eller `scroll-behavior: smooth`.
- Meldingsradene skal **ikke** ha `contain` eller `content-visibility`. Målinger i november 2026 (`docs/perf/rendering.md`) viste at det halverte tiden hovedtråden var opptatt under scrolling når de ble fjernet. `content-visibility: auto` ligger bare på lange markdown-biter (`.md-segment`). Bruk full virtualisering bare hvis målinger viser at det trengs.
- Tokens samles og flushes maks én gang per bilde, og oppdaterer bare siste blokk. Markdown lexes trinnvis, så strømming ikke parser hele meldingen på nytt. Kostnaden skal ikke vokse med samtalelengden.
- Solid-signaler med små abonnementer. Ingen global omrendring per token.
- Syntaksutheving i Web Worker, bare for synlige blokker.
- Én delt ResizeObserver. Ingen polling når appen er i ro.
- CodeMirror, xterm, screencast og Chrome lastes bare når de brukes. Lukkede paneler frigjør minne.
- Trådbytte skal vise innhold på første bilde. Ingen spinner for lokale data.

**Måleverktøy:** `npm run perf` skal lage en tråd med 5 000 meldinger med Markdown og kode, og måle scrolling, trådbytte og strømming headless. Mål rapporteres som p50, p99 og verste bilde. Verktøyet skal selv testes mot en side med kjent resultat, for Hermes sitt måleverktøy løy. Skriv resultatet til `docs/perf-latest.md`.

## 9. Versjon og bygg

`version.json` er kilden. Byggskriptet øker `build` med 1 per produksjonsbygg og legger inn byggdato i UI-et. Vises i statuslinjen som `v0.1.0 (build 12)` og i Innstillinger → Om med byggdato og Code Pro.

## 10. Utenfor denne demoen

MCP, worktrees, skjulte subagenter, hooks, linjekommentarer i diff, OS-sandkasse, Electron-pakking og nøkkelring. Datamodellen skal ikke gjøre disse vanskelige senere, men de skal ikke bygges nå.

## 11. Regler for arbeidet

- Bare skriv inne i `agentic-desktop/`, midlertidige mapper og `$AD_DATA_DIR`. Tester skal alltid bruke en midlertidig `AD_DATA_DIR`, så brukerens data ikke røres.
- Ikke åpne vinduer på brukerens skrivebord. All testing skjer headless, og alle tester bruker `--no-open`.
- Ikke kjør `git init`, ikke commit, og ikke installer noe globalt eller med sudo.
- Ingen ekte API-nøkler eller betalte API-kall. Bruk `mock` og lokale testservere.
- Rydd opp alle prosesser du starter, også når en test feiler. Stopp bare prosesser du selv har startet, og finn dem med PID, ikke med navn, for brukeren har andre Electron- og Chrome-apper i gang.
- Rapporter det som faktisk ble testet. Det som ikke virker, skal stå i `docs/STATUS.md`.

## 12. Tillegg: kommandoer, flere ruter og samarbeid

Brukeren la til dette etter første utkast. Det hører med i demoen. Inspirasjon: Hermes Agent for kommandoer og skills, BridgeMind for flere instanser side om side.

### 12.1 Meldingsfeltet: `/`, `@` og `!`

Skriver du et av tegnene først i et ord, åpnes en meny som filtreres mens du skriver. Piltaster og Enter velger. Menyen skal åpne på neste bilde.

- **`/` kommandoer og skills:** Innebygde kommandoer er `/ny`, `/modus`, `/modell`, `/komprimer`, `/angre`, `/playtest`, `/vscode` og `/hjelp`. Hver skill blir automatisk sin egen `/kommando`, som hos Hermes.
- **`@` kontekst:** Filer og mapper i prosjektet, og andre tråder i prosjektet. Valget vises som en brikke. Filinnhold legges ved meldingen, og en tråd legges ved som kort utdrag av de siste svarene.
- **`!` kommando direkte:** `!npm test` kjører kommandoen i prosjektmappen og legger utdataene i samtalen. Den går gjennom vanlige tillatelser.

**Skills** er mapper med en `SKILL.md` med frontmatter for `name` og `description`. De leses fra `.agentic/skills/` i prosjektet og `~/.config/agentic-desktop/skills/`, og for kompatibilitet fra `.claude/skills/` og `.agents/skills/`. Bare navn og beskrivelse lastes på forhånd. Hele innholdet legges til først når skillen brukes, enten av brukeren med `/navn` eller av modellen med verktøyet `use_skill`. Prosjektets skills går foran brukerens ved navnekollisjon. Skills er upålitelig innhold og gir ingen ekstra rettigheter.

### 12.2 Flere ruter

Midtflaten er et rutenett der hver rute er en egen samtale med eget meldingsfelt, egen scrolling og egen modell. Dette er chat-instanser, ikke terminaler.

- Ny rute med knapp eller delt visning til høyre og nedover. Opptil 6 ruter i et vindu.
- Dra en tråd fra sidefanen inn i en rute, eller dra en rutes tittellinje for å bytte plass og dele.
- **Dra ut:** Ved å slippe en rute utenfor vinduet, eller med knappen **Løsriv**, åpnes den i et eget nettleservindu som kan flyttes fritt. Når vinduet lukkes, kan ruten hentes tilbake.
- Flere vinduer av appen er likeverdige og holdes i sync av samme server.
- Oppsettet lagres per prosjekt og kommer tilbake etter omstart.
- Høyre panel følger ruten som har fokus. Fokusert rute er tydelig markert.
- Ruter ytelse: Hver rute abonnerer bare på sin egen tråd. Ti tråder som strømmer samtidig, skal ikke gjøre scrolling i en annen rute tregere.

### 12.3 Tråder som samarbeider

Tråder i samme prosjekt kan se og snakke med hverandre. Dette er synlige tråder brukeren kan åpne og overta, ikke skjulte subagenter. Verktøy i Kode-modus:

| Verktøy | Hva det gjør |
|---|---|
| `thread_list` | Lister tråder i prosjektet med tittel og status |
| `thread_create` | Lager en ny tråd med tittel, oppdrag og valgfri modell, og starter den |
| `thread_send` | Sender melding til en annen tråd, i kø hvis den jobber |
| `thread_read` | Leser de siste meldingene i en tråd, uten verktøydetaljer |
| `thread_wait` | Venter til en tråd er ferdig og returnerer sluttsvaret, med tidsavbrudd |

- Meldinger mellom tråder merkes med avsender i samtalen, og sidefanen viser hvem som lagde hvilken tråd.
- Tråder laget av en agent kan åpnes automatisk i en ny rute. Dette er en innstilling, på som standard.
- `thread_create` og `thread_send` behandles som kommandoer i tillatelsestabellen.

**Bremser:** Disse er obligatoriske, for samarbeid kan ellers løpe løpsk og bli dyrt:

- Maks dybde 2, altså at en tråd laget av en agent kan lage én ny, men ikke mer.
- Maks 4 agent-startede tråder som kjører samtidig per prosjekt.
- Maks 20 meldinger mellom tråder per brukermelding. Deretter stopper appen og spør.
- En tråd får aldri høyere tillatelsesmodus enn den som lagde den.
- Godkjenninger vises i tråden de hører til, med et merke i sidefanen.
- **Stopp alt** i prosjektet stopper alle tråder med én knapp.
- Statuslinjen viser samlet kostnad og tokens for prosjektet.

**Filkonflikter:** Tråder deler prosjektmappen. `write_file` på en eksisterende fil krever at tråden har lest den, og at filen ikke er endret siden. `edit_file` feiler tydelig hvis teksten ikke lenger finnes. Skrivinger til samme fil skjer etter tur.

Demo-modellen skal kunne vise samarbeid: ved ordet `samarbeid` lager den en hjelpetråd, venter på den og oppsummerer resultatet.

## 13. Ønskelisten: funksjoner som demo

Brukerens ønskeliste ligger urørt i `docs/ONSKELISTE.md`. Denne delen sier hvordan den tolkes og i hvilken rekkefølge den bygges. Ved konflikt med tidligere deler gjelder denne.

### 13.1 Ny strategi

Localhost-versjonen beholdes lenge. Nå gjelder **mye produksjon først, rydding og optimalisering etterpå**:

- Bygg bredt og raskt. Det skal se ut og føles som en moderne agentapp i stil med Claude Code- og Codex-appen, ikke som ChatGPT fra 2022. Brukeren synes utseendet er det svakeste nå.
- Mange funksjoner kan være **demo-plassholdere**: synlige i grensesnittet, med et lite merke **Demo** og en kort forklaring av hva funksjonen skal gjøre når den er ferdig. En plassholder skal aldri late som den gjorde noe den ikke gjorde.
- Gjør det ekte når det er billig. Bruk demo-modellen til å vise flyten der det passer.
- Ytelseskravene i del 8 måles ikke for hver ny ting. Ikke bryt prinsippene der heller, så ryddefasen blir enkel.
- Sikkerhetskravene i del 7 og arbeidsreglene i del 11 gjelder fullt ut.
- Funksjoner som passer i Chat-modus, skal også virke der, for eksempel `/model`, `/reasoning`, `/status`, `/fork`, `/side`, `$skills`, festet sammendrag og innstillinger.

### 13.2 Rekkefølge

Bygg i runder, enkleste først. Hver runde skal ende med grønne tester og en oppføring i `docs/PATCHLOG.md`.

**Runde 1: rammen rundt vinduet og meldingsfeltet**

- Øverst til venstre: knapper for **tilbake** og **frem** i trådhistorikken, en knapp som viser og skjuler sidefanen, og en menylinje med **Fil**, **Rediger**, **Vis** og **Hjelp**. Menyene har ekte handlinger der de finnes, som ny tråd, åpne mappe, innstillinger, tema, paneler, hurtigtaster og Om.
- Sidefanen får en **(+)**-knapp øverst for ny tråd, og en bryter for **festet sammendrag**: en boks øverst i samtalen som viser målet (`/goal`), planen og et kort sammendrag av tråden.
- Alle kommandoene i ønskelisten blir `/kommandoer` med de engelske navnene derfra. De norske fra del 12.1 beholdes som alias, for eksempel `/modell` for `/model`. Ekte der det er billig: `/model`, `/reasoning`, `/status`, `/compact`, `/fork`, `/goal`, `/plan`, `/init` (lager en `AGENTS.md`-mal), `/project`, `/task`, `/side` og `/personality`. De andre er plassholdere i denne runden: `/approve`, `/ide-context`, `/local`, `/mcp`, `/memories`, `/review` og `/worktree`.
- `$` åpner skills i meldingsfeltet, i tillegg til `/navn`. `@` for filer og `!` for kommandoer er som før.

**Runde 2: innstillinger og modeller**

- Innstillinger deles i kategorier: **Generelt og utseende** (tema, vindusoppførsel, og *Alltid øverst* som plassholder til Electron), **Modeller**, **Profil** (profilkort, tokens totalt, toppdag, rekke med dager i bruk og bruk per modell, regnet ut fra databasen), **Personalisering og minner** (rediger global `AGENTS.md`, bryter for minner), **Hurtigtaster** (se og endre), **Tillatelser** og **Om**.
- **Leverandør med bare API-nøkkel:** En liste med ferdig utfylte leverandører: OpenAI, Anthropic, OpenRouter, Google Gemini (OpenAI-kompatibel adresse), DeepSeek, xAI, Mistral og Groq, i tillegg til egendefinert og lokale Ollama og LM Studio. Brukeren velger leverandør og limer inn nøkkelen. Appen henter modellene fra `/models` og lar brukeren krysse av. Kontekstvindu hentes fra svaret når det finnes, ellers fra en liten innebygd tabell, ellers et trygt standardtall som kan endres. Adressene skal sjekkes mot leverandørens egen dokumentasjon, og det som ikke er sjekket, merkes i koden. Testes bare mot lokale falske servere.

**Runde 3: prosjekter og instanser**

- **To hovedmapper:** En global mappe `$XDG_CONFIG_HOME/agentic-desktop/` (standard `~/.config/agentic-desktop/`) med `AGENTS.md`, `settings.json` og `skills/`, og en prosjektmappe `.agentic/` i roten av hvert prosjekt med `AGENTS.md`, `settings.json` og `skills/`. Prosjektet går foran det globale. Tester setter `XDG_CONFIG_HOME` til en midlertidig mappe.
- Velger du en mappe, kommer prosjektet opp i sidefanen. Hvert prosjekt har en **(+)** for ny instans i prosjektet, og en meny med **Prosjektinnstillinger**: navn, farge eller ikon, standardmodell, tillatelsesmodus og instruksjoner. Der kan du også **bytte prosjektmappe**.
- Instanser laget av en annen instans vises som et tre under den som lagde dem, så koblingen til hovedinstansen synes. Samarbeidsverktøyene fra del 12.3 er motoren.

**Runde 4: de store, som plassholdere med demo-flyt**

- **Filer og endringer med kodegjennomgang:** En **Gjennomgå**-knapp i Endringer og `/review`. Demo-modellen kan svare med en gjennomgang av diffen.
- **Parallelle instanser:** Bakgrunnsinstanser med tydelig status i sidefanen, `/worktree` som plassholder (ingen git-kommandoer i denne runden), og **Agent Teams**: en teamleder-tråd og en delt oppgaveliste som vises i et panel. Demo-modellen viser flyten ved ordet `team`.
- **Tilpasning:** Bredden på sidefanen og høyre panel kan dras, og huskes. Dette finnes delvis, så sjekk og fullfør.

### 13.3 Grenser for denne runden

- Ingenting lastes ned eller installeres utenfor `node_modules` i prosjektet. Nye npm-pakker bare når det sparer mye arbeid, og de skal stå i `docs/STATUS.md`.
- Ingen ekte MCP-tilkoblinger, git-kommandoer, spill eller skrivebordsstyring.
- Ikke skriv til brukerens ekte `~/.config/agentic-desktop/` eller `~/.local/share/agentic-desktop/` fra tester eller manuelle prøver.

## 14. Artifacts, versjon 1

Brukeren vil ha et eget rom for små HTML-programmer i én fil, med forhåndsvisning, slik claude.ai har det. Dette er første versjon, og finpuss kommer senere.

### 14.1 Sidefanen

Rekkefølgen øverst i sidefanen blir: Ny tråd, søk, **Artifacts**, **Festede prosjekter**, Prosjekter og Chatter.

- **Artifacts** er en egen rad med antall. Den åpner Artifacts-rommet i midtflaten.
- **Festede prosjekter:** Prosjekter kan festes og løsnes fra prosjektmenyen. Festede prosjekter vises i egen seksjon rett under Artifacts, og vises ikke to ganger. Seksjonen skjules når ingenting er festet.

### 14.2 Artifacts-rommet

- Et galleri med kort som viser tittel, dato, tråden artifacten kom fra og et lite forhåndsbilde eller ikon. Søk og sortering på sist endret.
- Åpner du en artifact, ser du koden i CodeMirror (HTML-utheving, kan redigeres) og en live forhåndsvisning ved siden av, med delt visning, bare kode eller bare forhåndsvisning. Forhåndsvisningen oppdateres når du lagrer, og når du trykker **Kjør på nytt**.
- Knapper: **Ny artifact**, **Gi nytt navn**, **Dupliser**, **Last ned .html**, **Åpne i Nettleser-panelet** og **Slett** med bekreftelse.
- Lagring i SQLite med tittel, HTML, tråd og melding den kom fra, og tidspunktene `created` og `updated`. Én enkel tidligere versjon er nok i v1.
- Artifacts er globale, ikke per prosjekt. Kortet viser prosjektet når det finnes.

### 14.3 Forhåndsvisning i chatten

- Når et svar fra modellen har en kodeblokk merket `html` som ser ut som et helt program (har `<!doctype`, `<html`, `<body>` eller `<script>`), vises et forhåndsvisningskort rett under blokken når blokken er ferdig strømmet. Det skjer i både Chat- og Kode-modus.
- Kortet har **Vis forhåndsvisning** og **Skjul**, **Lagre som artifact** og **Åpne i Artifacts**. Er blokken allerede lagret, viser kortet det. Forhåndsvisningen er på som standard, med en innstilling for å slå den av.
- Ytelse: Ingen iframe mens blokken strømmer, og ingen iframe for kort utenfor skjermen. Den lages når kortet blir synlig og fjernes når det har vært utenfor skjermen en stund. Høyden er fast og kan endres.
- Demo-modellen svarer på ordet `artifact` (og `html-spill`) med et lite HTML-program i én fil, for eksempel et lite canvas-spill med poeng, i en `html`-kodeblokk.

### 14.4 Sikkerhet (må være på plass)

Artifact-HTML er upålitelig innhold, akkurat som nettsider agenten besøker.

- Forhåndsvisningen kjører på en **annen origin** enn appen, slik Playtest gjør, i en iframe med `sandbox="allow-scripts allow-modals"` og **uten** `allow-same-origin`.
- Den kan ikke lese appens cookie, kalle appens API eller nå WebSocket. API-et avviser `Origin: null` og fremmede origins som før. Dette skal ha en automatisk test.
- Forhåndsvisningsserveren lytter bare på `127.0.0.1`, og en artifact kan bare hentes med en tilfeldig nøkkel som ikke kan gjettes og som lages per kjøring. Den gir aldri ut filer fra disken.
- Appens CSP åpner bare `frame-src` for akkurat den origin-en.
- Lagring og nedlasting går gjennom de vanlige API-kontrollene.

## 15. Redesign mot Codex og Claude desktop (v0.4)

Brukeren vil at appen skal se ut og føles som dagens agentapper. Referansebildene ligger i `docs/design-ref/`:

- `codex-hjem-prosjektvelger.png`: Codex-appen, lys. Sidefanen, tom-skjermen og det slanke meldingsfeltet med prosjektvelger.
- `codex-innstillinger.png`: Innstillinger i Codex, mørk. Fullside med gruppert meny.
- `claude-hjem-statistikk.png`: Claude desktop, mørk. Hilsen og statistikk-kort på startsiden, og et kompakt meldingsfelt.

Dette er en redesign av utseendet og plasseringen, ikke en fjerning av funksjoner. Alt som finnes i dag, skal fortsatt kunne nås: Chat og Kode, ruter, høyre panel, Artifacts, kommandoer, menyer, godkjenninger, Playtest og VS Code. Kopier stilen, ikke merkevarene: ingen logoer, navn eller ikoner fra OpenAI eller Anthropic.

### 15.1 Overordnet stil

- Mye luft, rolig og nøytralt. Sidefanen er en svak tone mørkere eller lysere enn midtflaten, og skilles fra den med farge, ikke med en hard strek.
- Større og roligere tekst i sidefanen, som i Codex (ca. 14–15 px, linjehøyde rundt 32 px per rad). Tynne strekikoner i samme stil overalt.
- Én aksentfarge. Bryterne i innstillingene bruker aksentfargen.
- Avrundede flater: meldingsfeltet ca. 16–20 px med en svak skygge, kort ca. 12 px.
- Både lyst og mørkt tema skal være like gjennomarbeidet. Lyst skal ligne det første bildet, mørkt det andre og tredje.
- Ingen statuslinje nederst. Kontekstbruk vises som en liten ring i meldingsfeltet med detaljer ved hover, tokens og kostnad i `/status` og i Bruk, og **versjon med byggnummer** står dempet nederst i sidefanen og i Om. Versjonskravet fra del 9 gjelder fortsatt.

### 15.2 Vinduets topp

- Øverst til venstre: knapp for sidefanen, tilbake og frem, som i Codex. Menyene **Fil, Rediger, Vis og Hjelp** beholdes, men små og dempet ved siden av.
- **Chat** og **Kode** er en liten, diskret segmentknapp øverst. Den skal ikke dominere.
- Øverst til høyre: små ikonknapper for terminalen og høyre panel, og prosjektknappene (Åpne i VS Code, Playtest, Stopp alt) som ikoner med verktøytips når et prosjekt er aktivt.

### 15.3 Sidefanen

Fra toppen:

1. Appnavnet **Agentic Desktop** med en liten pil som åpner en meny (Om, Innstillinger, hurtigtaster), og til høyre ikonene **søk** og **varsler**. Varsler viser godkjenninger som venter og tråder som er ferdige.
2. Navigasjon: **Ny tråd** (med en liten +-knapp til høyre for ny tråd i et nytt prosjekt), **Artifacts**, **Skills** (liste over skills som finnes) og **Planlagt** (se `planlagte-oppgaver.md`).
3. **Festet**: festede prosjekter.
4. **Prosjekter**: med mappeikon, tråder under, **Ingen tråder** når det er tomt, og **Vis flere** når lista er lang.
5. **Chatter**: tråder uten prosjekt.
6. Nederst: profil med initialer i en farget sirkel og navnet fra profilkortet, et hjelpeikon, og dempet versjon og byggnummer. Klikk på profilen åpner Innstillinger og Bruk.

### 15.4 Startsiden (tom tråd)

- **Kode:** et enkelt ikon og en stor overskrift midt på skjermen, «Hva skal vi bygge i <prosjekt>?», der prosjektnavnet er stiplet understreket og åpner prosjektvelgeren.
- **Chat:** «Hva skjer nå, <navn>?» og et **statistikk-kort** som i Claude: fanene Oversikt og Modeller, filtrene Alt, 30d og 7d, og ruter for Økter, Meldinger, Tokens totalt, Aktive dager, Nåværende rekke, Lengste rekke, Topptime og Favorittmodell. Under er et aktivitetskart med ruter per dag og en morsom setning som «Du har brukt omtrent like mange tokens som <bok>». Tallene kommer fra de ekte dataene i Profil. Kortet kan skjules med en innstilling. I Kode kan det vises under overskriften, dempet.

### 15.5 Meldingsfeltet

Slankt, som i Codex, sentrert med maks bredde rundt 760 px.

- **Raden med brikker over feltet:**
  - **Prosjektvelger**, som åpner en popover med søk, prosjekter med hake ved det valgte, **Nytt prosjekt** og **Ikke jobb i et prosjekt**. Det siste gir Chat.
  - **Lokal**, som er Demo og viser at det kjører på denne maskinen.
  - **Gren**: navnet på git-grenen leses fra `.git/HEAD` hvis filen finnes. Ingen git-kommandoer.
- **Selve feltet:** plassholder «Gjør hva som helst» (Kode) eller «Spør om hva som helst» (Chat).
- **Raden nederst i feltet:**
  - Til venstre: **+** (legg ved fil eller `@`-kontekst) og tillatelsesmodus som brikke: «Spør», «Godta redigeringer» eller «Godkjenn for meg» (Full tilgang).
  - Til høyre: modell og tenkeinnsats som én dropdown («Demo-modell · Middels»), kontekstringen, mikrofon (se `diktering.md`) og en rund send-knapp, som blir Stopp mens modellen jobber.
- `/`, `@`, `$` og `!` virker som før.

### 15.6 Innstillinger som fullside

Innstillinger erstatter hele vinduet, ikke en dialog. Til venstre ligger en meny med **Tilbake til appen** øverst, og to grupper:

- **App:** Generelt, Utseende, Modeller, Git (Demo), Bruk (dagens Profil med statistikk).
- **Vert** på denne maskinen: Konfigurasjon (global og prosjektets `AGENTS.md` og `settings.json`), Personalisering og minner, Hurtigtaster, MCP-servere (Demo), Hooks (Demo), Nettleser, Tillatelser, Worktrees (Demo), Arkiverte tråder (ekte, med Gjenopprett) og Om.

Innholdet er sentrert med maks bredde rundt 720 px, med overskrift, eventuelle faner og kort med rader. Hver rad har tittel, forklaring og en kontroll til høyre: bryter, knapp eller nedtrekksliste. Esc og Tilbake fører tilbake dit du var.

### 15.7 Samtalen

- Brukermeldinger i en dempet boble til høyre. Modellsvar uten boble i full bredde, som nå.
- Verktøyrader og tenkning er kompakte, dempede rader som kan foldes ut, med små ikoner og tidsbruk til høyre.
- Godkjenningskortet ligger rett over meldingsfeltet, i samme bredde, med tydelige knapper.
- Topplinjen i ruten er mindre synlig: tittel til venstre og ikoner som vises ved hover.

## 16. Runde 5: inspirasjon fra dagens agentapper (v0.5)

Brukeren sendte 20 skjermbilder fra Codex, Claude Code desktop og OpenCode 4. november 2026. De ligger i `docs/design-ref/runde5/`, nummerert og navngitt etter hva de viser. Kopier oppførselen og stilen, ikke merkevarene: ingen logoer, modellnavn eller ikoner fra andre selskaper. Ikke lag alt 1 til 1: ta med det som passer appen og kan virke lokalt, og hopp over det som hører til andre apper sine kontoer og skytjenester (Remote Control, Gmail- og Calendar-tilkoblinger, deling, innlogging, abonnement, invitasjoner). Demo-merket brukes bare for ting appen skal få senere.

Endringer fra bygg 18–22 som erstatter deler av del 15:

- Menyene ligger bak ett menyikon øverst til venstre, med Fil, Rediger, Vis, Gå og Hjelp som undermenyer som åpnes ved hover (erstatter 15.2).
- Chat og Kode er to ikoner øverst i sidefanen, og flytter til toppfeltet når sidefanen er skjult. Appnavnet er ren tekst uten meny (erstatter 15.2 og 15.3 punkt 1).
- Chat-startsiden har hilsen og eksempelkort, ingen prosjektrad og ingen statistikk. Kode har alltid meldingsfeltet nederst med prosjektraden, og statistikken i midten (erstatter 15.4).

### 16.1 Agent A: Kode-arbeidsflyten (meldingsfelt, samtale, festet sammendrag)

- **Mål-linje** i raden over meldingsfeltet i Kode når tråden har et mål (`/goal`): målteksten, hvor lenge målet har kjørt (tiden står stille når det er satt på pause), og knappene **Rediger mål**, **Sett på pause / Gjenoppta mål** og **Slett mål**. Tiden lagres på serveren, så den overlever omstart.
- **Plassholder i Kode** som viser kommandoene ryddig: «Spør om hva som helst», `/` kommandoer, `@` filer og `$` skills.
- **Vedlegg:** maks 20 bilder og filer per melding i Kode, med en tydelig melding når grensen nås. Bilder vises som små miniatyrer i meldingen (bilde 01).
- **Tidsbruk:** i Chat står «Tenkte i 12 s» over tenkningen. I Kode står «Jobbet i 14m 34s» som en sammenleggbar overskrift over verktøyradene i turen (bilde 01). Verktøyradene samles i grupper som «Kjørte 3 kommandoer og leste 2 filer», som kan foldes ut steg for steg (bilde 21).
- Innstillingene `thinkingSummary` (vis tenkesammendrag, standard på) og `expandShell` (skallutdata utvidet, standard av) brukes i samtalen.
- **Redigerte filer-kort** etter en tur som endret filer: «Redigerte 9 filer +109 −24», **Angre** og **Vis endringer**, filene med tall per fil og «Vis N flere» (bilde 09).
- **Tillatelsesmenyen** i meldingsfeltet med tre nivåer, ikon og forklaring per nivå (bilde 10).
- **Modellvelger** med overskrift og hake, og **innsats som glidebryter** (bilde 02 og 03).
- **Tidslinje-minikart** langs kanten av samtalen: én strek per brukermelding, hover viser et kort med meldingen og starten på svaret, og klikk hopper dit (bilde 04).
- **Underagenter** som et samlet kort med antall, status, tid og en liste som kan foldes ut, for samarbeid (bilde 19).
- **Festet sammendrag** med seksjonene Resultater, Underagenter og Kilder (bilde 13).
- **Handlinger under en melding ved hover:** Kopier, Forgrening herfra (med forklaring), Fest som kapittel (vises i minikartet og sammendraget), og tiden meldingen ble sendt, med full dato, år og klokkeslett ved hover.

### 16.2 Agent B: navigasjon (palett, menyer, prosjekter, profil, høyre panel, nettleser)

- **Trådnavnet øverst** ved siden av Chat/Kode: svak grå bakgrunn ved hover, klikk gir Gi nytt navn, og en ›-knapp folder ut info og innstillinger for chatten.
- **Kommandopalett** (Ctrl+K) med fanene Alle, Handlinger, Chatter, Filer og Tekst: hurtighandlinger med hurtigtaster, nylige samtaler med prosjekt, og nylig åpnede filer (bilde 14).
- **Trådmeny** på høyreklikk og ⋯: Gi nytt navn, Fest, Ny sidechat, Forgrening ›, Utsett ›, Kopier › (tekst, Markdown, ID), Åpne i nytt vindu og Arkiver, med hurtigtaster (bilde 15).
- **Hover-kort** for tråder og prosjekter i sidefanen: tittel, prosjekt, alder, antall chatter, sti og **Rediger prosjekt** (bilde 05 og 06).
- **Rediger prosjekt** som dialog med navn, kildemapper og **Fjern lokalt prosjekt**, og en **ikonvelger** med emoji, ikoner og farger for prosjektet (bilde 07 og 08).
- **Profilmeny** nederst i sidefanen (navn, Innstillinger, Hjelp ›, Hurtigtaster) og en **profilside** med avatar, nøkkeltall og tokenaktivitet per dag, uke og akkumulert (bilde 16 og 17). Ikke invitasjoner, utlogging, abonnement eller offentlig profil.
- **Smart sidefane** som valg i Innstillinger (`sidebarLayout`): trådkort for det som trenger deg, og gruppene Jobber, Utsatt (snooze) og Avsluttet nederst. Favicon i prosjektmappen blir prosjektikon automatisk (bilde 24).
- **Høyre panel:** en oversiktsfane med Miljø, kontekstbruk med fordeling og Utdata (filer endret i tråden) (bilde 18). Ikke Remote Control eller tilkoblinger.
- **Nettleserpanelet:** en ny-fane-side med verktøy og forslag, og en ⋯-meny med Finn på siden, Zoom, Ta et skjermbilde, Historikk og Tøm nettlesingsdata (bilde 11 og 12).

### 16.3 Agent C: Innstillinger

- Fyll Innstillinger med det som er vanlig i agentiske kodeapper (Codex, Claude Code, Cursor, OpenCode, Zed, Windsurf og lignende). Søk på nettet etter hva de har. Bilde 20 viser OpenCode.
- `thinkingSummary` og `expandShell` skal ha brytere i Generelt, og valget Standard eller Smart sidefane.
- **Leverandører** som i OpenCode (bilde 22 og 23): bare OpenRouter, abliteration.ai, Anthropic og OpenAI med API-nøkkel, alle merket Beta til de er prøvd med ekte nøkler. Egendefinert er igjen som en liten lenke.
- Det som kan lagres og virke, skal være ekte innstillinger. Resten får Demo-merke.

### 16.4 Agent D: ruter og multitasking

- Ruter i Kode og Chat skal føles som multitasking på iPad: dra en tråd fra sidefanen eller en rute etter topplinjen ut til en kant, og se en tydelig forhåndsvisning av hvor den havner, opp til 6 side om side eller stablet.
- Skillene mellom rutene får et synlig håndtak ved hover. Dra for å endre størrelse, og fest til 1/3, 1/2 og 2/3. Dobbeltklikk gjør rutene like store.
- Myke overganger når ruter legges til, fjernes eller byttes, bare med `transform` og `opacity`.

### 16.5 Felles for alle

- **Bakgrunnsarbeid:** en liten boks i samtalen mens agenten jobber (A), og bakgrunnsoppgaver med ikon, tid og status i høyre panel (B). En grønn og rød endringsbrikke dukker opp når tråden har endrede filer (B). Ikonene øverst til høyre står fast, med en egen knapp for ny instans (B).

- **Verktøytips** på nesten alle ikoner, også Chat og Kode: en global tooltip (B) som leser `title`, eller `data-tip` og `data-keys`, vises etter ca. 400 ms og viser hurtigtasten når den finnes. Alle ikonknapper har et kort, forklarende tips på norsk.
- **Hurtigtaster kan endres** i Innstillinger (C): opptak av ny kombinasjon, konfliktvarsel, tilbakestilling og egne snarveier for fanene i høyre panel, som Nettleser.

### 16.6 Arbeidsregler for runde 5

Reglene i del 11 og 13.3 gjelder. Tre agenter jobber samtidig i samme mappe uten git, derfor gjelder dette i tillegg:

- Hver agent eier sine filer (se oppdraget) og sitt eget stilark: `web/src/styles/kode.css` (A), `nav.css` (B) og `settings.css` (C). `styles.css` endres bare når en eksisterende regel må justeres.
- Delte filer (`shared/protocol.ts`, `server/src/http/api.ts`, `server/src/db.ts`, `web/src/state/*.ts`, `web/src/ui/icons.tsx`) endres bare med små tillegg. Les filen på nytt rett før hver endring, og formater aldri om.
- Aldri `npm run build` eller `npm start`: de skriver `web/dist`, som brukerens server viser, og øker byggnummeret. Bygg til en egen mappe med `npx vite build --outDir <egen tmp-mappe> --emptyOutDir` fra `web/`, og kjør UI-testene med `AD_WEB_DIST=<samme mappe>`.
- Nye tester i egne filer. Rør ikke `version.json`, `docs/PATCHLOG.md` eller andres filer. Patch-notatet leveres i sluttrapporten.
- **Stopp prosesser bare én og én med kjent PID.** Ta PID-en fra prosessen du selv startet (`$!` eller `child.pid`), finn barna med `pgrep -P <pid>` rekursivt, og sjekk hver PID med `ps -o pid,cmd -p <pid>` før `kill`. Aldri `kill` på en liste du har bygget med awk, `pkill`, `killall` eller mønstre som `pkill -f chrome`. I runde 7 drepte et feil awk-skript alle prosessene på maskinen og startet brukerens økt på nytt.

## 17. Runde 6: nettleser, meldingsfelt, minne, skills og en bedre agent-harness

Brukerens ønsker 4. november 2026, etter runde 5. Reglene i 16.6 gjelder fortsatt (egne filer, eget bygg i `/tmp`, ingen `web/dist`, ingen git).

### 17.1 Agent B: nettleser og prosjekter
- **Nedlastinger** fra den innebygde nettleseren, så den kan brukes som en enkel nettleser. Filene havner i en egen nedlastingsmappe som kan velges i Innstillinger (standard: `~/Nedlastinger/Agentic Desktop`). Det finnes en liste over nedlastinger med fremdrift, Vis i mappe og Fjern fra lista. Ingenting kjøres eller åpnes automatisk. Filnavn renses, og ingenting skrives utenfor mappen.
- **Prosjekter:** så mange man vil, og navn og mappe kan endres senere (Rediger prosjekt).

### 17.2 Agent A: +-menyen i meldingsfeltet
- **+** åpner en meny med ikon på hver rad: Skråstrekkommandoer (åpner `/`-menyen), Legg til mappe (som `@`-kontekst), Legg til filer (tekstfiler fra disken som vedlegg) og Bilder. Grensen på 20 vedlegg gjelder.

### 17.3 Agent E: agent-harness, minne og skills
- **Harness:** appen bruker API-modeller, så den trenger en god agent-harness med «støttebein» som gjør modellene så gode som mulig. Studer hva Claude Code, Codex, OpenCode, Aider og Hermes-agenten gjør (systemprompt, verktøydesign, redigering, søk, planlegging, verifisering, kontekst og feilhåndtering), og forbedre `server/src/agent/` ut fra det.
- **Minne:** modellen kan lagre korte minner underveis (globalt og per prosjekt) og få dem igjen i senere tråder. Minnene kan ses, endres, slås av og slettes i Innstillinger → Personalisering og minner. Ingen hemmeligheter skal lagres.
- **Skills i Innstillinger:** se alle skills (dine og prosjektets), lag nye, endre, slå av og fjerne.
- **Selvforbedring som i Hermes:** agenten kan foreslå og lage egne skills når den har løst noe den kan få bruk for igjen. Standard er at du godkjenner hver ny skill. Det kan slås av i Innstillinger.

Hoppet over: programvaretillegg (plugins). Brukeren var usikker på om det trengs.

## 18. Runde 7: Chat-modus, styring, og et dev-team som kritiserer og tester

### 18.1 Meldinger mens agenten jobber
Innstillingen `busyMessages` velger mellom **Kø**, som er standard og sender meldingen når turen er ferdig, og **Send med en gang**, der meldingen går inn i turen som kjører ved neste stegskifte. E lager serverdelen og raden i Innstillinger. F lager oppførselen i meldingsfeltet, med en liten bryter i kø-raden.

### 18.2 Agent F: Chat-modus
Chat skal ikke bli glemt. Den skal få det som passer en samtale-app, uten å bli like avansert som Kode. Det gjelder blant annet:
- å redigere en melding og sende den på nytt
- å lage svaret på nytt
- å kopiere svar og kodeblokker
- matte og LaTeX
- vedlegg av bilder og tekstfiler
- personlighet eller instruksjoner per chat
- eksport til Markdown
- søk i samtalen
- en midlertidig chat uten historikk
- en ryddig startside

Bare det som kan virke lokalt.

### 18.3 Dev-team-runden
Når A, B, E og F er ferdige:
1. En **UI/UX-kritiker** og en **QA/QC-agent** går gjennom hele appen og lager prioriterte lister med funn.
2. Implementeringsagenter retter funnene, fordelt etter område.
3. Hele testsuiten kjøres, og brukeren tester på localhost.

Er brukeren fornøyd, er neste steg en ekte skrivebordsapp (Electron).

## 19. Runde 8: kanttilfeller og ekstra (agent G)

Starter etter detalj- og animasjonsagenten, sammen med UI-retterne. G eier nye filer og gjør bare små tillegg i delte filer.

- **Kanttilfeller:** gå gjennom appen med tanke på det uventede, som tomme lister, svært lange navn, mange prosjekter, mange tråder, tegn utenfor ASCII, frakobling og trege svar. Rett det som hører til G sine filer, og skriv resten i en liste til retterne.
- **Personalisering og temaer:** ferdige tema-forslag i tillegg til Lys, Mørk og System. Eksempler er en høykontrast-variant, en varm og en kald variant, og et par kjente kode-paletter som Nord- og Solarized-lignende. Alle bruker de samme tokenene, slik at hele appen følger med. Valg av tema med forhåndsvisning i Innstillinger → Utseende, uten blink ved oppstart.
- **GitHub (Beta):**
  - Koble til med et personlig tilgangstoken. Tokenet lagres som leverandørnøkler og vises aldri.
  - Vis prosjektets GitHub-repo, lest fra `.git/config` uten git-kommandoer, med åpne pull requests og issues, og lenker som åpnes i nettleserpanelet.
  - Bare lesing i første versjon.
  - Merket Beta, og testet bare mot en lokal fake-server.
- **Mini-kodeeditor:** klikk på en kodeblokk, en filsti i en verktøyrad eller en fil i Endringer, og få en liten editor i VS Code-stil, ikke en full IDE. Den har:
  - CodeMirror med syntaksfarger og linjenumre
  - søk og gå til linje
  - en enkel oversikt over funksjoner og klasser
  - visning av endringer når det finnes
  - knappene Kopier, Åpne i Filer og «Spør om dette», som legger utvalget i meldingsfeltet
  
  Redigering er bare for filer i prosjektet, og lagring går gjennom de vanlige tillatelsene.

## 20. Kode-startsiden med prosjekter i stedet for statistikk (brukerønske 4. november 2026)

- Statistikk-kortet med token-historikken flyttes bort fra Kode-startsiden. Det finnes i Innstillinger → Bruk, og bryteren «Statistikk på startsiden» fjernes eller flyttes dit.
- **Kode uten valgt prosjekt:** midt på siden vises prosjektmappene som kort, opptil 4 av de sist brukte. Hvert kort har ikon eller favicon, navn, sti og når prosjektet sist ble brukt. Under ligger «Vis alle prosjekter» og «Nytt prosjekt». Uten prosjekter står én vennlig linje og «Velg mappe».
- **Kode med prosjekt:** hilsen eller spørsmål og forslag som i dag, men uten statistikk.
- **Prosjektvelgeren i meldingsfeltet:** søkefelt øverst og en liste nedover med seksjonene **Nylige**, med de sist brukte, og **Alle prosjekter**, med søk på navn og sti. Piltaster og Enter virker, og nederst står Nytt prosjekt og Ikke jobb i et prosjekt.

## 21. Runde 9: Kode-start, sidefane med Festet, innsatsvelger og tidslinje (brukerønske 5. november 2026)

Referansebilder ligger i `docs/design-ref/runde9/` (01 til 09). Brukerens røde tekst på bildene er en del av ønsket. Del 20 gjelder fortsatt, men endres slik:

### 21.1 Kode-startsiden
- **Fjern** den store tomtilstanden «Kode jobber i en mappe på maskinen din. Velg en, så er du i gang» med ikon og «Velg mappe» midt på siden (bilde 01).
- **Uten prosjekt:** et lite ikon og en stor, rolig hilsen, «Hva skal vi bygge?» (bilde 04).
- **Med prosjekt:** samme ikon, og «Hva skal vi jobbe med i *prosjektnavn*?». Navnet har en prikket understrek, og et klikk åpner prosjektvelgeren (bilde 03).
- Under hilsenen, når det er et prosjekt, står et lite kort med det som hører til prosjektet (bilde 02):
  - de siste trådene eller miljøene i prosjektet, som rader med ikon
  - Informasjon om lokalt miljø
  - et eget kort under: «Koble til GitHub», eller, når GitHub er koblet til, siste åpne issue eller pull request. Klikk åpner GitHub-fanen.
- **Valg i Innstillinger** (Generelt eller Utseende), med forhåndsvisning:
  - Kode uten prosjekt: «Enkel hilsen» (standard, bilde 04) eller «Prosjektkort» (del 20)
  - Kode med prosjekt: «Hilsen med prosjektkort» (standard, bilde 02 og 03) eller «Bare hilsen»
- **Plassholderen** i meldingsfeltet viser alle tre hjelperne med hva de gjør: `/` kommandoer, `@` filer og `$` skills, i samme rolige stil som i dag. Den forkortes pent i smale ruter.

### 21.2 Sidefanen
- **Festet:** en egen seksjon rett under Ny tråd, Artifacts og Skills (bilde 05). Den vises av seg selv når noe er festet (tråder og prosjekter), og er skjult ellers. Festede ting står øverst også i Kode.
- **Prosjekter** lages av seg selv når du velger en mappe på PC-en (fra meldingsfeltet, startsiden eller +). Raden «+ Velg en mappe» midt i listen fjernes. I stedet har overskriften Prosjekter en +-knapp.
- **Denne datamaskinen:** tråder i Kode som ikke hører til et prosjekt, står i en egen gruppe nederst i sidefanen, med et dataskjerm-ikon.
- **Mappe som mangler:** hvis prosjektets mappe er flyttet eller slettet og du åpner en tråd i prosjektet, vises en tydelig linje over meldingsfeltet: «Fant ikke mappen …» med knappen «Velg mappe på PC-en», som kobler prosjektet til mappen på nytt. Sidefanen viser et lite varselmerke på prosjektet.
- **Chat-prosjekter:** i Chat kan du lage prosjekter med + og et navn i sidefanen, for å samle chatter. De har ingen mappe på disken. Chatter kan flyttes inn i dem fra trådmenyen.
- **Tannhjulet** nederst ved profilen skal se ut som et tannhjul, ikke en sol (bilde 08). Verktøytipset sier «Innstillinger for Kode» eller «Innstillinger for Chat», etter modusen. Et klikk åpner Innstillinger på siden som passer modusen.

### 21.3 Innsatsvelgeren
- Knappen i meldingsfeltet viser innsatsen, for eksempel «Høy ⌄», eller «Velg innsats ⌄» når modellen har standard (bilde 06).
- Klikk åpner en popover over meldingsfeltet:
  - venstre: lyn-ikon
  - midten: nivået i aksentfarge, og under det modellnavnet med › som åpner modellmenyen
  - høyre: en knapp for å tilbakestille til standard
  - under: en glidebryter med prikker for hvert trinn, fra **Ingen** tenkning til **Maks**: Ingen, Lav, Middels, Høy og Maks
- Glidebryteren virker med mus, dra, piltaster og Home/End. Den viser bare trinnene modellen støtter.

### 21.4 Toppfeltet og ruter
- En fast ikonknapp øverst til høyre med et delt-vindu-ikon, «Ny rute», som åpner en ny rute ved siden av (bilde 07). Den har hurtigtast i verktøytipset.

### 21.5 Tidslinjen i samtalen
- Tidslinjen langs venstre kant av samtalen skal vises i både Chat og Kode (bilde 09).
- Den har én strek per melding, både dine og modellens svar, med ulik lengde eller lysstyrke for de to. Den markerer hvor i samtalen du er.
- Når du holder over, forstørres strekene nær musen, som en dock. Et kort viser starten på meldingen, og et klikk hopper dit.
- Den vises fra 2 meldinger og skjules i smale ruter.

### 21.6 Versjon og byggnummer
- Versjon og byggnummer står ikke lenger under Profil nederst i sidefanen (bilde 08). De vises bare i Innstillinger, i Om og nederst i menyen i Innstillinger som en dempet linje, for eksempel «v0.5.0 · bygg 23».

### 21.7 Farge, og detaljer på prosjektene i sidefanen
- **Farge:** innsatsvelgeren og modellvelgeren bruker aksentfargen. Aksentfargen velges i Innstillinger og gjelder hele appen. Det finnes en rød aksent blant valgene, med god kontrast i både lyst og mørkt tema.
- **Hover på et prosjekt** i sidefanen viser en +-knapp som lager en ny tråd i prosjektmappen, ved siden av ⋯.
- **Overskriften Prosjekter** har en knapp for gruppering og sortering. Den åpner en meny med:
  - gruppering: etter prosjekt eller en samlet liste etter tid
  - sortering: sist brukt, navn eller opprettet
  - Valgene huskes.
- **Fold sammen:** hvert prosjekt kan foldes sammen og ut med en pil. Overskriften har «Fold sammen alle» og «Fold ut alle». Tilstanden huskes.

### 21.8 Redigere meldinger og Enter
- **Rediger en melding du har sendt:** hover på en av dine meldinger viser Rediger og Kopier. Rediger gjør meldingen om til et felt der den står. Når du sender, viskes alt under meldingen ut, med en rolig uttoning, og modellen svarer på nytt fra det punktet. Før det skjer i en tråd med verktøyendringer i Kode, sier appen fra at filene ikke rulles tilbake. Esc avbryter.
- **Kopier flere meldinger:** hover viser en avkrysning, eller Shift+klikk markerer et område. Da kan flere meldinger kopieres samlet som tekst eller Markdown.
- **Enter:** et valg i Innstillinger → Generelt, «Enter sender» (standard) eller «Enter gir ny linje». Med det siste sender Ctrl+Enter. Plassholderen og verktøytipset på send-knappen viser riktig tast.

### 21.9 Fokus på meldingsfeltet og panelet uten tråd
- **Fokus:** meldingsfeltet får ikke blå kant når du klikker i det. Kanten blir litt tydeligere grå, med en nøytral token som fungerer i alle temaer. Tastaturfokus på knapper beholder sin ring.
- **Panelet uten tråd:** høyre panel med Terminal, Nettleser, Filer og de andre fanene kan åpnes fra startsiden, uten at du først starter en chat eller tråd. Det gjelder også Chat-startsiden for Nettleser. Panelet legger seg til høyre som ellers.
  - Terminalen starter i prosjektmappen når et prosjekt er valgt. Ellers starter den i hjemmemappen og merkes «Denne datamaskinen».
  - Faner som trenger et prosjekt, som Filer og Endringer, sier det med én rolig linje og «Velg prosjekt».

## 22. Runde 9b: en standard-harness for Kode og egen personalisering for Chat (brukerønske 5. november 2026)

Modellen skal aldri gå rett på API-et uten å vite noe. En ny tråd skal kjenne seg selv, som i andre kodeagenter. Spør du «hei» i en ny tråd, skal svaret vise at modellen vet hva den er, hva den kan og hvor den jobber.

Eksempel på tonen, i vår egen form: «Hei! Jeg er kodeagenten i Agentic Desktop. Jeg kan skrive og endre kode, rette feil, kjøre kommandoer og tester, og utforske kodebasen. Hva vil du jobbe med?»

### 22.1 Research
Bygg videre på `docs/research/harness.md`. Se på hvordan Claude Code, Codex, OpenCode, Aider, Cline og Hermes-agenten gjør dette:
- standard systemprompt og identitet
- instruksjonsfiler (AGENTS.md, CLAUDE.md) i lag: innebygd, global og prosjekt
- automatisk minne og hvordan minner ryddes eller slås sammen
- «gjenopprett standard»

Skriv funnene i `docs/research/harness-runde9.md`, med kilder.

### 22.2 Kode: lag på lag
- **Innebygd grunn-harness:** versjonert i appen og alltid med. Den har identitet, arbeidsmåte, verktøyregler, verifisering, sikkerhet og norsk eller engelsk etter brukerens språk. Miljøet settes inn av seg selv: OS, prosjektmappe, gren, dato og hvilke verktøy som er på.
- **Global `AGENTS.md`:** lages med et godt standardinnhold første gang appen starter, i appens datamappe. Den kan redigeres i Innstillinger.
- **Prosjektets `AGENTS.md`:** finnes fra før (`/init`).
- **Minner og skills:** som i dag.
- **Gjenopprett standard:** for den globale `AGENTS.md` og harness-valgene. Du ser en forskjell før du bekrefter, og den gamle fila tas vare på som sikkerhetskopi. Selve grunn-harnessen i koden kan ikke endres, bare slås av og på i deler. Eksempler er «Spør før store endringer» og «Kjør tester etter endringer».
- **Forhåndsvisning:** Innstillinger viser den samlede systemprompten slik modellen får den, lag for lag, med antall tokens.

### 22.3 Automatisk minne
- Etter en tur kan agenten foreslå minner. Reglene fra QA K2 gjelder fortsatt: globalt spør den, og i prosjekt følger den reglene for redigering.
- **Minneoppgradering:** av og til, eller med en knapp, slår appen sammen like minner, fjerner utdaterte og korter ned. Du ser forslaget før det lagres. Det kan slås av.
- Ingen hemmeligheter, som før.

### 22.4 Chat: eget sted
Chat har egen personalisering, adskilt fra Kode, i Innstillinger:
- systeminstruks
- om deg
- tone
- Chat-minner, med valget «Oppdater minnet av seg selv»

Chat bruker ikke Kode-harnessen, men en kort og vennlig Chat-grunn med identitet.

### 22.5 Skills
- **Importer mange .md-filer samtidig**, enten ved å velge flere filer eller en mappe, eller ved å dra dem inn. De vises i en liste nedover med navn, beskrivelse fra frontmatter, kilde og bryter.
- Ved navnekollisjon får du valget mellom å erstatte, beholde begge eller hoppe over.
- Ugyldige filer får en tydelig melding per fil.

### 22.6 Demo-modellen
Demo-modellen (mock) skal svare på «hei», «hvem er du» og «hva kan du» ut fra den faktiske systemprompten. Den skal for eksempel liste verktøyene som er på, så brukeren ser at harnessen virker uten API-nøkkel.

## 23. Runde 10: nettleseren som en liten Chrome, modellvelger med søk, og ro i rutene (brukerønske 5. november 2026)

Referansebildene ligger i `docs/design-ref/runde10/` (01 til 07). Brukerens røde tekst på bildene er en del av ønsket.

### 23.1 Nettleserpanelet som en liten Chrome (bilde 01 og 02)
- **Ny fane-siden:**
  - **Verktøy:** Filer og Terminal med hurtigtast.
  - **Foreslått:** bygges av prosjektene dine, med ikon eller favicon, for eksempel servere som kjører, artifacts og nylige sider fra prosjektet.
  - **Bredde:** raden med verktøy og forslag tilpasser seg bredden på panelet. ⋯-menyen vises bare når noe ikke får plass, og samler det som ikke får plass.
- **Faner som i en liten Chrome:**
  - flere faner med favicon og lukk
  - tilbake, frem og last på nytt
  - adressefelt
  - nedlastinger (knappen og lista som finnes)
  - ⋯-menyen
- **+ i fanelinjen:** når du holder musen over +, kommer en liten meny med «Ny fane» (Ctrl+Shift+B) og «Ny fane i fullvisning» (Ctrl+Shift+F). Et klikk på + lager en ny fane.
- **Importer fra Chrome:**
  - en knapp i Innstillinger → Nettleser, og et tips på Ny fane
  - importerer bokmerker og eventuelt historikk fra en Chrome-profil på maskinen
  - **leser bare**, og bare når du ber om det
  - du velger profil og ser hva som blir importert før det skjer
  - aldri passord, informasjonskapsler, kort eller økter
  - testes bare mot en falsk profilmappe

### 23.2 Sidefanen i Kode (bilde 03)
- «Ingen prosjekter ennå» fjernes. Uten prosjekter står bare overskriften Prosjekter med +.
- «Denne datamaskinen» vises først når det finnes minst én tråd uten prosjekt.

### 23.3 Modellvelgeren (bilde 04 og 05)
- **Knappen** i meldingsfeltet viser leverandørens ikon og modellnavnet med ⌄.
- **Lista:**
  - søkefelt øverst, «Søk etter modeller»
  - en liste nedover gruppert etter leverandør, med overskrift per leverandør
  - en hake på den valgte modellen
  - «Administrer modeller» nederst, som åpner Innstillinger → Modeller
- Piltaster, Enter og Esc virker. Lista scroller når den er lang.

### 23.4 Innsatsvelgeren (bilde 06)
- Lyn-ikonet til venstre fjernes.
- Den grå bakgrunnen bak nivå og modellnavn fjernes. Teksten står rett på popoveren.

### 23.5 Ro i rutene (bilde 07)
- Knappene øverst i en rute, som er Del til høyre, Del nedover, Løsriv og Lukk, skal ikke dukke opp og forsvinne når musen går inn og ut av ruten.
- Ett rolig grep, for eksempel:
  - knappene står alltid, dempet, og blir tydelige ved hover
  - eller én ⋯-knapp som alltid står, med de samme valgene i en meny
- Ingenting i ruten skal hoppe eller flytte seg når musen beveger seg.

### 23.6 Profilmenyen
- Menyen som åpnes fra Profil nederst i sidefanen, skal holde seg innenfor sidefanen. Den er like bred som sidefanen minus marg og slutter ved kanten, i stedet for å stikke ut over samtalen. Undermenyer kan fortsatt åpne seg til siden.

### 23.7 Ingen markering på meldingsfeltet
- Meldingsfeltet får ingen markering når du klikker i det, verken farge, tykkere kant, skygge eller glød. Det ser likt ut med og uten fokus. Markøren som blinker, viser at du kan skrive. Dette erstatter den grå kanten fra 21.9.

### 23.8 Ingen «Ny tråd» som tittel
- En ny tråd uten meldinger har ingen tittel. Toppfeltet viser ingen tittel, og rutens topplinje heller ikke. Teksten «Ny tråd» skal ikke stå der.
- En tom tråd vises ikke som «Ny tråd» i sidefanen. Den kommer først i lista når den har fått den første meldingen og en tittel.
- Knappen «Ny tråd» øverst i sidefanen beholdes, fordi den er en handling og ikke en tittel.

### 23.9 Sammenlagt sidefane som en tynn ikonrad
- Når sidefanen skjules, i Chat og i Kode, blir den ikke borte helt. Den glir inn til en tynn loddrett rad med ikoner, rundt 48 px bred.
- **Rekkefølge, ovenfra og ned:**
  - Vis sidefanen
  - Chat og Kode
  - Ny tråd
  - Søk
  - Artifacts
  - Skills
  - Festet og prosjekter som små ikoner eller favicons, i Kode
  - **Nederst:** varsler, tannhjulet og profil-avataren
- **Ikoner:** samme strek og størrelse som resten av appen, og samme hover-flate.
- **Verktøytips:** hvert ikon har et tips med navn og hurtigtast. Den aktive modusen og den åpne tråden eller prosjektet er markert.
- **Overgang:**
  - Bredden glir mellom full og tynn med `transform` og `opacity`, ikke med bredde-animasjon på innholdet.
  - Teksten toner ut før raden smalner.
  - Ved redusert bevegelse skjer overgangen uten animasjon.
- **Små vinduer:** under 860 px er raden borte, og sidefanen legger seg over innholdet som i dag.
- **Valg i Innstillinger → Utseende:** «Skjult sidefane: tynn ikonrad (standard) eller helt borte».

### 23.10 Glimt-tekst mens modellen tenker eller jobber (bilde 08)
- Statusteksten mens noe pågår får en rolig glimt-animasjon. Et lyst felt glir sakte over teksten, fra venstre mot høyre, og teksten er ellers dempet. Ideen kommer fra bilde 08, men vi kopierer verken logo eller ikon.
- **Chat:** «Tenker» mens modellen resonnerer, og «Jobber» når den bruker et verktøy, for eksempel nettsøk.
- **Kode:** «Arbeider» eller «Jobber» med tiden som før, for eksempel «Jobber… 12s». Det samme gjelder verktøysteg som kjører, som «Leser filer» og «Kjører kommando».
- **Bare når det trengs:** modeller som ikke resonnerer, får ikke «Tenker» med glimt. De viser bare vanlig status når de bruker verktøy.
- **Når turen er ferdig:** animasjonen stopper, og teksten blir rolig og dempet («Tenkte i 4s», «Jobbet i 1m 2s»). Når du holder musen over, blir den lys, som et hint om at den kan foldes ut.
- **Ytelse:**
  - Animasjonen er billig: én gradient med `background-clip: text`, og bare så lenge raden er synlig.
  - Den stopper utenfor skjermen og i bakgrunnsfaner.
  - Ved redusert bevegelse står teksten stille i dempet farge.
  - Bildetaket i `npm run perf` skal ikke endre seg.

### 23.11 «Premium tenkevisning» i Chat (bilde 09)
- **Valg:** Innstillinger → Chat får «Tenkevisning» med to valg, «Vanlig» (dagens fold med «Tenker» / «Tenkte i …») og «Premium».
  - Valget endrer bare utseendet, ikke hva modellen gjør.
  - Det gjelder bare modeller som resonnerer.
- **Premium** er et kort med avrundede hjørner, som på bildet:
  - **Øverst** står «Forespørsel til *modellnavn*» i halvfet. Navnet kommer fra modellvelgeren.
  - **Under** står én linje med hva modellen holder på med. Den hentes fra tenkesammendraget når det finnes, for eksempel «Går gjennom delene…», og er ellers en rolig standardtekst. Linjen bytter med en myk overgang.
  - **En fremdriftslinje.** Modellen sier ikke hvor langt den har kommet, så linjen fylles rolig og flater ut mot slutten, uten å late som den vet mer. Når svaret kommer, fylles den helt og kortet toner over i svaret.
  - **Knappen «Detaljer»** til høyre åpner tenkesammendraget, og under arbeidet hele tenkingen.
  - **Når turen er ferdig** står kortet igjen i kompakt form over svaret: «Forespørsel til *modell*», tiden («4m 12s») og «Detaljer».
- Bevegelse og ytelse følger 23.10: bare `transform` og `opacity`, ingenting kjører utenfor skjermen, og det står stille ved redusert bevegelse. Logoer og merkenavn fra bildet kopieres ikke.
- **Presisering 23.11:** når turen er ferdig, står det samme kortet over svaret, med «Forespørsel til *modell*» øverst. Under står «Tenkte i 4m 12s», og et klikk på den linjen åpner sammendraget. Den ferdige formen har ingen egen Detaljer-knapp. Linjen «Tenkte i …» er knappen.

### 23.12 En hemmelig påskeegg-overraskelse
- Appen får et skjult påskeegg som brukeren skal oppdage selv. Det beskrives ikke i patch-loggen eller i appen.
- **Krav:**
  - helt ufarlig: ingen nettverk, ingen endring av data, filer eller innstillinger
  - kan ikke utløses ved et uhell under vanlig bruk
  - lukkes med Esc eller et klikk
  - respekterer redusert bevegelse
  - ingen merkevarer eller figurer fra andre
  - koster ingenting når det ikke brukes (lastes først når det utløses)
- Hvordan det utløses og hva som skjer, står bare i en kort, lukket del av agentens rapport.

## 24. Runde 11: ryddig toppfelt, panelknapper og et sidepanel med startside (brukerønske 6. november 2026)

Referansebildene ligger i `docs/design-ref/runde11/` (01 til 06). Brukerens røde tekst på bildene er en del av ønsket. Bilde 02 og 04 er forbilder for form og oppførsel; vi kopierer ikke logoer eller merkenavn.

### 24.1 Toppfeltet og den tynne ikonraden (bilde 06)
- **Ingen doble ikoner.** «Vis sidefanen» finnes bare ett sted om gangen. Når ikonraden vises, står knappen i raden og ikke også i toppfeltet. Det samme gjelder alle andre ikoner som i dag står både i toppfeltet og i raden.
- **Ikonene i toppfeltet treffer ikke sidefanen.** Ikonene øverst til venstre (☰, tilbake, frem) står på linje med kolonnen de hører til, og legger seg ikke over ikonraden eller sidefanen.
- **Ingen grå flate bak aktive ikoner i raden.** Aktiv modus og åpen tråd vises med lysere ikon eller en tynn markør, ikke en grå boks. Hover kan fortsatt gi en svak flate.
- **En tynn, lys skillelinje («outliner»):**
  - langs høyre kant av sidefanen, både når den er åpen og når den er en ikonrad
  - langs undersiden av toppfeltet
  - den er 1 px og svak (for eksempel hvit med lav opasitet i mørkt tema, mørk med lav opasitet i lyst tema), og bruker tokens slik at den virker i alle temaer og aksentfarger
- **Rutens knapper flyttes opp i toppfeltet.**
  - I dag står Del til høyre, Del nedover, Løsriv og Lukk på en egen linje under toppfeltet. De flyttes opp til høyre i toppfeltet og ryddes, slik at den ekstra linjen forsvinner.
  - **Løsriv-knappen fjernes.** Valget kan bli liggende i en meny hvis det trengs.
  - **Lukk rute** vises bare når det er mer enn én rute.
  - Med flere ruter gjelder knappene ruten som har fokus. Når en rute har egen topplinje fordi det er flere ruter, kan knappene stå der i stedet. Det skal se ryddig ut og ikke gi doble knapper.
- **Startsiden i Kode og Chat:** ikonet over «Hva skal vi bygge?» blir større og skalerer med vindusstørrelsen (for eksempel med `clamp()`), så det ser riktig ut på store skjermer. Overskriftene fra 21.1 beholdes: «Hva skal vi bygge?» uten prosjekt og «Hva skal vi jobbe med i *prosjekt*?» med prosjekt.

### 24.2 Panelknapper oppe til høyre: to stiler å velge mellom (bilde 02 og teksten)
- **Innstillinger → Utseende** får valget «Panelknapper» med to stiler:
  - **Samlet (standard):** noen få rolige knapper øverst til høyre, som på bilde 02: ⋯ (flere valg), et ikon for oversikt eller disposisjon, en tynn skillestrek og en knapp for å legge til et sidepanel.
  - **Hver for seg:** én av/på-knapp per panel øverst til høyre, med tips: «Skjul øktpanel», Terminal, Endringer, Nettleser og Filer. Aktive panel er markert.
- **Knappen for å legge til et sidepanel** åpner en meny med panelene du kan åpne (Oversikt, Filer, Endringer, Terminal, Nettleser, Team og de andre som finnes), og valg for hvor panelet skal stå, for eksempel til høyre eller under. Det er ett sted å styre panelene fra.
- **Plass til vinduskontroller:** når appen senere blir en Electron-app med egne vinduskontroller (minimer, maksimer og lukk), skal panelknappene stå rett til venstre for dem. Lag en tom, navngitt plass i toppfeltet til det nå, så layouten ikke må endres senere. I nettleseren er plassen tom og tar ingen bredde.
- Begge stilene virker i Chat og Kode, men Chat viser bare panelene Chat har (24.5).

### 24.3 Sidepanelet får en startside med verktøy i stedet for faner (bilde 01 og 03)
- I dag har sidepanelet en fanelinje øverst (Oversikt, Filer, Endringer, Terminal, Nettleser, Team, Git) og en tom tilstand med «Oversikten hører til et prosjekt. Velg prosjekt».
- **Ny standard:**
  - fanene flyttes ned i panelet som en ryddig startside, med samme design som Ny fane i nettleseren (bilde 01)
  - **Verktøy:** én flis per panel med ikon, navn og hurtigtast, for eksempel Oversikt, Filer, Endringer, Terminal, Nettleser, Sidechat og Team
  - **Foreslått** under, slik nettleserens Ny fane gjør det, når det finnes noe å foreslå
  - **den tomme tilstanden fjernes:** «Oversikten hører til et prosjekt» og «Velg prosjekt» skal ikke stå der
  - et verktøy som trenger prosjekt, for eksempel Oversikt og Endringer, er dempet uten prosjekt, med et kort tips. Det står ikke en egen tom side
- **Når et verktøy er åpnet,** viser panelet det verktøyet, med en liten, rolig vei tilbake til startsiden. Det kan være et lite ikon eller navnet på verktøyet med ⌄. Det er ikke en full fanelinje.
- **Tilpasser seg bredden:**
  - flisene står i ett, to eller tre felt etter hvor bredt panelet er
  - hurtigtasten skjules før navnet når det blir trangt
  - ingenting kuttes midt i et ord eller flyter over
- **Valg i Innstillinger → Utseende:** «Sidepanel: startside med verktøy (standard) eller faner øverst». Fanene øverst er dagens design, ryddet.

### 24.4 Sidefanen i Kode: «Chatter» i stedet for «Prosjekter +» (bilde 05)
- Overskriften «Prosjekter» med + fjernes i Kode. I stedet står bare overskriften **Chatter**.
- **Prosjekter dukker opp av seg selv.** Når du velger en prosjektmappe i meldingsfeltet eller på startsiden, kommer prosjektet automatisk i lista under Chatter, med trådene sine.
- **Tråder uten prosjekt** står under «Denne datamaskinen», som før (23.2).
- Å legge til et prosjekt uten å starte en tråd går fortsatt via «Velg prosjekt» i meldingsfeltet, via kommandopaletten og via sidefanens ⋯-meny (24.6). Det trengs ikke et eget + ved overskriften.
- Festet beholdes over Chatter (21.3).

### 24.5 Chat-modus: prosjekter og chatter, uten nettleserpanel
- Sidefanen i Chat har **Prosjekter** og **Chatter** slik den har i dag. Chat-prosjekter lages med + og navn (21.3).
- **Nettleser er ikke et panel i Chat.** Det står ikke i panelknappene, på startsiden i sidepanelet eller i menyen for å legge til et panel når du er i Chat.
- **Ikonene øverst i sidefanen ryddes** i begge moduser. Det gjelder søk, varsler og andre ikoner ved appnavnet. De står i én rolig rad med lik størrelse og lik avstand, og med skillelinjen fra 24.1 under toppfeltet.

### 24.6 Sidefanens ⋯-meny (bilde 04)
- Sidefanen får én ⋯-meny øverst, ved ikonene, som samler det som i dag er spredt:
  - **Organiser sidepanelet ›** med undervalg som grupper etter prosjekt eller dato, og fold alle eller åpne alle
  - **Sorter samtaler etter ›** med undervalg som sist oppdatert, opprettet og navn. Valget har hake
  - **Vis:** Prosjekter ✓ (og Festet), som kan slås av og på
  - **+ Ny seksjon:** en egen, navngitt seksjon i sidefanen som du kan dra tråder inn i, eller legge dem i via trådmenyen. Seksjonen kan få nytt navn, foldes og slettes. Når en seksjon slettes, blir trådene liggende der de var før
- Dagens knapp for grupper, sorter og fold (fra 21.7) går inn i denne menyen, slik at det ikke er to menyer for det samme.
- Menyen bruker `ContextMenu` med undermenyer, slik at piltaster og Esc virker, og den holder seg innenfor sidefanen som profilmenyen (23.6).

### 24.7 Krav til runden
- Alle valg fra 24.2 og 24.3 lagres i innstillingene og virker uten omstart.
- **Ingenting hopper:**
  - knappene i toppfeltet står fast
  - menyer åpnes og lukkes med et nytt klikk (fiksen i `ContextMenu`)
  - bevegelser bruker bare `transform` og `opacity`
  - redusert bevegelse respekteres
- Bildetaket i `npm run perf` skal ikke bli dårligere.
- **Hurtigtaster fortsetter å virke.** Det gjelder dem som i dag åpner Terminal, Filer, Endringer og Nettleser. De vises i tipsene og på startsiden i sidepanelet.
- Eksisterende UI-tester oppdateres der de bruker den gamle fanelinjen, rutens egen knappelinje eller «Prosjekter +» i Kode. Nye tester dekker 24.1 til 24.6.

## 25. Runde 11b: annotering i nettleseren og valg for Kode-startsiden (brukerønske 6. november 2026)

### 25.1 Annoter i nettleserpanelet
- Nettleserpanelet får en knapp **Annoter** i verktøyraden, med verktøytips og hurtigtast. Den virker på sider som er åpne i panelet, også på localhost.
- **Når du trykker,** fryses et skjermbilde av siden slik den er, og et lag med annoteringsverktøy legger seg over:
  - **Klikk:** en nummerert markør der du klikker, med en kort kommentar som du skriver i en liten boble
  - **Tegn:** penn eller rektangel for å ramme inn noe
  - **Tekst:** en fri kommentar på bildet
  - **Angre og Tøm.** Farger fra aksenten og temaet
- **«Ferdig»** setter sammen skjermbildet med markeringene til ett PNG-bilde, og legger det som vedlegg i meldingsfeltet til tråden som eier panelet. Kommentarene legges også inn som en kort, nummerert liste i meldingsfeltet, så modellen får dem som tekst. Du kan redigere teksten før du sender.
- **«Avbryt» eller Esc** lukker uten å legge til noe.
- **Gjenbruk det som finnes:** skjermbildet fra nettleseren på serveren (`browser.screenshot`) og vedleggene i meldingsfeltet. Ingen nye avhengigheter.
- **Bevegelse:** laget toner inn og ut med `opacity`, og redusert bevegelse respekteres.
- Uten tråd åpnes en ny tråd i samme prosjekt med vedlegget, eller knappen er dempet med et tips. Velg det som er ryddigst.

### 25.2 Valg for Kode-startsiden (ny tråd)
- Innstillinger → Kode har i dag «Enkel hilsen» og «Prosjektkort» uten prosjekt, og «Hilsen med prosjektkort» og «Bare hilsen» med prosjekt.
- **Valgene blir disse, med små skisser som i dag:**
  - **Tekst:** «Hva skal vi bygge?» eller «Hva skal vi jobbe med i *prosjekt*?» midt på skjermen
    - størrelse Liten, Middels eller Stor under valget
    - ikonet og teksten skalerer med vinduet (24.1)
  - **Token-historikk:** kalenderen og grafen for token-bruk midt på skjermen, i en rolig og kompakt form. Gjenbruk `HeatMap` og dataene fra Innstillinger → Bruk
  - **Prosjektboks:** én boks midt på skjermen
    - øverst prosjektene du har jobbet i nylig, som rader. Et klikk velger prosjektet
    - under dem teksten **Lokalt miljø**
    - nederst i boksen en rad for å koble til GitHub, med GitHub-ikonet, og status når den er koblet
- Valget gjelder både med og uten prosjekt. Med et prosjekt valgt viser Prosjektboks trådene i prosjektet øverst i stedet for nylige prosjekter, slik «Hilsen med prosjektkort» gjør i dag.
- **Gamle innstillinger går over til de nye:** greeting blir Tekst (Middels), og cards blir Prosjektboks.
- Meldingsfeltet nederst er det samme i alle valgene.

## 26. Runde 12: øktpanel, stablede paneler, informasjonskapsler og mappe som mangler (brukerønske 6. november 2026)

Referansebilde: `docs/design-ref/runde11/07-oktpanel-og-stabling.png`. Bildet viser form og oppførsel. Logoer, merkenavn og Remote Control kopieres ikke.

### 26.1 Prosjekt der mappen er slettet
Dette finnes fra runde 9:
- `Project.folderMissing`
- et varsel i sidefanen
- en linje i ruten med «Velg mappe på PC-en»
- serveren nekter å kjøre noe (409) til mappen er koblet til igjen

Strammes inn:
- **Trådene og prosjektnavnet blir stående og kan leses.** Det gjelder også søk, kopiering og eksport.
- **Ingen nye tråder i prosjektet** før det er koblet til en mappe igjen:
  - + ved prosjektet i sidefanen er dempet og har et tips
  - prosjektvelgeren viser prosjektet dempet med «Mappen mangler»
  - meldingsfeltet i en slik tråd er låst, og linjen med «Velg mappe på PC-en» står over det
- **Når mappen er valgt igjen,** låses alt opp uten omstart.

### 26.2 Øktpanelet
Et nytt panel, **Økt**, som kan åpnes fra panelknappene (24.2) og fra startsiden i sidepanelet (24.3). Det viser tråden som har fokus. Det har seksjoner som kan foldes:

- **Miljø**
  - Denne datamaskinen (Lokal), med en knapp for å endre miljø der det finnes valg
  - prosjektmappen med navn og kort sti, og et klikk åpner Filer
  - ingen Remote Control
- **Kontekst**
  - hvor mye av modellens kontekstvindu tråden bruker, i prosent og som en liten stolpe
  - når seksjonen foldes ut, vises hva konteksten består av: systemprompt og harness, AGENTS.md, minner, skills, verktøy og meldinger
  - tallene er estimater og merket slik når det er tilfellet
- **Tilkoblinger**
  - antall tilkoblinger, og når seksjonen foldes ut: leverandøren og modellen, GitHub og MCP-servere eller verktøy som finnes, med status
- **Oppgaver i bakgrunnen**
  - det som kjører for tråden, som team-agenter, terminalprosesser og servere, med tid og en stoppknapp
  - nederst «Avsluttet: N», som kan foldes ut

Alt panelet viser kommer fra ekte data. Det som ikke finnes, vises ikke.

### 26.3 Paneler som stables bortover og nedover
- Med stilen «Hver for seg» for panelknapper (24.2) kan flere paneler være åpne samtidig. De stables slik bildet viser:
  - side om side
  - eller over og under hverandre, for eksempel Terminal over og Nettleser under
- **Hvert panel har en egen, slank topplinje** med:
  - faner der det gir mening, som terminaler og nettleserfaner, og +
  - ⋯
  - Maksimer og Gjenopprett
  - Lukk
- **Størrelse:** skillene kan dras, og størrelsene huskes per tråd eller prosjekt. Et dobbeltklikk på skillet deler plassen likt.
- **Flytting:** du kan dra et panel til en annen plass, til høyre for eller under et annet. Når du drar, viser en tydelig målflate hvor det havner.
- **Med stilen «Samlet»** fungerer panelet som i 24.3.
- **Krav:** ingenting hopper, og bare `transform` og `opacity` animeres. Når du drar i et skille, endres bredden direkte uten animasjon. Bildetaket i `npm run perf` skal ikke bli dårligere.

### 26.4 Importer informasjonskapsler til nettleserpanelet
- Dette kommer i tillegg til importen av bokmerker og historikk fra 23.1. Med denne importen er du innlogget på nettstedene dine i nettleserpanelet.
- **En dialog** som på bildet:
  - **Tittel:** «Forbli innlogget på nettstedene dine»
  - **Tre løfter:**
    - Bare informasjonskapsler og nettstedsdata, aldri passord
    - Du velger nettstedene
    - Ingenting forlater denne datamaskinen
  - **Knapper:** «Ikke vis igjen», «Ikke nå» og «Importer informasjonskapsler»
- **Hvor dialogen vises:** første gang nettleserpanelet åpnes, til du har valgt noe, og alltid fra Innstillinger → Nettleser.
- **Flyten:**
  1. Velg nettleserprofil, Chrome, Chromium eller Firefox, blant dem som finnes på maskinen.
  2. Velg nettsteder i en liste med søk og «Velg alle». Ingenting er valgt på forhånd.
  3. Se oppsummeringen og importer.
- **Sikkerhet:**
  - Appen leser bare cookie-databasen, og bare når du har trykket. Den leser aldri passord, kort eller autofyll.
  - Chrome og Chromium på Linux krypterer informasjonskapslene. Nøkkelen hentes fra systemets nøkkelring via `secret-tool`, og bare i det øyeblikket du importerer. Finnes ikke `secret-tool`, sier dialogen det tydelig.
  - Informasjonskapslene lagres bare i appens egen nettleserprofil, i appens datamappe.
  - Innstillinger → Nettleser har «Glem importerte informasjonskapsler», og kan vise og slette dem per nettsted.
  - **Agenter og innloggede nettsteder:** agenter som styrer nettleserpanelet, kan bruke innloggingene. Derfor står valget «Spør før agenter bruker innloggede nettsteder» på som standard. En handling fra en agent på et nettsted med importerte informasjonskapsler går da via godkjenningen som finnes.
- **Testing:** bare mot falske profilmapper som testen lager:
  - en Chrome-database med v10-kryptering
  - en Firefox-`cookies.sqlite`
  - en falsk `secret-tool` på `PATH`
  - aldri brukerens ekte profiler eller nøkkelring

## 27. Runde 13: forstå hva agenten gjør, og verktøyvalg i Chat (brukerønske 6. november 2026)

### 27.1 En Kode-tråd skal være lett å forstå
Målet er at en som ser en Kode-tråd, med en gang forstår hva agenten gjør nå og hva den har gjort: om den leser filer, søker i koden, søker på nettet, kjører kommandoer, redigerer filer, venter på godkjenning eller jobber med et team.

- **Gå gjennom hele visningen av en Kode-tur med en demo-modell som bruker alle verktøyene:**
  - verktøysteg
  - grupper av steg
  - glimt-tekst (23.10)
  - godkjenninger
  - diff-er
  - terminalutdata
  - team-agenter
  - feil
- **Hvert steg** har:
  - et tydelig ikon per type: les, søk, nett, kommando, rediger, opprett, slett, team, godkjenning
  - et kort verb på norsk, for eksempel «Leste», «Søkte etter», «Kjørte», «Endret» og «Søkte på nettet»
  - hva steget gjaldt: fil, mønster, kommando eller URL
  - resultat i kortform, for eksempel «3 treff», «exit 0» eller «+12 −3»
- Detaljene foldes ut med et klikk.
- **Steg i rad av samme type** samles, for eksempel «Leste 6 filer», og kan foldes ut.
- **Mens noe kjører**, står én linje nederst som sier hva agenten gjør nå, med glimt-tekst.
- **Når turen er ferdig**, står en kort oppsummering: hvor lenge den tok, hvor mange filer som ble endret, og hvor mange kommandoer som ble kjørt. Et klikk på oppsummeringen åpner Endringer.
- **Godkjenninger og feil** skiller seg tydelig ut, men rolig, uten alarmfarger på alt.
- **Agentens tekst og stegene** har et klart, visuelt skille mellom seg.
- Det samme språket brukes i sidefanen og i fanetitler («Jobber…», «Venter på deg»).
- Lag en kort intern skrivestil-liste for verbene i `docs/research/kode-steg.md`, så nye verktøy følger samme mønster.

### 27.2 Verktøyvalg i Chat
- Meldingsfeltet i Chat får en verktøyknapp, for eksempel et ikon ved +, som åpner en liten meny med brytere. Valgene huskes per tråd, og standarden settes i Innstillinger → Chat.
- **Verktøyene:**
  - **Nettsøk:** modellen kan søke på nettet.
    - Leverandøren sin innebygde nettsøk brukes når modellen støtter det.
    - Ellers brukes appens egen nettleser mot en søkemotor-URL som du kan sette i Innstillinger.
    - Når nettsøk ikke er tilgjengelig, er bryteren dempet med en forklaring.
  - **Les nettsider:** modellen kan hente en URL du limer inn.
  - **Artifacts:** modellen kan lage HTML-artifacts.
  - **Minne:** modellen kan bruke og oppdatere minnet ditt (22).
- **Aktive verktøy** vises som små brikker i meldingsfeltet, med × for å slå av.
- **Når modellen søker på nettet**, viser Chat «Søker på nettet…» med glimt-tekst, og etterpå kildene som små kort med favicon og tittel.
- **Demo-modellen** kan simulere et nettsøk med tydelig merkede demo-kilder, så alt kan prøves uten API.
- **Ingen ekte søk i tester.** Testene bruker en lokal, falsk søkeside.

## 28. Designrunde: polering og kontroll av hele UI-et (brukerønske 6. november 2026)
En egen design- og polish-agent går gjennom hele appen etter runde 11 til 13 og retter opp. Den ser etter dette:
- **Overlapp og klipping:**
  - tekst eller knapper som går over hverandre
  - menyer eller popovere som havner utenfor vinduet eller bak noe
  - varsler som dekker kontroller (kjent: toast over fanelinjen i fullvisning)
  - ting som kuttes midt i et ord
- **Ikoner:**
  - samme strek, størrelse og optiske vekt overalt
  - riktig ikon for riktig betydning
  - ingen doble ikoner for det samme
  - ingen ikoner uten tips
- **Rytme:** avstander, justering, høyder på rader, hjørneradier og skillelinjer følger tokens.
- **Temaer:**
  - mørkt og lyst tema og minst to aksentfarger
  - kontrast på dempet tekst (WCAG AA for vanlig tekst)
  - fokusringer for tastatur der de trengs (men ikke på meldingsfeltet, 23.7)
- **UX som gir mening:**
  - hver knapp gjør det navnet sier
  - tomme tilstander er nyttige
  - samme handling heter det samme overalt
  - ingen blindveier
  - ingen falske knapper
- **Bredder:** 1920, 1366, 1100 og under 860 px, med sidefane og sidepanel både åpne og lukket.
- **Bevegelse:**
  - ingenting hopper
  - redusert bevegelse respekteres
  - `npm run perf` blir ikke dårligere
- **Arbeidsmåte:** agenten tar headless-skjermbilder før og etter og lagrer dem i `docs/screenshots/design-runde/`. Den lager en liste over funn med alvorlighetsgrad i `docs/review/design-runde.md`, og retter dem.

## 29. Produksjon: Agentic Desktop som Electron-app (brukerønske 6. november 2026)

Brukeren har sagt ja til å porte appen til Electron og legge den ferdige appen i appbiblioteket i GNOME. Localhost-versjonen (`npm start`) skal fortsette å virke som før. Electron er bare et nytt skall rundt den samme serveren og det samme web-UI-et.

### 29.0 Maskinen og minnet
- Ubuntu 26.04, GNOME på Wayland, 16 kjerner og 48 GB RAM, RTX 2080 og én skjerm på 1920×1080 i 240 Hz.
- **Minnet skal aldri gå under 4 GB ledig.** Hver agent sjekker `MemAvailable` i `/proc/meminfo` før tunge steg som bygg, Electron, Chrome og hele testpakker. Er det under 8 GB ledig, venter agenten eller kjører mindre om gangen. Koordinatoren overvåker også minnet.
- Det finnes ingen `libfuse2`, bare fuse3. Derfor installeres appen som en utpakket mappe med en `.desktop`-fil, ikke som en AppImage som trenger FUSE. En AppImage kan likevel lages som en fil man kan dele.

### 29.1 Skallet
- Electron legges inn som `devDependency` med fast versjon, i en ny mappe `desktop/` med `main.ts` og `preload.ts`. Bruk den nyeste stabile Electron-versjonen som er minst to uker gammel.
- **Serveren kjører i en egen prosess**, med `utilityProcess` eller Electrons Node med `ELECTRON_RUN_AS_NODE`. Den lytter på 127.0.0.1 med tilfeldig port og et nytt token, og vinduet laster `http://127.0.0.1:<port>/#token=…`. Rendereren snakker HTTP og WS med serveren som i dag. Den har ingen `nodeIntegration`, den har `contextIsolation`, `sandbox` og en streng CSP, og den kan ikke navigere til andre opphav eller åpne vinduer uten videre. Lenker til nettsider åpnes i nettleserpanelet eller i systemets nettleser.
- **Serveren bygges til JavaScript.** Electrons Node kan ha en annen versjon enn Node 26 og mangle typestripping og `node:sqlite`. Agenten sjekker dette først.
  - Mangler `node:sqlite`, velges den minst risikable løsningen, og valget forklares.
  - Bruk verktøy som allerede finnes i prosjektet, som `tsc` eller Vites bundler, før nye avhengigheter.
  - `node-pty` bygges for Electrons ABI.
- **Data:**
  - Samme datamappe som localhost-versjonen (`~/.local/share/agentic-desktop`) og samme konfig (`~/.config/agentic-desktop`), så trådene følger med.
  - Én instans om gangen (`requestSingleInstanceLock`).
  - Hvis localhost-serveren kjører mot den samme datamappen, skal appen si det tydelig og ikke skrive i den samtidig.
  - **Knappen «Avslutt nettleserversjonen og åpne appen» (6. november 2026):**
    - En localhost-server skriver en tilfeldig stoppnøkkel i `instance.json` (mode 0600).
    - Hovedprosessen i appen leser nøkkelen fra sin egen datamappe og sender `POST /api/instance/stop` med nøkkelen i en header.
    - Serveren avslutter som ved Ctrl+C, og appen starter sin egen server.
    - Endepunktet godtar bare riktig nøkkel, riktig `Host` og ingen `Origin`, så en nettside kan ikke bruke det.
    - Bare en server som er startet fra denne datamappen, har nøkkelen. Appens egen server har verken nøkkel eller endepunkt.
- **Vindu:**
  - uten ramme, med vårt eget toppfelt, som kan dras (`-webkit-app-region`)
  - knappene minimer, maksimer og lukk i plassen `window-controls` (SPEC 24.2), via preload
  - riktig app-id (`io.github.AgenticDesktop`), slik at GNOME viser riktig ikon og navn i dokken
  - vindusstørrelsen huskes
  - Wayland skal brukes uten XWayland, med `--ozone-platform-hint=auto`
- **Livsløp:**
  - Når vinduet lukkes, stopper serveren og alle barneprosessene (terminaler, servere og Chrome). Bruk kjente PID-er.
  - Hvis serveren krasjer, vises en tydelig feilside med «Start på nytt».
- **Ikon:** et eget app-ikon i SVG og PNG i flere størrelser, i appens egen stil, uten merker fra andre.

### 29.2 Pakking og installasjon
- Bygg med `electron-builder` (fast versjon) for Linux: en utpakket mappe, `.deb` og AppImage.
- `npm run dist` bygger web, server og Electron-pakken til `dist-desktop/`.
- **`scripts/install-local.ts`**:
  - kopierer den utpakkede mappen til `~/.local/opt/agentic-desktop/`
  - skriver `~/.local/share/applications/io.github.AgenticDesktop.desktop` med ikon, navn «Agentic Desktop», kategori `Development` og `StartupWMClass`
  - legger ikonene i `~/.local/share/icons/hicolor/…`
  - har `--uninstall`, som fjerner alt det har lagt inn
  - **bare koordinatoren kjører dette mot den ekte HOME-mappen**
- **Størrelse:** pakken er så liten som rimelig. Ta med bare det som trengs i produksjon, ingen testfiler og ingen dev-avhengigheter, og asar der det går.

**Sandkassen og AppArmor (6. november 2026).** Ubuntu 24.04 og nyere har `kernel.apparmor_restrict_unprivileged_userns=1`: et program uten egen AppArmor-profil får ikke lage brukernavnerom, som Chromium-sandkassen trenger. GNOME starter apper som «unconfined». Da ga Chromium opp før `main.js` i det hele tatt kjørte, med «The SUID sandbox helper binary was found, but is not configured correctly», og vinduet kom aldri.
- **Hvorfor testene ikke så det:**
  - Agentenes skall kjører under AppArmor-profilen `claude-desktop`, som har `userns`, og alle barneprosesser arver den.
  - Playwrights `_electron.launch` legger dessuten til `--no-sandbox` på Linux uten `chromiumSandbox: true`.
  - `desktop/test/10-gnome-start.test.ts` installerer nå pakken i en midlertidig HOME og starter `Exec`-linja med `aa-exec -p unconfined`, slik GNOME gjør. Den feilet før rettingen.
  - Hjelperen `launch()` kjører med sandkassen når maskinen tillater det.
- **Startskriptet** heter `agentic-desktop`, og Electron selv ligger ved siden av som `agentic-desktop-bin` (fra bygg 30). Alt som starter `agentic-desktop` går dermed gjennom skriptet: `.desktop`-fila, `/usr/bin`-lenken i .deb-pakken, AppImage og en gammel `Exec`-linje som GNOME Shell fortsatt holder i minnet. `agentic-desktop-start` (bygg 29) er en lenke til skriptet. Ved hver start sjekker det om sandkassen kan starte:
  - regelen er av og brukernavnerom virker
  - skriptet selv arver en profil med `userns`
  - profilen `agentic-desktop` er lastet, gjelder stien `~/.local/opt/agentic-desktop/agentic-desktop-bin` og gir `userns` (prøvd med `aa-exec -p agentic-desktop`)
  - eller `chrome-sandbox` er setuid root
  
  Er ett av dem oppfylt, starter appen med sandkassen som før. Ellers starter den med `--no-sandbox`. Til slutt bytter skriptet seg ut med appen (`exec`), så det blir ingen ekstra prosess. Sjekken tar rundt 30 ms. Når brukeren legger inn profilen, er sandkassen på igjen ved neste start. `agentic-desktop --sandbox-status` viser valget og hvorfor.
- **Uten sandkassen:**
  - UI-et laster bare appens egne filer fra den lokale serveren.
  - Ingen nettside åpnes i Electron. Nettleserpanelet får serverens headless Chrome (`AD_BROWSER_PANEL=chrome`), og `browser-view.ts` nekter i tillegg å lage sider.
  - Serverens Chrome (`channel: "chrome"`, `chromiumSandbox: true`) har sandkasse også fra en prosess som er «unconfined», for Google Chrome har egen AppArmor-profil og en `chrome-sandbox` som er setuid root. Det gjelder både panelet og nettsøket (`web-browser.ts`). Testen måler seccomp-modus 2 og et eget brukernavnerom i rendererne.
- **GNOME Shell husket den gamle stien (8. november 2026).** Bygg 29 startet fint med sin egen `Exec`-linje, men gnome-shell hadde kjørt siden før oppdateringen og startet fortsatt bygg 28s `Exec`, rett på Electron. Journalen viste den samme FATAL-feilen. Derfor fikk skriptet navnet som alle gamle stier peker på.
- **I appen:** Innstillinger → Om viser én rolig linje om at sandkassen er av og hvorfor, med kommandoen som legger inn profilen fra installasjonen (`resources/apparmor/agentic-desktop`) og en Kopier-knapp. Det kommer ingen varsler ved oppstart. `install-local.ts` skriver den samme kommandoen.
- **Profilen** (`desktop/apparmor/agentic-desktop`) er laget som Ubuntus egne profiler for Chrome og VS Code: `flags=(unconfined)` med `userns`. Den legges inn med sudo av brukeren selv. Agentene gjør det aldri.

### 29.3 Nettleserpanelet i Electron
- I dag styrer serveren en headless Chrome, og panelet viser den. I Electron kan panelet være en ekte `WebContentsView` i vinduet, med Playwright koblet til via CDP. Det skal vurderes og helst bygges, men uten å svekke sikkerheten fra runde 12 og 13:
  - Panelets innlogginger og importerte informasjonskapsler ligger i en egen `session`-partisjon.
  - Nettsøk og nettlesing (`web-browser.ts` og `web-guard.ts`) bruker fortsatt sin egen, rene nettleser med adressevakten.
  - CDP-porten lytter bare på 127.0.0.1, med tilfeldig port, og bare mens appen kjører.
  - Hvis det ikke går trygt eller stabilt, beholdes dagens løsning med headless Chrome i Electron-versjonen også, og det skrives ned hvorfor.
- Annotering, faner, nedlastinger og godkjenninger for innloggede nettsteder skal virke som før.

**Bygget (6. november 2026).** Panelet er en ekte `WebContentsView` i Electron-appen. Localhost-versjonen har fortsatt headless Chrome og bildet.
- **Ingen CDP-port i det hele tatt.** Valget er strengere enn punktet om 127.0.0.1 over. Hver side i panelet har sin egen `webContents.debugger`. Hovedprosessen (`desktop/browser-view.ts`) spiller nettleser-målet og gir serveren CDP over en `MessageChannelMain` som bare finnes mellom hovedprosessen og serverprosessen. Serverens Playwright kobler til med `chromium.connectOverCDP(transport)` (`server/src/browser-panel.ts`). Ingenting lytter på en port eller en socket.
- **UI-et kan ikke nås.** Broen kobler aldri en debugger til appens eget vindu, og lister bare panelets sider. Kommandoer til en side går gjennom en liste over hva som er lov: bare domener på sidenivå, `Page.navigate` bare til http og https, og ingen `Target`- eller `Browser`-kommando som kan koble til et annet mål, liste mål, åpne eller lukke vinduer eller nå nettleseren. Listen er nødvendig: uten den svarer panelets egen debugger på `Target.getTargets` med alle mål. Testen `desktop/test/09-nettleserpanel.test.ts` prøver alle disse veiene mot UI-et.
- **Sidene** ligger i partisjonen `persist:browser-panel`, har sandbox, ingen Node og ingen preload, får bare navigere til http og https, og alle tillatelser er avslått unntatt å skrive til utklippstavlen. Importerte informasjonskapsler legges inn med `Storage.setCookies`, som broen oversetter til partisjonens `session.cookies`. `agentic-imported-cookies.json` har egne køer for Chrome-profilen og partisjonen, så begge får sin kopi. Når Lagring tømmer `chrome-profile/`, tømmes partisjonen neste gang panelet brukes.
- **Viewet** lages først når panelet åpnes eller agenten bruker nettleseren. UI-et sender rammen til panelet ved endring av størrelse, stabling, fullvisning og når sidepanelet skjules. Når en meny, et verktøytips, en dialog, et varsel eller annoteringen ligger over panelet, vises et stillbilde av siden mens viewet står til side. En side som ikke vises, parkeres utenfor vinduet med sin siste størrelse, så agenten kan klikke og ta bilder i den. Når panelet er lukket og agenten ikke har brukt nettleseren på en stund, frigjøres sidene etter 30 sekunder, ellers etter den vanlige ventetiden.
- `npm start` og vinduer uten broen, som en rute i eget vindu, får bilder som før. `AD_BROWSER_PANEL=chrome` gir serverens egen headless Chrome også i Electron.
- **Minne (PSS for hele prosesstreet, målt under xvfb):** panelet med én enkel side koster rundt 56 MB som `WebContentsView`, mot rundt 270 MB med serverens headless Chrome. Uten panelet er det ingen forskjell, og playwright-core lastes først når nettleseren brukes.
- **Kjent grense:** mens vinduet er skjult i statusfeltet eller minimert, tegnes ikke sidene. Agenten kan fortsatt navigere, lese og klikke, men et skjermbilde svarer straks med en feil som sier at vinduet må vises.

### 29.4 Testing
- Alt testes **uten vinduer på brukerens skjerm**, med `xvfb-run` (finnes på maskinen) eller `--ozone-platform=headless`, og Playwrights `_electron`.
- Midlertidige `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME` og `AD_DATA_DIR`.
- **Nye tester:**
  - appen starter
  - serveren kjører
  - vinduskontrollene virker
  - én instans om gangen
  - serveren og barneprosessene stopper når appen lukkes
  - feilsiden når serveren krasjer
  - den pakkede appen starter fra `dist-desktop/`
- `npm test`, `npm run test:ui`, `npm run e2e` og `npm run perf` mot localhost-versjonen skal fortsatt være grønne.

### 29.5 Optimalisering
Når skallet og pakken virker, kommer en egen optimaliseringsrunde. Agentene har hvert sitt område og rører ikke hverandres filer:
- **Oppstart og minne i Electron-appen:** tid til første bilde, tid til appen kan brukes, minne i hvile og etter en lang tråd, og ingen prosesser som lekker.
- **Web-bunten:** størrelse, lazy-lasting av tunge deler (CodeMirror, xterm og innstillinger) og hva som lastes ved oppstart.
- **Scrolling og rendering i lange tråder:** den kjente svakheten med knappene under hver melding, målt mot 240 Hz-målet.
- **Serveren:** spørringer i SQLite, strømming og minne over tid.

Hver agent måler før og etter, skriver tallene i `docs/perf/` og beholder bare endringer som faktisk gjør det bedre.

### 29.6 Ikon i statusfeltet, og et godt app-ikon (brukerønske 6. november 2026)
- **Lukk legger appen i statusfeltet.** Når du trykker X, skjules vinduet. Appen fortsetter å kjøre, med et ikon i statusfeltet øverst i GNOME. Ubuntu har utvidelsen `ubuntu-appindicators` på, så Electrons `Tray` vises der.
  - **Menyen i statusfeltet:** Vis Agentic Desktop, Ny tråd, en linje med hvor mange tråder som jobber eller venter på deg (bare når det finnes noen), og Avslutt.
  - **Et klikk på ikonet** viser vinduet, og holder det på samme sted og i samme størrelse som før.
  - **Ikonet viser status:** en liten prikk når noe jobber, og en annen når noe venter på godkjenning. Det skal være rolig og ikke blinke.
  - **Første gang** vinduet lukkes til statusfeltet, kommer et kort varsel én gang: «Agentic Desktop kjører videre i statusfeltet».
  - **Innstillinger → Generelt:** «Når vinduet lukkes: legg i statusfeltet (standard) eller avslutt». Ctrl+Q og Avslutt i menyen avslutter alltid helt.
  - **Uten statusfelt-støtte** avslutter X appen som vanlig, så den aldri blir borte uten ikon.
- **App-ikonet:**
  - Ikonet skal være gjennomtenkt og eget for Agentic Desktop, ikke generisk og uten merker fra andre. Det skal se bra ut i dokken, i appbiblioteket og i Alt+Tab, både på lys og mørk bakgrunn.
  - Det skal ha samme stil som appen, med appens aksent og formspråk, og det skal være lesbart helt ned til 16 px.
  - **Statusfelt-ikonet:** en enkel symbolsk versjon, ensfarget som GNOME-ikonene i statusfeltet. Både mørk og lys variant, eller en symbolsk SVG.
  - **Størrelser:** 16, 24, 32, 48, 64, 128, 256 og 512 px, og SVG.
  - **Valg av ikon:** lag 3 til 4 retninger som skisser. Velg den beste med en kort begrunnelse, og vis alle i `docs/screenshots/electron/ikoner.png`, så brukeren kan be om en annen.

### 29.7 Minnebudsjett (brukerønske 6. november 2026)
- Brukeren synes ChatGPT desktop bruker for mye minne: rundt 3 GB i hvile.
- Agentic Desktop skal ligge langt under det. Alle prosessene til sammen, i hvile med én tråd åpen og uten nettleserpanel, skal bruke **under 500 MB** (sum av PSS). Prosessene er Electron hoved, renderer og GPU, serverprosessen og eventuelle hjelpere. I statusfeltet med skjult vindu skal summen være enda lavere.
- **Måling, 6. november 2026:** localhost-serveren bruker rundt 150 MB RSS i hvile.
- Headless Chrome for nettleserpanelet og den rene nettleseren for nettsøk starter bare når de trengs, og lukkes når de har stått ubrukt en stund. De regnes ikke med i hvilebudsjettet. Det skal måles hva de koster når de er i bruk.
- Optimaliseringsagenten for oppstart og minne måler dette med PSS fra `/proc/<pid>/smaps_rollup` for hele prosesstreet. Den rapporterer tallene og holder budsjettet.

## 30. Runde 14: nøkler i nøkkelringen, nytt ikon, gafler, arkiv og mappe som mangler (brukerønske 9. november 2026)
Målet er 0.10.0. Koordinatoren bumper versjonen og bygger. Det installerte skrivebordsprogrammet oppdateres ikke i denne runden.

### 30.1 API-nøkler kryptert, aldri i klartekst
- **I dag** ligger API-nøklene og GitHub-tokenet som JSON i `keys.json` i datamappen, med rettighetene 0600 (`server/src/secrets.ts`). Fila er ikke kryptert.
- **Nytt:** nøklene lagres i systemets nøkkelring (Secret Service, det vil si GNOME-nøkkelringen) og ingen andre steder på disken.
  - Det skal virke både i appen og i localhost-versjonen.
  - Maskinen har ikke `secret-tool`, men har `python3`, `gi` og `Secret-1.typelib`. Forslaget er derfor en liten Python-hjelper som serveren kaller, med `gi.repository.Secret`, et eget skjema (`io.github.AgenticDesktop.ApiKey`, med attributtet `provider`) og nøkkelen gjennom stdin eller stdout, aldri i argumentlista.
  - Electrons `safeStorage` er et alternativ bare for appen. Agenten velger og begrunner valget i rapporten.
  - Ingen nye npm-pakker. `keytar` og lignende er ikke lov.
- **Flytting:** finnes `keys.json`, flyttes hver nøkkel inn i nøkkelringen ved oppstart. Fila slettes bare når alle nøklene er lagret og lest tilbake. Går noe galt, blir fila stående, og Innstillinger sier tydelig hvorfor.
- **Uten nøkkelring** (ingen Secret Service, eller den er låst og brukeren avbryter): nøkkelen gjelder bare til appen lukkes, og Innstillinger → Leverandører viser én rolig linje om det. Nøkkelen skrives aldri i klartekst.
- **Uendret:** nøkler sendes aldri tilbake til UI-et. Det får bare vite om en nøkkel er satt. Nøkler havner ikke i logger, hendelser eller i miljøet til barneprosesser.
- **Feltet for nøkkelen** viser prikker mens man skriver (`type="password"`), med en øyeknapp som viser og skjuler teksten. Det gjelder alle felt for nøkler og tokener, også GitHub-tokenet. Ingen autofyll eller stavekontroll (`autocomplete="off"`, `spellcheck=false`).
- **Testene rører aldri brukerens ekte nøkkelring.** De kjører under `dbus-run-session` med en egen `gnome-keyring-daemon` i en midlertidig HOME, eller med en falsk Secret Service.

### 30.2 Nytt appikon og valg av ikon
- **Brukeren er ikke solgt på monogrammet (A).** Nytt standardikon tar utgangspunkt i merket midt på Kode-startsiden: snakkeboblen med terminal (`IconMark` i `web/src/ui/Home.tsx`).
  - Ikonet tegnes på nytt som et skikkelig appikon i samme stil som dagens: rolig flate, ingen merkevarer.
  - Det skal være lesbart fra 16 til 512 px, og også finnes som symbolsk ikon til statusfeltet.
  - Tidligere utkast ligger i `desktop/icons/retninger/`.
- **Innstillinger → Utseende:** man kan velge mellom flere ikoner, for eksempel snakkeboble med terminal (standard), monogram og ett eller to til, med en liten forhåndsvisning av hvert.
  - Valget endrer vinduets ikon, ikonet i statusfeltet og favicon i localhost-versjonen med en gang.
  - Ikonet i appbiblioteket kommer fra ikonfilene som `install-local.ts` legger i `~/.local/share/icons`. Appen kan bytte dem bare når den er installert slik (markørfila finnes), og sier ellers at valget gjelder vinduet og statusfeltet.
  - Ikonfilene genereres av `desktop/icons/render.ts`.

### 30.3 Gafler (fork) som i Claude Code
- Gafler finnes allerede: ⋯-menyen på tråden («Hele tråden» og «Fra siste melding»), `/fork` og `fork` per melding i `Conversation.tsx`. Gå gjennom dem og fyll hullene, ikke bygg på nytt:
  - **Fra en bestemt melding:** man skal kunne gafle fra hvilken som helst melding, synlig i knapperaden under meldingen. Den nye tråden får historikken til og med den meldingen.
  - **Sammenheng:** en gaffel viser at den kom fra den andre tråden, i sidefanen og øverst i tråden, med lenke tilbake.
  - **Navn:** tydelig standardnavn, for eksempel «‹tittel› (gaffel)».
  - **Kode-tråder:** gaffelen beholder prosjektet. Filene på disken endres ikke av en gaffel.

### 30.4 Arkiv
- Arkivering finnes (sidefanen, arkivert-telling). Kontroller at man kan arkivere og hente tilbake én tråd og alle trådene i et prosjekt, og at arkivet er lett å finne. Fyll hullene.

### 30.5 Prosjektmappe som er flyttet eller har fått nytt navn
- **I dag** viser `FolderMissing` i `web/src/ui/Pane.tsx` en linje over meldingsfeltet.
- **Nytt:** i en tråd der prosjektmappen mangler, byttes **hele meldingsfeltet** ut med en rolig bar i samme høyde og form. Baren har én kort tekst («Fant ikke mappen ‹sti›. Den er flyttet, har fått nytt navn eller er slettet.») og to knapper:
  - **Velg prosjektmappe:** som dagens «Velg mappe på PC-en», og kobler prosjektet til mappen igjen.
  - **Arkiver chattene:** arkiverer alle trådene i prosjektet, med en angremulighet i en toast.
- **Etter et nytt navn:** prosjektet fortsetter med samme tråder, og meldingsfeltet kommer tilbake med en gang.
- Ellers samme oppførsel i Kode-startsiden og prosjektvelgeren som i dag.

### 30.6 Det som ble valgt (presiseringer fra runde 14)
- **Nøkkelringen (30.1):**
  - Valget er Python-hjelperen med `gi.repository.Secret` (`server/src/keyring.ts`), ikke Electrons `safeStorage`. Den virker likt i appen og i localhost-versjonen, nøklene ligger i GNOME-nøkkelringen som brukeren kjenner fra Passord og nøkler, og den trenger ingen nye pakker.
  - Programteksten sendes med `python3 -I -c`, forespørselen og nøkkelen går på stdin, og svaret kommer på stdout. Hjelperen får bare `PATH`, `HOME`, `LANG`, `LC_ALL`, `DBUS_SESSION_BUS_ADDRESS` og `XDG_RUNTIME_DIR` fra miljøet.
  - Elementene lagres med skjemaet `io.github.AgenticDesktop.ApiKey` og attributtene `provider` og `application=io.github.AgenticDesktop`. Søket går på `application`, fordi gnome-keyring ikke finner skjemanavnet i en låst samling. Etiketten er «Agentic Desktop: API-nøkkel for ‹leverandør›» eller «Agentic Desktop: GitHub-token».
  - Serveren leser nøkkelringen ved start og venter høyst fire sekunder. Svarer den senere (for eksempel etter at brukeren har låst den opp), sendes `keyring.changed` til alle vinduer. Skrivinger går i rekkefølge, og appen venter på dem før den lukkes.
  - `AD_KEYRING` velger `secret-service` (standard), `memory` (testene) eller `none`. Under `node --test` er standarden `memory`, så ingen test kan nå den ekte nøkkelringen ved et uhell.
  - Innstillinger → Leverandører viser én linje bare når noe er galt (ingen nøkkelring, låst, feil, eller `keys.json` ligger igjen), med **Prøv igjen**. Prøv igjen leser nøkkelringen på nytt, flytter `keys.json` og skriver nøkler som ble lagt inn i økta.
  - Fjernes eller byttes en nøkkel mens `keys.json` ligger igjen, tas den gamle verdien ut av fila, så den aldri kommer tilbake. Ingenting nytt skrives til fila. En fil som ikke kan leses, røres ikke.
  - Alle felt for nøkler og tokener er `SecretInput` (`web/src/ui/SecretInput.tsx`). Øyeknappen holder fokuset i feltet, og feltet viser prikker igjen når det tømmes.
- **Appikonet (30.2):**
  - Fire ikoner: Snakkeboble (standard), Snakkeboble lys, Monogram og Terminal. Navnene står i `APP_ICONS` i `shared/protocol.ts`, kildene i `desktop/icons/variants.ts`.
  - `desktop/icons/render.ts` lager `png/<id>/` for hvert ikon (app-ikoner i åtte størrelser, statusfeltikonene, `app.svg` og `symbolic.svg`), standardikonet også øverst i `png/` for pakken, og `web/public/app-icons/<id>.svg` og `<id>-tab.svg`.
  - Valget lagres i innstillingene (`appIcon`). Fanen i nettleseren får det med en gang, og `public/theme.js` setter det før appen starter. Electron-appen husker valget i `desktop-state.json`, så vinduet har det fra start.
  - Ikonet i appbiblioteket byttes bare når appen kjører fra en mappe med markørfila til `install-local.ts`. Da skrives bare de ti ikonfilene, og bare de som er ulike. Ved start legges det valgte ikonet inn igjen, så en ny `install-local` ikke tar valget bort. Utseende sier hva valget gjelder.
- **Gafler (30.3):**
  - Ordet i appen er «gaffel»: **Lag gaffel** (Av hele tråden, Fra siste melding) i trådmenyen, **Gaffel herfra** under hver melding, og «Lag gaffel av tråden» i paletten og menylinjen.
  - Navnet er «‹tittel› (gaffel)», så «(gaffel 2)» og videre. En gaffel av en gaffel får ikke to endelser.
  - `Thread.forkedFrom` husker tråden, tittelen den hadde, meldingen og slaget. Sidefanen viser en liten gaffel foran tittelen, og hoverkortet, toppfeltet, tittelkortet og toppen av tråden har lenke tilbake. Fra en melding åpner lenken originalen ved den meldingen.
  - En tynn strek med «Gaffelen starter her» står foran den første meldingen som er skrevet i gaffelen, eller nederst før noen er skrevet.
- **Arkivet (30.4):**
  - `POST /api/threads/archive` arkiverer eller henter tilbake de nevnte trådene, eller alle i et prosjekt eller Chat-prosjekt. En tråd som kjører, blir stående, og toasten sier det.
  - Prosjektmenyen har **Arkiver alle trådene** og **Vis arkiverte**, Chat-prosjekter har **Arkiver alle chattene**. All arkivering har **Angre** i toasten.
  - Arkivet ligger nederst i sidefanen, i ⋯-menyen øverst i sidefanen, i den smarte sidefanen, i paletten og i menylinjen. Arkivsiden grupperer etter prosjekt, har **Gjenopprett alle** per prosjekt, og tittelen åpner tråden uten å hente den tilbake. Et tomt prosjekt viser hvor mange som er arkivert.
- **Mappen mangler (30.5):**
  - Baren (`FolderMissingBar`) har formen til meldingsfeltet og samme høyde når teksten får plass på én linje. I en smal rute brytes teksten, og baren blir én linje høyere. Prosjektvelgeren over feltet er der som før.
  - Skjemaet blir liggende skjult og låst bak baren, så utkastet er der igjen når mappen er valgt. Feltet får fokus med en gang.

## 31. Runde 15: artifacts i Chat med forhåndsvisning og kode, også React (brukerønske 9. november 2026)
Målet er 0.11.0. Koordinatoren bumper versjonen og bygger, og den installerte appen oppdateres ikke i runden.

### 31.1 Artifact-boksen i chatten
- **I dag:** under en ferdig `html`-blokk i et svar kommer et kort med forhåndsvisning (`web/src/markdown/artifact-card.ts`, Artifacts v1 i SPEC 14).
- **Nytt:** et svar som inneholder en hel én-fils-app, i HTML eller React (`jsx` eller `tsx`), vises som en rolig **artifact-boks** i chatten.
  - Boksen har ikon, tittel, type («HTML» eller «React») og antall linjer. Mens svaret strømmer, viser den at appen skrives.
  - Koden står ikke som en lang blokk midt i samtalen.
- **Klikk på boksen** åpner artifacten i sidepanelet, eller som egen rute på smale vinduer, med to faner:
  - **Forhåndsvisning:** appen kjører. Det finnes en knapp for å laste på nytt.
  - **Kode:** hele fila med fargelegging, Kopier og Last ned.
  - Panelet har også **Lagre som artifact**, i rommet fra SPEC 14, og **Åpne stort**. Esc og lukkeknappen lukker.
- **Flere versjoner:** når modellen lager en ny versjon av samme artifact senere i tråden, viser boksen versjonen, og panelet kan bla mellom versjonene.
- Eksisterende `html`-kort skal gå over til denne boksen, slik at det finnes ett mønster, ikke to.

### 31.2 React-forhåndsvisning, pakket lokalt
- **Hva som støttes:** én fil med en komponent som default export, i `jsx` eller `tsx`.
  - Importer fra `react` og `react-dom` virker.
  - Andre importer gir en tydelig melding i forhåndsvisningen om hvilken pakke som ikke finnes, ikke en hvit side.
  - Kjøretidsfeil vises som en rolig feilboks i forhåndsvisningen.
- **Alt kjører lokalt og uten nett:**
  - React og react-dom pakkes inn i appen.
  - JSX og TypeScript gjøres om til JavaScript med en liten omformer, enten i appen eller i serveren.
  - Ingen CDN, og ingen nettkall fra forhåndsvisningen.
  - Kodebiter lastes først når en React-artifact vises første gang. Hvileminnet og oppstartstiden skal ikke bli dårligere (SPEC 29.7).
- **Samme isolasjon som HTML i dag:** forhåndsvisningen går på serverens egen origin for forhåndsvisning, i en iframe med `sandbox` uten `allow-same-origin`, og med en nøkkel per kjøring. Appen, filene og nøklene kan ikke nås derfra.

### 31.3 Tekstblokker
- Blokker merket `text`, eller uten språk, får et lite merke «Tekst» øverst, så de skiller seg fra kode. De beholder Kopier.
- Systemprompten i Chat kan be modellen bruke slike blokker til tekst som skal kopieres, og artifacts til hele apper. Instruksen skal være kort.

### 31.4 Slik ble det (presisering etter runden)
- **Hva som blir en boks:** en blokk merket `html` (eller `htm`, `xhtml`) som er et helt program, som før, og en blokk merket `jsx` eller `tsx` med `export default` eller et eget `createRoot(...)`. Andre blokker er kode som før.
  - Et filnavn etter språket, som ` ```jsx oppgaver.jsx `, blir med. Boksene i en tråd med samme filnavn, eller samme navn når filnavn mangler, er versjoner av samme app. HTML og React deler aldri versjoner.
  - Navnet er `<title>` i HTML, komponentens navn i React («App» gir «React-app»), ellers filnavnet.
  - Boksen viser ikon, navn, «HTML» eller «React», antall linjer, `v2` når det finnes flere versjoner, «Lagret» når versjonen er lagret i Artifacts, og den som vises i panelet er merket.
  - Mens blokken strømmer og ser ut som en app (en `<!doctype>`/`<html>`, eller en import fra `react`), står boksen med «Skriver React · 23 linjer» og kan ikke klikkes.
- **Panelet** står i høyre side av vinduet, i Chat og i Kode. I Kode viker verktøypanelet mens det er åpent; «Vis eller skjul panelet» og et verktøy som åpnes, tar plassen tilbake. Under 860 px er det en egen rute over samtalen.
  - Bredden kan dras og huskes. «Åpne stort» legger det over samtalens bredde. Esc lukker også fra et tomt meldingsfelt, og fokus går tilbake til boksen.
  - Panelet hører til tråden: en annen tråd lukker det.
  - **Kopier** gir blokkens tekst. **Last ned** lagrer fila som `<filnavn>.html|.jsx|.tsx`, med linjeskift til slutt. **Lagre som artifact** lagrer versjonen som vises, og blir **Åpne i Artifacts** etterpå.
  - Innstillingen fra SPEC 14.3 heter nå «Åpne nye artifacts med en gang». Er den på, åpner panelet seg selv når modellen nettopp har skrevet en app i en chat som vises, i et vindu bredere enn 860 px. Aldri i Kode, og aldri for historikk.
- **Artifacts-rommet** tar også React: kolonnen `lang` (`html`, `jsx`, `tsx`) i `artifacts`, JSX- eller TSX-utheving i redigeringen, «Last ned .jsx» som ren tekst, og typen på flisen.
- **React-forhåndsvisningen:**
  - Omformeren er Sucrase, i iframen selv. Rolldown og oxc følger med Vite, men bare i utviklingen: oxc finnes bare som en innebygd modul på 21 MB, og den ville bare kunnet kjøre i serveren.
  - `web/vite-preview-runtime.ts` bygger `preview-runtime/` ved siden av web-bygget: `react.js`, `react-dom.js`, `react-dom-client.js` og `jsx-runtime.js` som ES-moduler med én felles React, og `boot.js` med Sucrase. Appen laster dem aldri.
  - Forhåndsvisningsserveren gir ut disse filene under `/_rt/`, bare navn fra den ene mappens liste, med `Access-Control-Allow-Origin: *` fordi en side med opak origin henter moduler med CORS. Ellers leser den fortsatt ingenting fra disken.
  - React-siden har importkart (med nonce), fila som JSON-data og `boot.js`. CSP: `sandbox allow-scripts allow-modals allow-forms`, `default-src 'none'`, skript bare fra `/_rt/` og `blob:`, `connect-src 'none'`, bilder og fonter bare fra `data:`/`blob:`, `form-action 'none'`. `allow-forms` trengs for at `onSubmit` skal kjøre; ingen skjemaer kan sendes. `'unsafe-eval'` er med, fordi kalkulatorer med `eval` er vanlige. Det gjelder bare rammens egen opake origin.
  - Meldingene står på norsk i rammen, i lys eller mørk drakt etter appen: koden kan ikke leses (med linjen), pakke som ikke finnes, fil utenfor, ingen komponent, appen stoppet med en feil (med linjen). Feil i en klikkhandler gir en linje nederst som kan lukkes, og appen står.
- **Tekstblokker:** merket `text`, `txt`, `plaintext`, `plain` eller `tekst`, eller uten språk. Linjene brytes. En blokk som er merket som tekst, står i vanlig skrift; en uten språk beholder fast bredde, fordi den like gjerne kan være kode. En linje med `$ ` uten språk er en kommando, med Kjør, og får ikke merket.
- **Systemprompten i Chat** har to korte linjer: én om artifacts (én fil, ` ```html ` eller ` ```jsx `/` ```tsx ` med default export, bare react og react-dom, filnavn etter språket og samme navn for en ny versjon) og én om ` ```text ` for tekst som skal kopieres. Kode-harnessen er uendret.
- **Demo-modellen:** «react-artifact» gir oppgavelisten i JSX, «ny versjon av react-appen» versjon 2 med samme filnavn, «react tsx» samme app i TSX, og «tekstblokk» et svar med en tekstblokk.
