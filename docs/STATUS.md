# Status

**v0.11.0 (bygg 32): Runde 15, SPEC del 31.** Chat har nå en artifact-boks for apper i én fil (HTML og React) med et panel for forhåndsvisning og kode, og tekstblokker med merke. Se `docs/PATCHLOG.md`. Den installerte appen er fortsatt bygg 30.

| Kjøring mot det samlede bygget | Resultat |
|---|---|
| `npm test` | Typesjekk ren. 331 tester, alle grønne. |
| `npm run test:ui` | 169 tester, alle grønne. |
| `npm run e2e` | Grønt. |
| `npm run test:desktop` | 40 tester, alle grønne. |

**Kjente svakheter i 0.11:**
- **Versjoner:** de telles bare blant meldingene som er lastet inn. Hvis filnavnet eller komponenten skifter navn, blir det en ny app i stedet for en ny versjon.
- **Esc** lukker ikke panelet mens fokuset står inne i forhåndsvisningen. ✕ virker.
- **Søk i samtalen** finner ikke tekst inne i en artifact-boks.
- **Forhåndsvisningen** har hvit bakgrunn også i mørkt tema.
- **React-pakker:** bare `react` og `react-dom` finnes. Lucide eller recharts kan vurderes senere.

## 0.10

**v0.10.0 (bygg 31): Runde 14, SPEC del 30.**
- Nøklene ligger i nøkkelringen, ikke i klartekst.
- Nytt appikon med valg av ikon i Innstillinger.
- Gafler med sporbar opprinnelse, og arkivering av mange tråder med angre.
- Når prosjektmappen mangler, får man en bar med to knapper i stedet for meldingsfeltet.

Se `docs/PATCHLOG.md`. Den installerte appen i appbiblioteket er fortsatt bygg 30.

| Kjøring mot det samlede bygget | Resultat |
|---|---|
| `npm test` | Typesjekk ren. 324 tester, alle grønne. |
| `npm run test:ui` | 163 tester, alle grønne. |
| `npm run e2e` | Grønt. |
| `npm run test:desktop` | 39 tester, alle grønne. |

**Kjente svakheter i 0.10:**
- Bytte av ikon er ikke sett på det ekte skrivebordet. GNOME kan bruke litt tid på å vise et nytt ikon i appbiblioteket.
- Når nøkkelringen er låst, venter lagringen på GNOMEs egen dialog for opplåsing, i opptil 2 minutter. Det er ikke prøvd med den ekte dialogen.
- Når en leverandør får nytt navn, endres ikke navnet på nøkkelen i nøkkelringen.
- Når mappen mangler, ligger utkastet i tråden skjult til mappen er valgt igjen.

## 0.9

**v0.9.0 (bygg 30): Agentic Desktop som Electron-app, SPEC del 29.** Bygg 30 får appen til å åpne seg fra appbiblioteket også når GNOME Shell husker den gamle stien. Installert i appbiblioteket som «Agentic Desktop». Statusfelt, eget ikon, nettleserpanel i vinduet og optimalisering. Se `docs/PATCHLOG.md`.

| Kjøring mot det samlede bygget | Resultat |
|---|---|
| `npm test` | Typesjekk ren. 308 tester, alle grønne. |
| `npm run test:ui` | 156 tester, alle grønne, i én samlet kjøring. |
| `npm run e2e` | Grønt. |
| `npm run test:desktop` | 36 tester, alle grønne, med den pakkede appen og installasjonen. |
| Minne i hvile (PSS, hele appen, xvfb) | 324 MB. Budsjettet er 500 MB. |

**Kjente svakheter i 0.9:**
- Uten AppArmor-profilen (Ubuntu 24.04 og nyere) starter appen uten Chromium-sandkassen. Nettsider åpnes da i serverens Chrome, som har sin egen sandkasse. Profilen legges inn med sudo, og kommandoen står i Innstillinger → Om. Selve oppstarten med profilen kan ikke testes uten root.
- AppImage og .deb går nå gjennom startskriptet, men er ikke testet installert.
- Appen og localhost-serveren kan ikke bruke den samme datamappen samtidig. Den som starter sist, viser en side om det eller nekter å starte.
- Ikonet i statusfeltet, varselet og Wayland-vinduet er bare testet headless, ikke på det ekte skrivebordet. Minnetallene er målt med programvarerendering under xvfb, og GPU-prosessen kan bruke mer på RTX 2080.
- Etter en svært lang strømming (4 MB tekst) bruker web-delen over 800 MB på toppen og rundt 250 MB 20 sekunder etter. Det bør tas i en egen runde.
- Når appen ligger i statusfeltet, bruker den bare 8 MB mindre enn med vinduet åpent.
- Mens vinduet er skjult, kan ikke agenten ta skjermbilder av nettleserpanelet. Innlogginger som ble importert før 0.9, må importeres på nytt for panelet i appen.
- Vinduet har firkantede hjørner og ingen GNOME-skygge. Ved mørkt tema i appen og lyst system kan det komme et kort lyst blink ved start.
- Knappene under meldinger vises for en skjermleser først når meldingen får fokus.
- `npm run perf` er ustabil i kontrollen for CSS-animasjon.
- Fra 0.8 gjelder fortsatt: Diktering og «Legg til planlagt oppgave» er demoknapper.

## 0.8

**v0.8.1 (bygg 27):** rettinger av innsatsvelgeren og toppfeltet etter 0.8, se `docs/PATCHLOG.md`.

**v0.8.0 (bygg 26): Runde 11 til 13 og designrunden, SPEC del 24 til 28.** Ryddig toppfelt, panelknapper i to stiler, startside og stabling i sidepanelet, øktpanel, annotering, valg for Kode-start, import av informasjonskapsler, lesbare Kode-steg og verktøy i Chat. Se `docs/PATCHLOG.md`.

| Kjøring mot det samlede bygget | Resultat |
|---|---|
| `npm test` | Typesjekk ren. 300 tester, alle grønne. |
| `npm run test:ui` | 153 tester, alle grønne, i én samlet kjøring. |
| `npm run e2e` | Grønt. |
| `npm run perf` | Ikke dårligere i agentenes målinger. Én kjøring av stresstesten (p50 5,0 ms mot 1,3) ser ut som støy og bør sjekkes ved neste kjøring. |

**Kjente svakheter i 0.8:**
- Diktering og «Legg til planlagt oppgave» er fortsatt knapper som bare viser en forklaring om demo. Designrunden foreslår å skjule dem til funksjonene finnes.
- Leverandørens eget nettsøk (Anthropic og OpenAI-kompatibel) er bare testet mot lokale falske servere. Med OpenAI-kompatible vises søkesteget først når svaret er ferdig.
- Kildelenker åpnes i en ny fane, ikke i nettleserpanelet.
- Størrelsen på stablede paneler huskes per prosjekt, ikke per tråd. Når et panel får egen kolonne, blir hele panelet bredere.
- Importen av informasjonskapsler grupperer nettsteder med en enkel regel, ikke hele Public Suffix List. Informasjonskapsler uten utløp ligger i appens datamappe (0600).
- Teksten på Kode-starten skalerer bare med bredden i lave ruter.
- 8 lave funn fra designrunden står igjen i `docs/review/design-runde.md`.
- `npm run screenshots` er bare delvis oppdatert.

## 0.7

**v0.7.0 (bygg 25): Runde 10, SPEC del 23.** Nettleseren med faner og import fra Chrome, modellvelger med søk, ikonrad for skjult sidefane, glimt-tekst og Premium tenkevisning. Se `docs/PATCHLOG.md`.

| Kjøring mot det samlede bygget | Resultat |
|---|---|
| `npm test` | Typesjekk ren. 271 tester, alle grønne. |
| `npm run test:ui` | 127 tester. 126 grønne i helkjøringen; den siste («flere vinduer … i sync») traff tidslinjens hover-kort, er gjort robust og er grønn. |
| `npm run e2e` | Grønt. |

**Kjente svakheter i 0.7:**
- I fullvisning kan en toast ligge over panelets fanelinje.
- Popup-vinduer fra nettsider åpnes i samme fane.
- `npm run screenshots` er ikke oppdatert for ikonraden og tråder uten tittel.
- To UI-tester er ustabile under full last: rutedrag og tidslinjen.
- «Langt opp, 200 000 px» i `npm run perf` varierer mye fra kjøring til kjøring.

## 0.6

**v0.6.0 (bygg 24): Runde 9, SPEC del 21 og 22.** Ny Kode-start, sidefane med Festet, Denne datamaskinen og Chat-prosjekter, innsatsvelger, tidslinje, redigering av meldinger, og en standard-harness i lag med forhåndsvisning, minneoppgradering og egen Chat-personalisering. Se `docs/PATCHLOG.md`.

| Kjøring mot det samlede bygget | Resultat |
|---|---|
| `npm test` | Typesjekk ren. 268 tester, alle grønne. |
| `npm run test:ui` | 118 tester, alle grønne, i én samlet kjøring. |
| `npm run e2e` | Grønt. |

**Kjente svakheter i 0.6:**
- Minneoppgraderingen med en ekte modell er bare prøvd mot en lokal fake-server. Kontrakten bør prøves med en ekte nøkkel.
- GitHub-kortet på Kode-startsiden er bare testet uten tilkobling.
- I Chat gir et rent «hei» fortsatt det gamle demosvaret. «Hvem er du» og «hva kan du» svarer ut fra harnessen.
- Når Chat lagrer et minne av seg selv, vises det ingen melding i tråden.
- Kode uten prosjekt åpner høyre panel på Oversikt, som bare sier «Velg prosjekt».
- Innsatsvelgeren viser Lav til Høy for OpenAI-kompatible leverandører, og Ingen til Maks for Demo og Anthropic.

## 0.5

**v0.5.0 (bygg 23): Runde 5 til 8, SPEC del 16 til 20.** Se avsnittet rett under og `docs/PATCHLOG.md`. Avsnittene etter gjelder 0.4 og eldre.

## Runde 5 til 8 (SPEC 16 til 20)

Bygget av et dev-team av agenter: sju som la til funksjoner, en UI-kritiker (`docs/review/ui-kritikk.md`, 62 funn), en QA-tester (`docs/review/qa-rapport.md`, 21 feil), og så en server-retter, en detaljagent for bevegelse og finpuss, to UI-rettere, en ytelsesagent og agent G (temaer, GitHub Beta, mini-editor og kanttilfeller). Alle kritiske og høye QA-feil er rettet, og de fleste P1- og P2-funnene fra kritikken.

| Kjøring mot det samlede bygget | Resultat |
|---|---|
| `npm test` | Typesjekk ren for server og web. 251 tester, alle grønne. |
| `npm run test:ui` | 105 tester, alle grønne, i én samlet kjøring. QA-testene (7) ga også grønt før de ble flyttet inn i de vanlige testfilene. |
| `npm run e2e` | Grønt. |
| `npm run perf` | Henger ikke lenger. Se `docs/perf-latest.md`. Strømming 21–25 % opptatt, scrolling p99 7,5 ms, `/`-menyen verst 17 ms. Fortsatt tregere enn 0.1 på scrolling og langt hopp. |

**Kjente svakheter i 0.5:**
- Knapperaden under hver melding er omtrent halvparten av arbeidet når deler av en lang tråd monteres. Forslag: monter knappene først ved hover eller fokus.
- Panelet åpner seg av seg selv i brede vinduer (P2-24). Personlighet har ingen ekte nedtrekksliste, fordi serveren mangler en standardinnstilling (P2-34).
- Artifacts-galleriet viser ikon, ikke miniatyrbilde (P3-3).
- Matte vises som MathML uten egen matematisk font, så store tegn og parenteser i matriser strekker seg ikke. Det appen ikke kan tegne, vises som tekst med merke.
- Verktøygrupper legges ikke sammen av seg selv når turen er ferdig. Hele turen kan foldes med «Jobbet i …».
- GitHub (Beta) er bare testet mot en lokal falsk server. Leverandørene er merket Beta til de er prøvd med ekte nøkler.
- Appen er bare sett i headless Chrome.

## 0.4

**v0.4.0 (bygg 17): Redesign mot Codex og Claude desktop, SPEC del 15.** Se avsnittet rett under og `docs/PATCHLOG.md`. Avsnittene etter gjelder 0.3, 0.2 og 0.1. `npm run perf` er ikke kjørt på nytt siden 0.1.

## Redesign (SPEC 15)

Ferdig: ett stilark med tokens for begge temaer, ny topp, sidefane, startside med statistikk, meldingsfelt med prosjektvelger, Lokal og gren, godkjenningskort over meldingsfeltet, innstillinger som fullside og roligere samtale. Statuslinjen er borte; det den viste, står nå i sidefanen og i kontekstringen. Ingen nye npm-pakker.

| Kjøring mot bygg 17 i `web/dist` | Resultat |
|---|---|
| `npm test` | Typesjekk ren for server og web. 162 tester, alle grønne (155 fra før og 7 nye). |
| `npm run test:ui` | 40 tester, alle grønne (37 fra før og 3 nye), ca. 92 s. |
| `npm run e2e` | Grønt, 9 av 9 steg. |
| `npm run screenshots` | 23 bilder per tema med nye navn, blant annet `01-start-chat`, `02-start-kode`, `03-prosjektvelger`, `09-samtale-verktoy` og `15-innstillinger`. |

Før bygget ble det samme kjørt mot et bygg i en midlertidig mappe (`AD_WEB_DIST`), og testene for artifacts-rommet ble kjørt seks ganger på rad etter rettingen under.

**Kjente svakheter i 0.4:**
- **Klikk som havner i forhåndsvisningen.** I headless Chrome kan et museklikk på en dialog over en forhåndsvisning som nettopp er lastet, gå til den fremmede iframen i stedet. Det ga tilfeldige feil i `16-artifacts`, og testen svarer nå med tastaturet. Å skjule iframen mens dialogen er åpen hjalp ikke. Det er ikke sett i et ekte vindu, men det er heller ikke prøvd.
- Menylinjen er fortsatt skjult under 860 px, og under 520 px er også Ny rute, Terminal og VS Code borte fra toppen. De nås med `Ctrl+\`, panelfanen og `/vscode`.
- Statistikk-kortet vises ikke i Kode (SPEC sier «kan»). Topptimen regnes fra når kjøringer startet, i lokal tid.
- Varslene om ferdige tråder ligger i minnet og er borte etter omlasting.
- Lokal, Tilkoblinger, Git (unntatt grenen), MCP-servere, Hooks, Worktrees, Planlagt, mikrofonen og vertsvelgeren er plassholdere merket **Demo**.
- Appen er bare sett i headless Chrome, i 1440×900, 1360×860, 1024, 900 og 420 px.

## Artifacts (SPEC 14)

Ferdig som førsteversjon: rommet i sidefanen, galleri, redigering med forhåndsvisning, kort under `html`-blokker i chatten, festede prosjekter, og forhåndsvisning på egen origin med nøkkel per kjøring.

| Kjøring mot bygg 16 i `web/dist` | Resultat |
|---|---|
| `npm test` | Typesjekk ren for server og web. 155 tester, alle grønne (145 fra før og 10 nye). |
| `npm run test:ui` | 37 tester, alle grønne (35 fra før og 2 nye), ca. 94 s. |
| `npm run e2e` | Grønt. |
| `npm run screenshots` | Tatt på nytt i begge temaer, med tre nye bilder per tema: `16-artifact-kort`, `17-artifact-rom` og `18-artifacts-galleri`. |

Før bygget ble det samme kjørt mot et bygg i en midlertidig mappe (`AD_WEB_DIST`): `npm test` 155/155, `npm run test:ui` 37/37, `npm run e2e` grønt.

**Nye tester:** `server/test/artifacts.test.ts` (10) og `web/test/16-artifacts.test.ts` (2). **Rettet:** `web/test/10-sikkerhet.test.ts`, som krevde null iframes i et svar. Nå krever den at en iframe bare finnes i et artifact-kort, sandkasset og på forhåndsvisningens port.

**Kjente svakheter:** Editoren har egen enkel angre og gjør om, men ikke søk og erstatt, fordi `@codemirror/commands` ikke er installert. Galleriet viser ikon, ikke forhåndsbilde. Å gå til en tråd fra sidefanen forkaster ulagrede endringer uten å spørre. **Åpne i Nettleser-panelet** krever et prosjekt. En app som allerede kjører på den gamle serveren (for eksempel på port 4317) må startes på nytt før kortene og rommet virker, fordi den gamle serveren mangler `frame-src` og de nye rutene.

Sist kjørt 3. november 2026 på Node 26.8.1, npm 11.19.0 og Chrome 153, fra rent utgangspunkt (`node_modules` og `web/dist` slettet først).

| Kjøring | Resultat |
|---|---|
| `npm install` | 0 feil. `node-pty` bygget fra kilde i en sti med mellomrom. |
| `npm run build` | Grønt, øker `build` i `version.json`. Sist bygg 13. |
| `npm test` | Typesjekk ren for server og web. 127 tester, alle grønne. |
| `npm run test:ui` | 29 tester, alle grønne, ca. 92 s. |
| De fire over to ganger på rad | Grønt begge ganger. |
| `npm run test:ui` alene | I tillegg tre ganger på rad underveis, alle grønne. |
| `npm run e2e` | 9 av 9 steg grønne. |
| `npm run perf` | Skrev `docs/perf-latest.md`. Alle seks kontroller av måleverktøyet ok. |
| Prosesser etterpå | Ingen igjen. Sjekket med `ps`, også etter VS Code. |

Ingen ekte API-er er kalt, og all Chrome kjørte headless.

## Kontroll etter byggingen

Etter at agentene var ferdige ble alle tester kjørt på nytt i bygg 13: `npm test` 127/127, `npm run test:ui` 29/29 og `npm run e2e` grønt. Appen ble også kjørt for hånd i 1920x1080 og 1024x768, med demo-modellen: mappevelger, Kode, fem godkjenninger, Playtest, klikk i nettleserpanelet, lyst tema og Om.

To feil ble funnet og rettet:

- **Nettleseren kjørte uten sandkasse.** `playwright-core` legger til `--no-sandbox` som standard. `chromiumSandbox: true` er nå satt i `server/src/browser.ts`, og renderer-prosessen er bekreftet med seccomp på. Ingen automatisk test sjekker dette ennå.
- **Panelet dekket meldingsfeltet under 1180 px.** Det ligger over innholdet der, men var åpent som standard. Nå starter det skjult i små vinduer, og `state/app.ts` styrer dette. Heller ikke dette har egen test ennå. Et lagret valg om åpent panel gjelder fortsatt.

## En regel ble brutt under arbeidet

**Testen for Åpne i VS Code startet ekte VS Code 13 ganger.** Den skulle vise feilen når `code` mangler, men `PATH` inneholdt `/usr/bin`, der `code` ligger. Hver kjøring av UI-testene startet derfor en egen VS Code med en midlertidig hjemmemappe. Dette bryter regelen om ingen vinduer på skrivebordet (avsnitt 11). Prosessene hadde verken GPU- eller vindusprosess da de ble funnet, men jeg kan ikke utelukke at vinduer ble vist en kort stund.

Oppdaget da prosesslisten ble sjekket til slutt. De 13 prosessene brukte til sammen over to CPU-kjerner, og er stoppet etter PID. Testene bruker nå en stand-in i `web/test/bin/code`, og `harness.ts` legger den først i `PATH`, så en test ikke kan nå den ekte. Kontrollert med `ps` før og etter testene. Testene og ytelsesmålingen er kjørt på nytt etterpå, så alle tall her er fra en maskin uten disse prosessene.

# Ønskelisten (SPEC 13)

Bygges i runder, se `docs/PATCHLOG.md` for detaljer. Plassholdere er merket **Demo** i appen.

| Runde | Status |
|---|---|
| 1. Rammen og meldingsfeltet | Ferdig. `npm test` 131/131, `npm run test:ui` 31/31, `npm run e2e` grønt. |
| 2. Innstillinger og modeller | Ferdig. `npm test` 138/138, `npm run test:ui` 33/33, `npm run e2e` grønt. Ingen ekte leverandør kalt. |
| 3. Prosjekter og instanser | Ferdig. `npm test` 141/141, `npm run test:ui` 34/34, `npm run e2e` grønt. |
| 4. De store som plassholdere | Ferdig. `npm test` 145/145, `npm run test:ui` 35/35, `npm run e2e` grønt. |

**v0.2.0 (bygg 15):** Etter `npm run build` er alt kjørt én gang til mot det ekte bygget i `web/dist`: `npm test` 145/145, `npm run test:ui` 35/35 (ca. 93 s), `npm run e2e` grønt. Skjermbildene i `docs/screenshots/` er tatt på nytt. Ingen prosesser fra testene er igjen.

**Kjente svakheter i 0.2:** Menylinjen skjules under 860 px. Profiltallene teller en kopiert tråds historikk to ganger. `settings.json` leses ved neste tråd, uten varsel til UI-et. Ingen ekte leverandør er prøvd. CSS-en for 0.2 ligger som overstyringer nederst i `styles.css` og skal foldes inn i ryddefasen. Testen «små vinduer» bruker rundt 30 s fordi et klikk venter på tidsavbrudd; det var slik før denne runden også.

**Byggnummeret hoppet fra 13 til 14 ved et uhell** under runde 1: servertesten for `npm start` bygde `web/dist` på nytt fordi kildene var endret. Det byttet også ut filene brukerens kjørende app serverte. Rettet i `scripts/start.ts`, se PATCHLOG.

UI-testene kjøres mot et bygg i en midlertidig mappe (`AD_WEB_DIST`), så `web/dist` som brukerens app serverer ikke byttes ut under arbeidet.

# Grensesnittet

## Det som virker og er testet ende til ende

Testene ligger i `web/test/`, en fil per flyt, mot ekte server og demo-modell i headless Chrome. Hver test feiler også ved feil i konsollen eller brudd på CSP.

| Flyt | Dekket av testen |
|---|---|
| 1. Kode | Mappevelger, godkjenning med Tillat, Tillat alltid og Avslå, tenkerad, kommandorad med live utdata, kø, Stopp, fil i Filer med utheving, diff i Endringer, Angre tur |
| 2. Playtest | Statisk og med `dev`-skript, annen port enn appen, utdata i terminalfanen, klikk og taster i panelet (lest fra pikslene på canvaset), adressefelt, tilbake, last på nytt. Åpne i VS Code med en stand-in for `code`, og feilmelding når `code` mangler. |
| 3. Terminal | Input, utdata, panelbytte, sidelast med samme PTY, flere faner, tapt WebGL-kontekst med overgang til DOM-tegning |
| 4. Meldingsfeltet | `/` med filter og piltaster, alle innebygde kommandoer unntatt `/playtest` og `/vscode` via menyen, skill som `/navn`, `@` med fil, mappe og tråd, `!` med godkjenning og utdata |
| 5. Ruter | To som strømmer samtidig (overlapp lest fra hendelsesloggen), dra tråd inn, dra rute for å flytte og bytte, Løsriv, slipp utenfor vinduet, hent tilbake fra begge sider, lagret oppsett, tak på seks, to likeverdige vinduer i sync |
| 6. Samarbeid | `samarbeid` gir synlig tråd med avsender, merke i sidefanen og rute som åpner seg uten å ta fokus. Stopp alt stopper tre tråder. Samlet bruk i statuslinjen. |
| 7. Tema | Lys, Mørk, System live, ingen lyse bilder ved oppstart (de første 12 bildene er lest), temaet settes før `<body>` finnes |
| 8. Chat | Melding uten prosjekt, Markdown, tabell, utheving i worker, kopier, gi nytt navn, søk, arkiver, eldre meldinger som lastes ved scrolling |
| 9. Kanttilfeller | Tomme tilstander, feil fra modellen med leverandør lagt inn i Innstillinger, server ned og opp igjen med ny lenke i samme fane, brutt WebSocket uten tap av hendelser, utkast som overlever |
| 10. Sikkerhet | 13 angrep i Markdown og HTML fra en lokal ond modell, også etter omlasting, ondsinnet filnavn, token borte fra adresse og side |
| Annet | Om med versjon, byggnummer, byggdato og Code Pro, Kopier info, tillatelsesmodus, lat lasting av paneler og Chrome, panel og sidefane som kan skjules og endre bredde, ingen vannrett skrolling ned til 340 px |

## Slik er det bygget

- **Scrolling:** `flex-direction: column-reverse` gir start nederst på første bilde og fast bunn under strømming, helt uten skrollkode. Ingen lyttere på `scroll`.
- **Virtualisering:** SPEC-en sier full virtualisering bare hvis målinger viser at det trengs. En versjon uten er ikke målt. Jeg gikk rett på biter fordi en tråd med 5 000 meldinger skal åpne på første bilde, og da kan ikke alle radene bygges først. Tråden er delt i biter på 12 rader, som bygges og fjernes etter en `IntersectionObserver`, med plass holdt av i målt høyde. Radene har i tillegg `content-visibility: auto`.
- **Lasting:** Bare slutten av tråden hentes først, og eldre sider hentes når du nærmer deg toppen. Trådbytte venter på data før det bytter, så gammelt innhold står til det nye kan vises i ett bilde.
- **Markdown:** Bygger DOM-noder fra tokens, aldri HTML-strenger, så `innerHTML` finnes ikke i koden. `marked` brukes bare som lexer, og siste blokk er det eneste som lexes per bilde.
- **Rammebudsjett:** Arbeid som kan deles opp, får en tredel av et bilde, målt fra skjermens faktiske frekvens, og deles mellom rutene.
- **Avhengigheter:** `solid-js`, `marked`, CodeMirror med Lezer-grammatikkene (som også brukes i workeren) og xterm.js.

## Valg gjort uten brukeren

- **Svært lange meldinger:** Over 64 kB vises bare slutten etter omlasting, med en knapp for å vise hele. Å bygge flere MB på nytt tok sekunder.
- **Melding i kø etter Stopp:** Vises som vanlig melding i samtalen, slik serveren gjør det.
- **Ved smal skjerm** vises én rute om gangen med faner. Sidefane og panel legger seg over innholdet.
- **Ny tråd** er en tom rute. Tråden lages først når første melding sendes.
- **`/modus`** bytter hovedvisning. En tråds modus endres ikke.

## Det som ikke virker eller ikke er testet

- **240 Hz er ikke bevist.** Headless Chrome stopper på 60 bilder i sekundet, med alle flagg og både programvare og ekte GPU. `npm run perf` måler derfor arbeid per oppgave, ikke bilder på skjermen. Se `docs/perf-latest.md`. Appen er aldri kjørt i et vindu på brukerens skjerm.
- **Ekstrem strømming går over budsjettet.** 1 MB så fort serveren klarer gir oppgaver på 20 ms, selv om JavaScript holder seg til 1,5 ms per bilde. Stil, layout og tegning av nye noder er resten. I vanlig fart, 2,5 kB/s, er p99 rundt 5 ms, og enkelte oppgaver går over 4,17 ms. Rask scrolling har også enkelte oppgaver over 4,17 ms når nye deler av tråden bygges, men da går scrollingen fortsatt på kompositoren.
- **Tomme flater ved rask scrolling.** Deler av tråden kan være tomme et øyeblikk. Dette er ikke målt.
- **Filer og diff har ingen søk.** Lange differ stopper på 1 500 linjer med en knapp for flere, og filer som er for store for LCS-tabellen vises som erstattet.
- **Bare én skjermstrøm per prosjekt.** To vinduer deler samme nettleserside, og siste `resize` gjelder.
- **Tidspunkt i sidefanen** oppdateres bare når tråden endres, siden appen ikke skal polle i ro.
- **`/playtest` og `/vscode` er ikke testet fra meldingsfeltet**, bare fra knappene. De bruker samme funksjon.
- **Åpne i VS Code er ikke prøvd med ekte VS Code** etter at testen ble rettet, og den skal ikke være det i automatiske tester.
- **Dra og slipp er testet med syntetisk mus.** Slipp utenfor vinduet er testet i headless, ikke med et ekte vindu og ekte mus.
- **Nettleseren kan blokkere Løsriv** hvis draget tar lang tid, siden `window.open` krever en fersk brukerhandling. Da vises en melding og knappen **Åpne**.
- **Bare testet i Chrome.** `field-sizing` for meldingsfeltet finnes ikke i alle nettlesere, og feltet vokser da ikke med teksten.

## Endringer i serveren

Ingen feil ble funnet i serveren. Tre tillegg:

- **`lang strøm N rolig`** i demo-modellen strømmer 2,5 kB/s, med egen test, siden ytelsen i vanlig fart ellers ikke kunne måles. Serveren har nå 127 tester.
- **`typecheck`** dekker også `web/` og testene der.
- **`package.json`** har fått `test:ui`, `perf` og `screenshots`.

# Serveren

## Det som virker og er testet

**Sikkerhet, avsnitt 7:** Alle ni punktene har egne tester i `server/test/security.test.ts`: binding, token, cookie og billett, Host, Origin, CORS, CSP, token og nøkler i barneprosesser, og stikontroll. Rare forespørselsmål krasjer ikke serveren.

**REST og WebSocket:** Alle rutene i `shared/protocol.ts`. SQLite med WAL og hendelseslogg, der tekstdeltaer slås sammen. Flere vinduer på samme tråd og terminal.

**Leverandører:** `openai-compatible` og `anthropic` mot en lokal testserver med tekst, tenkning, verktøykall i biter, oppdeling midt i UTF-8, CRLF, feil midt i strømmen, 401/429/5xx, brutt forbindelse, stans i strømmen og avbrudd. `mock` går gjennom ekte løkke, verktøy og tillatelser.

**Agentmotor:** Løkka med grense på 50 steg, alle verktøy, hele tillatelsestabellen, Tillat alltid per prosjekt, `.env*` og `.git/hooks` i alle moduser, gjentatte kall, stopp med hele prosessgruppen, kø, parallelle tråder, nye forsøk, `AGENTS.md`/`CLAUDE.md`, komprimering i to trinn, diff per tur, angre med konfliktsjekk, og gjenoppretting både etter omstart og etter hardt krasj (SIGKILL).

**Paneler:** PTY-terminal med replay og flere faner. Headless Chrome med screencast, mus, tastatur, scroll, historikk og størrelse, der bruker og agent ser samme side. Tomgangslukking. Playtest med statisk tjener og `dev`-skript på egen port. VS Code-åpning (testet med en stand-in for `code`, så ikke noe vindu åpnes).

**Avsnitt 12:** Skills fra alle fire mapper med `use_skill` og `/navn`. `@` med vedlegg, og `!` gjennom vanlige tillatelser. `thread_*`-verktøyene med alle bremsene, filkonflikter, Stopp alt, samlet bruk per prosjekt, lagret rutenett, og `samarbeid` i demo-modellen.

**Bygg:** `version.json`, byggnummer, byggdato, `npm start`, `--no-open`, servering av `web/dist`.

## Det som ikke virker eller ikke er bygget

- **Ingen ekte API er prøvd.** Formatene følger dokumentasjonen og er testet mot innspilte strømmer. Første kall mot en ekte leverandør er fortsatt utestet.
- **Tokenet og nøklene er ikke beskyttet mot kommandoer som kjører som samme bruker.** Avsnitt 7 punkt 8 er oppfylt for miljøvariabler, filverktøy og token-filen, men uten OS-sandkasse (utenfor demoen) kan en godkjent kommando lese `keys.json` eller `/proc/<pid>/environ`. Kommandoer som nevner datamappen, `.env` eller `.git/hooks`, ber om godkjenning også i Full tilgang, men dette er tekstsøk. `cat .e*` slipper gjennom.
- **Etter et hardt krasj fortsetter kommandoen som kjørte.** Den er utenfor serverens kontroll. Den kjøres ikke på nytt, men den blir ikke stoppet heller. Ved vanlig stopp dør den.
- **Delvis tekst fra et steg som pågikk under et hardt krasj** er med i hendelsesloggen, men ikke i det modellen ser. Ved vanlig stopp beholdes den.
- **Kostnad er et øvre estimat.** Bufrede tokens regnes med full inputpris.
- **Tellingen av 20 meldinger nullstilles ved omstart.** Den ligger i minnet.
- **Grensen på 4 tråder** sjekkes når en tråd startes. En melding som lå i kø, kan i sjeldne tilfeller slippes og gi en femte.
- **Én server per datamappe er ikke håndhevet.** To servere med samme `AD_DATA_DIR` og ulike porter vil gå i beina på hverandre.
- **`<think>`-tagger i vanlig tekst** tolkes ikke som tenkning. Bare egne felter gjør det.
- **Chrome-profilen er felles** for alle prosjekter, så cookies deles mellom dem.
- **Dev-tjenere som verken bruker `PORT` eller skriver adressen sin** gir feil etter 30 sekunder.
- **`npm` varsler om `allowScripts` for `node-pty`.** Installasjonen virker i dag, men en fremtidig npm kan kreve godkjenning av skriptet.

## Endringer fra SPEC-en

- **Token-filen slettes ved første innlogging.** SPEC-en sier bare at den skal skrives. Ingen kommando kan kjøre før noen er logget inn, så da finnes filen ikke når barneprosesser starter. Lenken fra stdout virker fortsatt.
- **Forhåndsvisning bruker `localhost`, appen `127.0.0.1`.** Nettlesere skiller ikke cookies på port, så samme vertsnavn ville sendt app-cookien til prosjektets dev-tjener.
- **`.git/config` er også beskyttet**, fordi den kan peke til egne hooks.
- **Hver `browser_*` er eget verktøy i Tillat alltid**, slik tabellen i SPEC-en sier. Det gir fem godkjenninger i Spør-modus for hele demoflyten.
- **`browser_navigate` tar også en sti i prosjektet**, som `index.html`, og starter da statisk forhåndsvisning. Uten dette kunne ikke demo-modellen åpne siden, siden `file://` er blokkert.
- **Stopp kjører ikke køen.** Meldinger i kø blir stående i samtalen, så Stopp virkelig stopper.
- **Stopp på en tråd stopper ikke barnetråder.** Det gjør Stopp alt.
- **Bakgrunnsjobber dør når kommandoen er ferdig.** Ellers ville de overlevd appen. Langvarige tjenester hører til Playtest.
- **Sletting av et prosjekt sletter trådene** i appen, men aldri mappen.
- **`/api/fs/browse` er unntaket fra prosjektgrensen.** Mappevelgeren må kunne se hele disken. Den viser bare mapper og nekter datamappen.
- **Prosjekter kan ikke overlappe datamappen**, og `/` kan ikke være et prosjekt.
- **`@` skjuler `.env*`**, og slike filer kan ikke legges ved. Fanen Filer viser dem fortsatt for brukeren.

## Endringer i `shared/protocol.ts`

Alt er tillegg, og `ServerMessage` og `ThreadEvent` har bare fått nye varianter.

- **0.3:** `ArtifactSummary`, `Artifact`, `MAX_ARTIFACT_HTML`, `Project.pinned`, `Settings.artifactPreview`, `Bootstrap.artifacts`, og `artifact.changed` og `artifact.deleted` i `ServerMessage`.

- **`Thread`:** `parentThreadId`, `origin`, `permissionCap`, `pendingApprovals`
- **`Settings`:** `autoOpenAgentThreads`
- **`ModelConfig`:** valgfrie `maxOutputTokens`, `supportsImages`, `thinking`, `effort`
- **`ThreadEvent`:** `user.queued`, `thread.spawned`. `user.message` har fått `from?` og `attachments?`, og `tool.finished` har fått `screenshotId?`.
- **`ServerMessage`:** `thread.deleted`, `project.changed`, `project.deleted`, `project.layout`, `project.usage`, `settings.changed`
- **Nye typer:** `ThreadRef`, `Attachment`, `AttachmentRef`, `CommandInfo`, `MentionItem`
- **REST:** Se kommentaren i filen. `tail=` på hendelser, `/commands`, `/mentions`, `/layout`, `/stop-all`, `/usage`, `/compact`, `/terminals`, `/playtest` (GET) og `/api/screenshots/:id`. `POST /messages` svarer `{ messageId, queued }`.

## Valg

- **Anthropic uten SDK:** Rå `fetch` deler SSE-parser med OpenAI-leverandøren. Appen er leverandørnøytral, avsnitt 2 krever få avhengigheter, og det gjør det enkelt å teste mot lokal server. Tenkeblokker sendes tilbake uendret. Komprimering fjerner dem fordi signaturen er bundet til historikken, og avvist signatur gir ett nytt forsøk uten dem. `refusal` vises som feil.
- **`node-pty` 1.1.0** bygger og virker på Node 26. Ingen fork trengs.
- **Node kjører TypeScript direkte**, så serveren har ikke noe byggsteg. TypeScript brukes bare til typesjekk.
- **Avhengigheter i serveren:** `ws`, `node-pty`, `playwright-core` og `ignore`.

## Feil funnet under gjennomgang

Disse ble funnet etter at testene først var grønne, og har nå egne tester:

- `new URL` på rare forespørselsmål kunne krasje serveren.
- En prosjektmappe som forsvant under kjøring, ga en kjøring som hang.
- Tomgangslukking kunne slå til midt i en sidelast, og Chrome kunne lukkes i to parallelle løp.
- Gamle skjermbilder ble aldri fjernet av komprimering.
- Feil midt i en strøm kunne inneholde API-nøkkelen.
- `browser.state` kunne vise gammel historikk.
- Lagring av innstillinger låste demo-modellen som standard.

## Opprydding som gjenstår

`/tmp` har 28 mapper med navn som `ad-data-*`, `ad-project-*` og `ad-test-*` fra tidlige testkjøringer. De ble laget før feilen i testoppryddingen var rettet, og nye kjøringer legger ikke igjen flere. Et samlet sveip over `/tmp` ble stoppet av tillatelsessystemet, så de ligger der fortsatt. De er ufarlige, inneholder bare testdata, og forsvinner ved omstart. Slik fjerner brukeren dem selv:

```
rm -rf /tmp/ad-data-* /tmp/ad-project-* /tmp/ad-test-* /tmp/ad-dbg*
```
