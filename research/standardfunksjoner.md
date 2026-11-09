# Standardfunksjoner i agentiske desktop-apper for koding

Status per 2. november 2026. Alle kilder er hentet 2026-11-02.

**Merking:**
- **[V]** verifisert i kilde. Tallet i hakeparentes viser til kildelisten nederst.
- **[M]** målt eller lest lokalt på brukerens maskin.
- **[S]** min slutning. Ikke dokumentert av noen kilde.

Der kilden bare er et forumsvar eller en GitHub-sak, står det i teksten.

---

## 1. Kort oppsummering

**Hva som nå er standard.** Tolv aktive apper er sjekket. Nesten alle har parallelle økter med git-worktrees, planmodus, subagenter, MCP, regler for tillatelser, sjekkpunkter eller angring, og diff-gjennomgang i appen. Forskjellene ligger i dybden: om sjekkpunkter også ruller tilbake samtalen, om man kan kommentere enkeltlinjer i diffen, og om agenten har en ekte OS-sandkasse. Den siste nye standarden er en innebygd nettleser agenten kan styre mens brukeren ser på. Claude, Codex, Cursor og T3 Code har det. [V]

**Stacken.** Jeg fant ingen bevis mot Electron/TypeScript. Tvert imot:

- Electron 44.9.3 kjørte 240 fps som innfødt Wayland på akkurat denne maskinen, med GPU-kompositering på. [M]
- OpenCode har gått til Electron 44, og T3 Code, Hermes, Claude Desktop og Codex bruker også Electron. [V] [M]
- Tauri på Linux har derimot konkrete klager, fordi WebKitGTK kompositerer i programvare. [V]

**Lagg.** Klagene på Cursor, Codex, OpenCode og Hermes peker nesten alltid på appens egen renderer-kode, ikke på Electron: lange transkripter, syntaksutheving, ResizeObserver, omrendring per token. Hermes brukte rundt 20 PR-er og en runde til på å nå 60 fps. Brukeren vil ha 240 Hz, altså 4,17 ms per bilde mot 16,7 ms. Dette må derfor være et budsjett med måling fra første commit, ikke opprydding senere. [V] [S]

**Sikkerhet.** Den største enkeltrisikoen for localhost-versjonen. OpenCode hadde en server uten innlogging og med åpen CORS, som ga kommandokjøring fra en vilkårlig nettside (CVE-2026-22812). [V] Sjekk av Host, Origin og token må være på plass før første gang serveren kan kjøre en kommando.

**Status for appene som endret seg:**
- **Windsurf** heter nå Devin Desktop. Cascade er på vei ut til fordel for Devin Local. [V]
- **Codex-appen** ble slått sammen med ChatGPT-desktopappen 9. juli 2026. Linux-forhåndsversjon kom 11. august. [V]
- **Roo Code** ble lagt ned og repoet arkivert 15. mai 2026. Den er utelatt fra tabellen. [V]
- **Goose** skriver om desktopappen fra Electron til Tauri. [V, delvis sekundærkilde]
- **Hermes** har en offisiell app fra Nous Research og et eget fellesskapsprosjekt (fathah/hermes-desktop). Rapporten gjelder den offisielle.

---

## 2. Lokale målinger: er 240 Hz mulig på denne maskinen?

Maskin: GNOME Shell 50.1, Wayland, RTX 2080 med driver 610.43.02, skjerm DP-2 på 239,964 Hz. [M]

Testside: 4000 enkle DOM-rader. Først 2,5 s tomgang, så 2,5 s der `scrollTop` endres fra `requestAnimationFrame`, altså skrolling drevet av hovedtråden. Vindu 900x700. Én kjøring per oppsett. Electron kom fra brukerens eksisterende `~/.cache/electron`, så ingenting ble lastet ned.

| Kjøretid | Plattform | Tomgang fps | Skroll fps | Verste bilde i skroll |
|---|---|---:|---:|---:|
| Electron 44.9.3 (Chromium 152) | Innfødt Wayland | 240,0 | 239,5 | 8,2 ms |
| Electron 44.9.3 (Chromium 152) | XWayland | 239,9 | 231,9 | 29,2 ms |
| Electron 40.10.2 (Chromium 144) | Innfødt Wayland | 240,0 | 240,0 | 4,3 ms |
| Electron 40.10.2 (Chromium 144) | XWayland | 239,9 | 231,5 | 12,5 ms |
| Chrome 153 | Innfødt Wayland | 240,0 | 239,5 | 8,3 ms |
| Chrome 153 | XWayland | 239,9 | 237,5 | 12,5 ms |

Electron rapporterte `gpu_compositing: enabled` og `vulkan: disabled_off`. Testene åpnet korte vinduer på skrivebordet. Prosessene ble stoppet, og de utpakkede binærfilene er slettet.

**Hva dette betyr:**
- Plattformen gir ikke noe 60 Hz-tak. Median var 4,2 ms i alle oppsett. [M]
- Innfødt Wayland var bedre enn XWayland i alle Electron-rader. Utvalget er lite, så forskjellen er en indikasjon, ikke et bevis. [M] [S]
- Claude Desktop kjører allerede med `--ozone-platform=wayland` på denne maskinen, mens ChatGPT/Codex kjører `--ozone-platform=x11`. [M]

**Begrensninger:** Målingen viser hvor ofte `requestAnimationFrame` kjører, ikke hva som faktisk når skjermen. Den har ingen Markdown, ingen strømming og ingen syntaksutheving, så den sier hva plattformen tillater, ikke hva en ferdig app vil klare. `--no-sandbox` ble brukt fordi den utpakkede binærfilen manglet SUID, noe som ikke påvirker bildefrekvens på en lokal testside. [S]

Jeg prøvde først å måle i nettleserpanelet til Claude Desktop, men det var skjult, og da stopper `requestAnimationFrame`. Det viser at skjulte paneler pauser tegning, noe som er nyttig for ytelsen men kan villede målinger. [M]

---

## 3. Sammenligningstabell

**Forklaring:** J = ja, D = delvis eller med begrensning, N = nei, A = kommer fra den underliggende agenten, ? = ikke verifisert. "?" betyr at jeg ikke fant det i kildene jeg leste, ikke at funksjonen mangler.

**Apper:** CC = Claude Code, Cdx = Codex/ChatGPT desktop, Cur = Cursor, Dev = Devin Desktop (tidligere Windsurf), Zed, T3 = T3 Code, Pan = PandaCode, Her = Hermes, OC = OpenCode, Cli = Cline, Gse = Goose, Aid = Aider.

| Funksjon | CC | Cdx | Cur | Dev | Zed | T3 | Pan | Her | OC | Cli | Gse | Aid |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Skall | Electron | Electron | Electron | ? | Rust/GPUI | Electron | Tauri | Electron | Electron | Tauri | Electron, Tauri på vei | Terminal |
| Egne API-nøkler | D | D | D | ? | J | A | J | J | J | J | J | J |
| Planmodus | J | J | J | J | ? | A | D | ? | J | J | ? | D |
| Subagenter | J | J | J | J | J | A | J | J | J | J | J | ? |
| Parallelle økter | J | J | J | J | J | J | J | J | J | J | ? | ? |
| Git-worktrees | J | J | J | D | J | J | J | J | ? | J | ? | ? |
| Styre eller køe underveis | J | D | ? | ? | J | ? | J | D | ? | ? | ? | ? |
| Bakgrunnsoppgaver | J | J | J | ? | ? | A | D | ? | ? | D | ? | ? |
| MCP | J | J | J | ? | J | A | ? | ? | J | J | J | ? |
| Hooks eller plugins | J | ? | J | J | D | D | ? | D | D | J | ? | ? |
| Skills eller slash-kommandoer | J | J | J | D | ? | A | ? | J | J | J | D | D |
| Regler for tillatelser | J | J | J | D | J | A | D | D | J | J | J | ? |
| OS-sandkasse | J | J | J | ? | ? | A | ? | ? | ? | ? | N | ? |
| Sjekkpunkt eller angring | J | D | J | ? | J | J | ? | ? | J | J | ? | D |
| Komprimering | J | J | ? | ? | J | A | ? | ? | J | J | J | ? |
| Prosjektinstrukser | J | J | J | ? | ? | A | ? | ? | J | J | ? | ? |
| Varig minne | J | J | ? | J | ? | A | ? | J | ? | D | D | ? |
| Søk i historikk | J | D | J | ? | J | ? | ? | ? | ? | J | J | ? |
| Kostnad og tokens | J | D | ? | ? | D | ? | J | J | ? | J | D | D |
| Diff med linjekommentarer | J | J | ? | D | D | J | D | D | ? | J | ? | ? |
| Terminalpanel | J | J | J | ? | J | J | J | J | D | J | ? | N |
| Innebygd nettleser agenten styrer | J | J | J | ? | ? | J | D | ? | D | ? | ? | N |
| Localhost eller webmodus | N | D | ? | ? | ? | J | D | J | J | J | J | D |

Tabellen bygger på kildegruppene i avsnitt 9.

**Merknader til D-ene som betyr noe:**

- **CC, API-nøkler:** CLI-en støtter API-nøkkel. Desktop på Linux krever abonnement, SSO eller tredjepart som Bedrock og en LLM-gateway. Remote Control og Chrome-integrasjonen virker heller ikke med API-nøkkel. [2] [9] [10] Det er kanskje det sterkeste argumentet for brukerens egen app.
- **Cdx, API-nøkler:** Egne leverandører med `base_url` og `env_key` er dokumentert i konfigurasjonen. Om desktopappen fullt ut støtter det, er ikke verifisert. [20] [21]
- **Cur, API-nøkler:** Tab og Apply går alltid gjennom Cursor, og Composer-modellene virker ikke med egen nøkkel. Dette er forumsvar, ikke offisiell dokumentasjon. [30]
- **Dev, worktrees:** Dokumentasjonen gjelder Cascade (legacy). Støtte i Devin Local er ikke verifisert. [32]
- **Cdx, sjekkpunkt:** Diff-visningen har "Last turn", og hunks kan rulles tilbake, men appserverens `thread/rollback` er fjernet eller avviklet ifølge to motstridende sider. [16] [18]
- **Pan, Her og Zed, diff:** Diff-panel finnes, men linjekommentarer til agenten ble ikke bekreftet.
- **OC, nettleser:** Pakken `plugin-browser` finnes med omfattende verktøy, men en brukerrapport viser at verktøyene ikke ble registrert i desktop 2.2.2 på Windows. [61] [64]
- **Gse, sandkasse:** Den eksperimentelle macOS-sandkassen ble fjernet, og dokumentasjonen sier serveren kjører med brukerens rettigheter. [79]

---

## 4. Funn per område

### 4.1 Agent-løkke

- **Tillatelsesmoduser som arbeidsmodus.** Claude har Manual, Accept edits, Plan, Auto og Bypass, byttbart midt i økten. [1] Cursor har Auto-review, Allowlist og Run Everything. [25] Goose har Autonomous, Smart Approve, Approve og Chat. [75]
- **Styring uten avbrudd.** Enter under kjøring sender en korreksjon i Claude uten å stoppe. [1] Zed har en Steer-bryter som griper inn ved neste steg, og meldinger i kø kan redigeres. [37] Hermes og PandaCode har også kø. [48] [50]
- **Fortsettelse.** Claude gjenopptar økter fra lokale JSONL-filer. Verktøykall som ble avbrutt, kjøres ikke på nytt, og bakgrunnsarbeid som døde, vises som en merknad. [8]
- **Subagenter.** Egen kontekst, og resultatet går tilbake til hovedagenten. Claude kjører dem i bakgrunnen som standard. [12] Cursors `/multitask` og "Build in Parallel" kjører deler av en plan parallelt. [23]
- **Agent-team** er fortsatt eksperimentelt hos Claude, med kjente problemer ved gjenopptak og koordinering. Omtrent 7 ganger så mange tokens i planmodus. [6] [7] PandaCode har arkitekt pluss opptil tre arbeidere. [48]
- **Automasjoner.** Claude, Codex og Cline Desktop har planlagte oppgaver. [1] [13] [71]

### 4.2 Verktøy

Standardsettet er lesing, redigering, søk og kommandoer, pluss MCP. Claude har 33 hook-hendelser og fem handler-typer, og en hook kan blokkere, endre input eller erstatte output. [5] Skills lastes ved behov, og Claude ser bare beskrivelsene ved oppstart, noe som sparer kontekst. [7] [11] MCP-verktøy er utsatt som standard hos Claude, så bare navnene havner i konteksten. [7] Aider har et repokart som gir modellen oversikt. [81]

### 4.3 Sikkerhet

| | Linux-sandkasse | Nett | Standard |
|---|---|---|---|
| Codex | bwrap og seccomp | Av, valgfri proxy med domeneregler | På for versjonskontrollerte mapper [17] |
| Claude Code | bwrap, socat, seccomp | Nettverksnavnerom, proxy med tillatt-liste | Av [4] |
| Cursor | Landlock og seccomp, krever kjerne 6.2+ | Blokkert til nettmodus åpner | På i Auto-review [25] |
| Goose | Ingen | Ingen | [79] |

- Kjent kostnad på Ubuntu: Claude advarer om at 24.04+ kan kreve en AppArmor-profil for at bubblewrap skal lage brukernavnerom. [4]
- Alle tre beskytter sensitive stier selv i skrivbare mapper, for eksempel `.git/hooks` og agentens egen konfigurasjon. [4] [17] [25]
- Sandkassen dekker kommandoer, ikke alt: hos Claude ligger filverktøy, hooks og MCP-servere utenfor. [4]
- Sjekkpunkter finnes i to varianter. Claude tar øyeblikksbilder per prompt og fanger ikke filer som bare Bash har endret, heller ikke de fleste subagent-redigeringer. [3] Cline bruker et skjult git-repo etter hvert verktøykall og fanger også usporede filer. [66] T3 Code bruker skjulte git-refs og ruller tilbake kode og agent-samtale samlet. [44]
- Auto-godkjenning med språkmodell er ikke en sikkerhetsgrense, sier Cursor selv. [25] Goose hadde en sak der Smart Approve kunne overstyre en `ask`-regel, men vedlikeholder lukket den fordi formatet ikke var støttet. [75]

### 4.4 Kontekst

- `AGENTS.md` har blitt felles format: Cursor og OpenCode bruker det direkte, og Claude kan lese det. [11] [27] [58]
- Komprimering er standard. Goose starter ved 80 prosent eller 225 000 tokens. Claude legger prosjektinstrukser inn igjen fra disk etter komprimering, slik at de ikke går tapt. [11] [77]
- Claude kan komprimere deler av samtalen, fra eller frem til et valgt punkt. [3]
- Varig minne finnes hos Claude (auto memory), Codex (av som standard) og Hermes (Memory Graph). [11] [21] [50]
- Historikksøk: Cline har uklar søk over prompts, svar, kode og filnavn, og kan sortere på kostnad. [69] Goose har en Chat Recall-utvidelse så agenten selv kan søke. [78] Cursor lar agenten søke i tidligere samtaler. [26]

### 4.5 Modeller

- OpenCode, Zed, Cline, Goose, Aider og Hermes tar egne nøkler og mange leverandører. [40] [50] [58] [81]
- OpenAI-kompatibel endepunkt-støtte er vanlig. Zed støtter også Anthropic-kompatible. [40]
- Nøkkellagring: Zed bruker systemets nøkkelring, PandaCode bruker Secret Service på Linux, Hermes bruker OS-nøkkelringen for tilkoblingstokens. [40] [48] [50]
- Kostnadsvisning: Cline viser estimert kostnad i oppgavehodet. [69] Claudes `/usage` viser cache-treff, bom, sannsynlig årsak til bom og om cachen er varm. [7] Hermes kan vise cache-treff og tokens per sekund i statuslinjen. [50]
- Modellbytte midt i økten nullstiller prompt-cachen, og Hermes dokumenterer at neste melding blir dyrere. [50] Aider kan pinge for å holde cachen varm. [82]

### 4.6 UI

- **Paneler.** Claude Desktop har dra-og-slipp-paneler for chat, diff, nettleser, terminal, filer, plan, oppgaver og subagent. Panelene kan løsrives til egne vinduer. [1]
- **Samtalevisning.** Claude har tre nivåer: normal (verktøykall sammenfoldet), tenkning og detaljert. Ctrl+O bytter. [1]
- **Diff.** Codex har flest visninger: uoppført, oppført, commit, gren, siste tur. Stage og revert virker på fil og hunk. [16] T3 Code har siste tur, gren og arbeidstre. [44] Linjekommentar sendt tilbake til agenten er nå vanlig. [1] [16] [44]
- **Git og worktrees.** Codex har "Hand off" mellom hovedmappen og et worktree, `.worktreeinclude` for filer git ignorerer, og tar et øyeblikksbilde før et worktree slettes. [15] Windsurf og T3 har oppsettsskript per worktree. [32] [44]
- **Tastatur.** Claude har snarveier for ny økt, panel, modell og innsats, og Ctrl+/ viser alle. [1] Hermes har ⌘K-palett. [52]

### 4.7 Localhost og webmodus

| App | Oppstart | Binding | Autentisering |
|---|---|---|---|
| OpenCode (klassisk) | `opencode web` | 127.0.0.1, tilfeldig port | Valgfritt passord, usikret uten [55] |
| OpenCode v2 | Bakgrunnstjeneste | Localhost | Generert passord. Paringslenke brukes én gang, varer 5 min, gir cookie i 30 dager [56] |
| T3 Code | `t3` | Loopback uten eget valg | Engangs-paring, token i URL-hash, WebSocket-billett på ca. 5 min, rettigheter per økt [44] [45] |
| Hermes Webapp | Fra Desktop | Ikke bekreftet, dokumentasjonen nevner 127.0.0.1, LAN og offentlig URL | Engangslenke som varer 60 s [50] |
| Cline Kanban | `cline` | 127.0.0.1:3484 | Ingen token nevnt i dokumentasjonen [68] |
| Goose | `goose serve` | 127.0.0.1:3284 | Krever hemmelig nøkkel, kan overstyres med `--dangerously-unauthenticated` [76] |
| Codex app-server | `--listen` | Eksempler på loopback | stdio som standard. WebSocket er eksperimentell, med token [18] |
| Aider | `--browser` | ? | Eksperimentell, ingen detaljer [83] |
| Claude Code | Remote Control | Ingen innkommende porter | Bare utgående HTTPS mot Anthropic [9] |

**Hendelser som viser hvorfor dette må tas på alvor:**

- **OpenCode, CVE-2026-22812 (CVSS 8,8):** Serveren hadde ingen autentisering og tillot alle origins. Lokale prosesser eller en besøkt nettside kunne kjøre kommandoer. Fikset i 1.0.216. [65]
- **Claude Code-utvidelsen, CVE-2025-52882 (CVSS 8,8):** Lokal WebSocket godtok tilkoblinger fra alle origins. Fikset i 1.0.24. [88]
- **MCP Inspector, CVE-2025-49596:** Fikset ved å legge til økt-token og sjekk av Origin og Host, ifølge en sekundærkilde. [91]
- **Cline Kanban:** Dokumentasjonen advarer om at tilgang gir full tilgang til git-repo og terminal. [68]

**Oppskrift for en lokal server som kan kjøre kommandoer.** Punktene kombinerer MCP-spesifikasjonen og OWASP [87] [89] med det T3 og OpenCode gjør. Rekkefølgen og sammensetningen er min. [S]

1. Bind til `127.0.0.1`. Nettverkstilgang skal være et eget, bevisst valg, som hos T3. [45]
2. Generer et tilfeldig token per kjøring. Skriv det til en fil med rettighet 0600 og legg det i URL-fragmentet (`#`), som ikke sendes til serveren. Fjern det fra adressen etter bruk. [44]
3. Veksle tokenet inn i en `HttpOnly`, `SameSite=Strict`-cookie. Gi egne kortvarige billetter til WebSocket. [44] [89]
4. **Host-sjekk mot DNS rebinding:** Avvis alt som ikke er nøyaktig `127.0.0.1:port` eller `localhost:port`. Bare Origin er ikke nok når klienten ikke er en nettleser. Playwright MCP gjør det samme med `--allowed-hosts`. [92]
5. **Origin-sjekk:** Bruk en eksakt liste på alle tilstandsendrende kall og i WebSocket-upgrade, før `handleUpgrade`. Ingen jokertegn og ingen delstrengsmatch. [87] [89]
6. **Ingen CORS:** UI og API er samme origin, så ingen `Access-Control-Allow-Origin`-header trengs. Standard åpen CORS var en del av OpenCode-feilen. [65]
7. **Behandle UI-et som et angrepsmål.** Agentutdata og nettsider er upålitelig innhold. XSS i UI-et tilsvarer kommandokjøring. Bruk streng CSP og rensing av Markdown. [S]
8. **Forhåndsvisning skal aldri ha samme origin som appen.** [S]
9. **Hold tokenet unna agentens miljø.** T3 advarer om at en terminal eller fulltilgangsagent på verten kan nå tokens. [45]
10. **Ikke stol på nettleseren.** Chrome har fått tillatelsesprompt for offentlige sider mot loopback (fra Chrome 142), men sider på localhost er unntatt, og andre nettlesere er ikke sjekket. [90]
11. Lag automatiske tester med feil Host, fremmed Origin og manglende token. [S]

### 4.8 Nettleser og Playwright

Det finnes tre mønstre. [V]

1. **Innebygd i appen, med egen profil.** Claude, Codex, Cursor og T3. Agenten bruker egne verktøy eller CDP. Claude krever godkjenning per nettsted og har klassifiserere for skrivehandlinger. [1] Codex gir valgfri CDP-tilgang i utviklermodus. [14] Cursor gir hver økt et tilfeldig token og hver fane en egen ID, og holder lagring adskilt per arbeidsområde. [24]
2. **Utvidelse i brukerens ekte nettleser.** Claude bruker native messaging, Codex har Chrome-utvidelse, og Playwright har `--extension`. [10] [13] [92]
3. **Ekstern Playwright MCP.** Det enkleste. Åpner et eget vindu. [92]

**Viktige detaljer:**

- Playwright MCP anbefaler selv CLI pluss skills for kodeagenter fordi det bruker færre tokens, og MCP for lange løkker med vedvarende tilstand. README sier også tydelig at det ikke er en sikkerhetsgrense. [92]
- `browser_snapshot` bruker tilgjengelighetstreet, og det er det agenten kan handle ut fra. Skjermbilder er bare visuelle. [92] Cursor har skjermbildebasert klikking som reserve. [23]
- Playwright sin Electron-støtte er eksperimentell. `firstWindow()` dekker ikke innebygde visninger, og saken om BrowserView ble lukket som "not planned". [93] [94]
- `BrowserView` er avviklet til fordel for `WebContentsView`. [95]
- OpenCodes `plugin-browser` gir også sporing, CPU-profiler, heap-snapshots og Lighthouse. [61]
- Codex og Cursor lar brukeren peke på et element i siden og skrive en kommentar til agenten. [14] [23]

**Lokal test.** I Electron 44.9.3 dukket en `WebContentsView` opp som eget CDP-mål av typen `page`, ved siden av hovedvinduet, med `remote-debugging-port` satt via `appendSwitch`. `webContents.debugger` kunne også kjøre `Runtime.evaluate` direkte i panelet. [M] `connectOverCDP` fra Playwright ble ikke testet fordi Playwright ikke er installert her.

**Anbefaling** [S]:

- **Localhost-versjonen:** En nettside kan ikke legge inn vilkårlige sider, for mange nekter iframe. Start derfor en synlig Chromium via Playwright med egen profil, som et eget vindu. Eventuelt kan et panel vise CDP-skjermstrøm.
- **Electron-versjonen:** `WebContentsView` med egen `partition`, og `webContents.debugger` eller CDP. Debugger-API-et åpner ingen port. En åpen debug-port kan nås av andre lokale prosesser, så den må bare brukes bak samme token-sjekk eller unngås.

### 4.9 Ytelse

**Kjente klager:**

| App | Symptom | Årsak ifølge kilden |
|---|---|---|
| Cursor | Agentvindu fryser, renderer vokser | Renderer-lekkasjer. Mange lagrede samtaler stanser UI-tråden. Forumsvar fra ansatte [31] |
| Codex | Stor tråd gir 100 % CPU, renderer på 6,6 GiB etter 27 timer på Linux, diff-markering på 400 % CPU, frys ved annotering i nettleseren | GitHub-saker, ingen bekreftet rotårsak for Linux [105] |
| OpenCode | Ca. 20 fps på lange økter, frys ved ResizeObserver-løkke, uendelig layout ved gjenåpning | Manglende CSS-containment, skroll-til-bunn mot resize [62] [63] |
| Claude Desktop | 18+ s fra tasting til boble på Windows, ca. 30 s forsinkelse | Brukerrapporter som peker på renderer [104] |
| Hermes | Store differ frøs, høy CPU ved strømming, dra lå på 23 fps | Se under [51] [52] [53] |

Jeg fant ingen sak i Nous sitt repo som beskriver brukerens konkrete opplevelse av Hermes-lagg. Det nærmeste er en ubesvart diskusjon i et annet repo: https://github.com/NVIDIA/NemoClaw/discussions/12595.

**Hva prosjektene gjør, og hva det ga:**

Hermes er den beste kilden. De har målt.

- ResizeObserver per komponent førte til ca. 8 600 observatører. Én delt observatør med WeakMap kuttet callbacks fra 2 600 til 43. [53]
- Én TooltipProvider per bruk ga 52 784 omrendringer i ett dra. En provider på app-roten fjernet dem. [53]
- **Måleverktøyet deres var selv feil:** Det talte bilder dobbelt og rapporterte 3 fps for noe som gikk i 23 fps, så tidligere fikser så ut til å ikke virke. Typingtesten målte stort sett pauser. [53]
- Trinnvis lexing av Markdown under strømming ga 14 ganger lavere CPU. [51]
- Sidepanel og verktøyrader rendres ikke lenger på nytt per token, og verktøyargumenter serialiseres ikke på forhånd. [51]
- Diff-panelet ble virtualisert fordi full Shiki-utheving frøs det. Shiki og Mermaid ble flyttet ut av oppstarten. [51] [52]
- Kostnaden ved strømming er gjort uavhengig av transkriptlengde. Tidtakere stoppes i skjulte paneler, og polling er byttet ut med hendelser. [52]
- Resultat: dra med fem strømmende faner gikk fra 22,9 til 57,1 fps. [53]
- Hermes har også et tak på renderer-minne, slik at en lang økt lastes på nytt i stedet for å fryse maskinen. [50]

PandaCode velger arkitektur for å unngå problemet. Ingen bakgrunnspolling, ingen rekursiv filovervåking, agenter avslutter etter hver tur og gjenopptas med økt-ID, kode for terminal og Markdown lastes ved behov, og bare 100 meldinger per side er i minnet. Appen viser også et ressursbruk-panel. [48]

OpenCode: `contain: layout paint` på tidslinjeradene ga målbar gevinst i én brukers test på 320 turer. Ikke bekreftet av vedlikeholdere. [62]

Chromium-grunnlag: Kompositortråden kan skrolle uten hovedtråden så lenge området ikke har blokkerende hendelseslyttere, og `passive: true` hindrer at lyttere holder skrollingen igjen. [100] `content-visibility: auto` hopper over layout og tegning utenfor skjermen. [99] xterm.js har en WebGL-renderer, men WebGL-kontekst kan mistes, og appen må håndtere det. [101]

En ting til vurdering: et annet prosjekt fant at virtualisering var unødvendig etter at tvungen layout var fjernet. [107] Mål før du virtualiserer. [S]

**Ytelsesbudsjett for 240 Hz** [S]:

| Regel | Grunn |
|---|---|
| Skrolling skal gå på kompositortråden, ikke drives av JS | 4,17 ms holder ikke til JS og layout samtidig |
| Passive lyttere, ingen `scroll`-styrt layout | [100] |
| Strømming flushes med maks én oppdatering per frame eller sjeldnere, og rører bare siste blokk | [51] [52] |
| Tilstand med selektive abonnement, ingen global omrendring per token | [51] [53] |
| Utheving i Web Worker, på synlige linjer, med tak | [51] [105] |
| Én delt ResizeObserver, `contain` på rader | [53] [62] |
| Ingen `box-shadow`-animasjon eller `backdrop-filter` på store flater | Erfaringsbasert, ikke verifisert |
| Spor verste bilde og p99, ikke bare snitt | Målingen over viser at snittet skjuler 29 ms-hopp [M] |
| Mål på samme klokke som gesten, og test måleverktøyet | [53] |
| Ytelsestest i CI som feiler på regresjon | Hermes låser medianer av fem kjøringer [53] |

### 4.10 Versjon og bygg

- **Kanaler med byggnummer i taggen.** T3 bruker `v0.1.7-nightly.20261102.4093` for nattlige bygg og `v0.1.6` for stabile, med kort commit-hash i tittelen. [46] Dette er det beste mønsteret å kopiere.
- **Dato pluss semver.** Hermes bruker `v0.19.0 (v2026.7.20)`. [51] En rapport viser `Hermes Desktop 0.0.0 (built 2026-09-25)`, altså at versjonsfeltet kan bli stående tomt i bygg fra kilde. [54]
- **Byggnummer alene.** Devin bruker `3.11.238` og publiserer flere bygg per dag. [33]
- **Oppdateringsvalg.** Cursor har Default og Nightly. [29] PandaCode verifiserer signaturer og starter bare på nytt når ingen agent jobber. [48] Hermes tilbyr ett klikk og oppdaterer backend før desktop. [50]
- **Linux:** Claude oppdaterer ikke seg selv, men går via apt. [2] Hos PandaCode oppdaterer bare AppImage seg selv. [48]
- **Tilgjengelig i appen.** Hermes har Settings → About. [50] Cursor har kopiering av versjon fra About, ifølge en brukerrapport på forumet.
- **Electron:** `app.getVersion()` leser `package.json`. `applicationVersion` virker på alle plattformer, men `version` (byggnummer) i About-panelet gjelder bare macOS, og Linux har ingen standardverdier. Byggnummeret må altså vises i appens eget UI. [98]

---

## 5. Prioritert liste

### Må med i localhost-versjonen

1. **Server som eneste kjøringsgrense.** Bare serveren kjører prosesser, git og terminal. UI viser tilstand. Samme server brukes senere i Electron. T3 Code gjør dette, og Hermes og OpenCode bygger på samme idé. [44] [50] [56]
2. **Server-sikkerhet etter oppskriften i 4.7.** Kommandokjøring fra en nettside er den alvorligste feilen appen kan ha.
3. **Ytelsesbudsjett og måleverktøy fra dag én.** Det er det dyreste å legge til senere, og det var brukerens egen klage på Hermes.
4. **Virtualisert eller containment-styrt transkript, med trinnvis Markdown.** Hovedkilden til lagg i alle appene.
5. **Versjon, byggnummer, commit og byggdato** i statuslinje og Om-side, med "kopier info". Fast krav, og billig.
6. **Strømming, stopp, styring underveis og gjenopptak etter krasj.** Grunnleggende i alle appene.
7. **Permanent øktlagring i SQLite, med hendelseslogg.** Gir gjenopptak, søk og et ryddig grunnlag for parallelle økter. [44]
8. **Fil-, søk- og kommandoverktøy, pluss MCP-klient.** Standardsettet.
9. **Tillatelser med allow, ask og deny per mønster, og planmodus.** Standard hos alle seriøse aktører.
10. **Sjekkpunkter per tur som ruller tilbake kode og samtale samlet, basert på git.** Trygghet når agenten feiler, og forutsetningen for en god diff per tur.
11. **Parallelle økter og worktrees.** Finnes i nesten alle apper, og påvirker datamodellen. Bør ikke ettermonteres.
12. **Panelene: filer, terminal og diff med linjekommentarer.** Fast krav, og linjekommentarer er blitt standard.
13. **Synlig nettleser med Playwright.** Fast krav. Egen profil og eget vindu holder i denne versjonen.
14. **Flere leverandører med egne nøkler, modellbytte, og visning av kontekst, tokens, cache og kostnad.** Selve poenget med appen. Bruk leverandørkurser som kan oppdateres. Varsle at modellbytte kan nullstille cachen. [50]
15. **Prosjektinstrukser (`AGENTS.md`, `CLAUDE.md`) og komprimering.** Uten dem blir lange økter ubrukelige.

### Bør med i Electron-versjon 1

1. **Innfødt Wayland som standard, med automatisk reserve.** Electron 38+ gjør dette selv i Wayland-økter. [96] [97] Ved GPU-krasj: fall til `--ozone-platform=x11` og logg hvorfor. Se avsnitt 6.
2. **Nettleserpanel med `WebContentsView` og `webContents.debugger`.** Fyller kravet om innebygd nettleser, testet lokalt.
3. **OS-sandkasse med bubblewrap for kommandoer.** Tre av de fire store har det, og den kommer sammen med en AppArmor-kostnad på Ubuntu.
4. **Subagenter med eget panel, og bakgrunnsoppgaver.** Standard, men krever at grunnløkken er stabil.
5. **Hooks og skills.** Gir utvidbarhet uten at kjernen vokser.
6. **Varig minne og historikksøk.** Bruk FTS i SQLite. [S]
7. **Worktree-livssyklus:** Handoff, oppsettsskript, `.worktreeinclude`, øyeblikksbilde før sletting.
8. **Nøkkelring (Secret Service) for API-nøkler.** I localhost-versjonen må det være miljøvariabler eller en fil med 0600. [48]
9. **Kommandopalett og tastatursnarveier for alt.**
10. **Oppdatering med kanaler, som bare starter på nytt når ingen agent jobber.** [48]
11. **Sideprat, delte paneler og løsrevne vinduer.** Claude viser at dette gjør appen raskere i bruk.
12. **Diff med flere visninger og hunk-handlinger.**
13. **Merking av element i nettleseren.** Sparer mye forklaring, men Codex har en sak om minnevekst her på Linux, så vær forsiktig. [105]
14. **Automatisk verifisering med `launch.json` for utviklerserver.** [1]

### Kan vente

- PR- og CI-overvåking med auto-fiks.
- Agent-team. Eksperimentelt selv hos Claude, og dyrt.
- Planlagte oppgaver og automasjoner.
- Auto-godkjenning med modell som klassifiserer. Krever god evaluering.
- Fjerntilgang, mobil og tunneler. Sikkerhetsflaten øker mye.
- Skyøkter.
- Computer use.
- Plugin-marketplace og bots.
- Tale, kjæledyr, Memory Graph og lignende pynt.
- Best-of-N på tvers av modeller. Morsomt, men dyrt.
- ACP-støtte for eksterne agenter. Vurder når egen agent er stabil.
- WebMCP i nettleseren. [13]

---

## 6. Bevis mot stacken

**Ingen funn tilsier å bytte vekk fra Electron/TypeScript for disse kravene.** Følgende må håndteres:

1. **NVIDIA pluss Wayland kan krasje GPU-prosessen.** Hermes-sak: Electron 40.10.2, driver 615.71.09, KDE, RTX 4060, oppstartskrasj med `error_code=1002`. Bare XWayland fungerte. [54] Logseq har en lignende rapport med driver 595. [106] Ikke din kombinasjon: du har driver 610.43.02 og GNOME, og alle testene her gikk fint. [M] **Men en driveroppdatering kan utløse det.** [S] Derfor er automatisk reserve og visning av hvilken plattform som kjører viktig.
2. **Hermes løste dette ved å holde NVIDIA på XWayland som standard.** [54] Hvis Hermes-versjonen din bruker denne standarden, kan det forklare noe av lagget, men det er ikke testet. [S] XWayland ga dårligere verste-bilde her. [M]
3. **Flerskjerm med ulik frekvens** kan gi 60 Hz-låsing, ifølge eldre rapporter om Mutter og NVIDIA. Ikke testet, men maskinen ser ut til å ha én skjerm. [S]
4. **Windows-tak** på ca. 4 GB renderer-minne er uvesentlig for Ubuntu, men minnevekst er reell. [31]

**Tauri som sammenligning.** Agentglass gikk fra Tauri til Electron fordi WebKitGTK ikke har GPU-prosess på Linux, med ca. 115 % CPU på tomgang. [102] Paseo gikk samme vei og nevner Wayland og ulik rendering. [103] OpenCode er bekreftet på Electron 44.9.1 med SolidJS [60], men årsaken til byttet fra Tauri fant jeg bare i en sekundærkilde. Cline Desktop og PandaCode bruker Tauri. PandaCode beskriver Linux som forhåndsversjon. [49] [71] Goose går også mot Tauri. [80]

**Valg av UI-rammeverk er ikke vurdert her,** men jeg noterer at OpenCode bruker SolidJS, PandaCode ren TypeScript, mens T3 og Hermes bruker React. Hermes-erfaringene viser hva som må til for å få React-trær raske ved strømming. [48] [51] [60]

**Zed** viser hva en egen GPU-renderer gir, men det er et annet prosjekt enn dette, og tallene er egne påstander uten uavhengig måling. [42]

---

## 7. Uvanlig gode ideer verdt å stjele

| Idé | Fra | Hvorfor |
|---|---|---|
| Spole tilbake med valg: kode, samtale eller begge, pluss "oppsummer herfra" | Claude [3] | Skiller "feil kode" fra "feil retning" |
| Sannsynlig årsak til cache-bom vises til brukeren | Claude [7] | Gjør kostnadslekkasjer synlige. Særlig nyttig med egne nøkler |
| Skjulte git-refs for sjekkpunkter | T3 [44] | Ingen filkopiering, og diff per tur kommer gratis |
| Token i URL-hash og kortvarig WebSocket-billett | T3 [44] | Enkel og sterk lokal paring |
| Skjult git-repo etter hvert verktøykall | Cline [66] | Fanger også Bash-endringer, som Claude mister |
| `doom_loop`: spør når samme kall gjentas tre ganger | OpenCode [57] | Sparer penger når agenten står fast |
| `.env` krever godkjenning selv når lesing er tillatt | OpenCode [57] | Lav kost, høy verdi |
| Godkjenning med `once`, `always`, `reject` | OpenCode [57] | Klar og rask flyt |
| Agenter avslutter etter hver tur, gjenopptas med ID | PandaCode [48] | Null bakgrunnskostnad |
| Ressursbruk-panel inne i appen | PandaCode [48] | Gjør "lett og fresh" målbart |
| Oppdatering bare når ingen agent jobber | PandaCode [48] | Ødelegger aldri en kjøring |
| Sammenslåing nekter ved konflikter og endrer ingenting | PandaCode [48] | Trygg standard |
| Markører for hver prompt langs transkriptet | Hermes [50] | Rask navigering i lange økter |
| Lesepunkt huskes per økt, kladd overlever at økten forsvinner | Hermes [50] | Billig og merkes godt |
| Tak på renderer-minne, last på nytt i stedet for frys | Hermes [50] | Beskytter maskinen |
| Oppvarming av backend ved hover | Hermes [51] | Føles umiddelbart |
| Arkivering lagrer git-tilstand, gjenoppretting henter worktree | Zed [38] | Rydder disk uten å miste noe |
| Korreksjon uten å stoppe | Claude [1] | Bedre flyt enn stopp og omstart |
| Sideprat utenfor hovedkonteksten | Claude, Codex [1] [19] | Sparer tokens |
| Egen modell for gjennomgang (`review_model`) | Codex [16] | Billig modell kan skrive, en sterk kan vurdere |
| Øyeblikksbilde før worktree slettes | Codex [15] | Ingen tapt arbeid |
| Skille mellom "verktøy finnes" og "verktøy krever godkjenning" | Zed [39] | Tydelig modell |
| Tilfeldig token per nettleserøkt og unik fane-ID | Cursor [24] | Hindrer kryss-påvirkning |
| Agenten kan vente på en bestemt tekst i bakgrunnsoppgave | Cursor [23] | Slipper polling og tokensløsing |
| Arkitekt pluss redigeringsmodell | Aider [84] | Dyr tenking, billig utførelse |
| Lighthouse og heap-snapshot som agentverktøy | OpenCode [61] | Agenten kan selv finne ytelsesfeil |
| Diagnostikkpakke med siste 4 MB logg | Devin [33] | Brukeren kan sende et komplett bilde |
| Ytelsestest som låser medianer, og lint-regel mot kjente feilmønstre | Hermes [52] [53] | Hindrer tilbakefall |

---

## 8. Ikke verifisert

- **Cursor og Windsurf:** Egne API-nøkler er bare belyst via forum for Cursor. For Devin Desktop fant jeg ingen dokumentasjon. Om Cascade er helt fjernet i stabil versjon er uklart: en neste-kanal sier ja, stabil changelog viser fortsatt migrering. [33] [34]
- **Hermes:** Lesing av desktop-dokumentasjonen var delvis. Jeg fikk ikke bekreftet bindingsadresse for Webapp, om agenten kan styre en innebygd nettleser, eller hvor byggnummer vises. Sakene for v0.22 ble ikke lest i detalj.
- **T3 Code:** Forhåndsvisningsverktøy er bekreftet i offisielle versjonsnotater, men Playwright-detaljene kommer fra en fork og en PR i et tredjeparts-repo. [46] [47] TTL for paringslenker står ikke i dokumentasjonen.
- **PandaCode:** Agentens kontroll over nettleseren er ikke bekreftet. Linux er forhåndsversjon. [49]
- **Goose:** Flagg for `goose web` kom fra en tredjeparts kopi, så bare `goose serve` er bekreftet offisielt.
- **Aider:** Historikksiden har ingen datoer, så aktivitetsnivået er uklart. Hovedgrenen har modellstøtte frem til GPT-5.4 og Claude 4.6. [86]
- **Chrome LNA:** De mest detaljerte Google-kildene er fra 2025.
- **`connectOverCDP` mot Electron:** Bare målet er bekreftet lokalt, ikke selve Playwright-tilkoblingen.
- **Electron-baserte klager:** De fleste er brukerrapporter på Windows eller macOS.

---

## 9. Kilder

Alle hentet 2026-11-02.

**Claude Code**
1. https://code.claude.com/docs/en/desktop.md
2. https://code.claude.com/docs/en/desktop-linux.md
3. https://code.claude.com/docs/en/checkpointing.md
4. https://code.claude.com/docs/en/sandboxing.md
5. https://code.claude.com/docs/en/hooks.md
6. https://code.claude.com/docs/en/agent-teams.md
7. https://code.claude.com/docs/en/costs.md
8. https://code.claude.com/docs/en/sessions
9. https://code.claude.com/docs/en/remote-control.md
10. https://code.claude.com/docs/en/chrome
11. https://code.claude.com/docs/en/memory
12. https://code.claude.com/docs/en/sub-agents

**Codex og ChatGPT desktop**

13. https://learn.chatgpt.com/docs/whats-new
14. https://learn.chatgpt.com/docs/browser?surface=app
15. https://learn.chatgpt.com/docs/environments/git-worktrees
16. https://learn.chatgpt.com/docs/code-review?surface=app
17. https://learn.chatgpt.com/docs/agent-approvals-security
18. https://learn.chatgpt.com/docs/app-server
19. https://learn.chatgpt.com/docs/cli/slash-commands
20. https://developers.openai.com/codex/config-advanced
21. https://developers.openai.com/codex/config-reference

**Cursor**

22. https://cursor.com/changelog
23. https://cursor.com/changelog/3-0 og https://cursor.com/changelog/04-24-26 og https://cursor.com/changelog/05-07-26
24. https://cursor.com/docs/agent/browser
25. https://cursor.com/docs/agent/security/run-modes og https://cursor.com/blog/agent-sandboxing
26. https://cursor.com/docs/agent/overview og https://cursor.com/help/ai-features/agent.md
27. https://cursor.com/docs/rules
28. https://cursor.com/docs/mcp
29. https://cursor.com/docs/account/update-access
30. https://forum.cursor.com/t/when-will-cursor-fully-support-byok/164375 (forum)
31. https://forum.cursor.com/t/excessive-memory-usage-by-cursor-renderer/158856 og https://forum.cursor.com/t/cursor-3-16-17-agent-window-intermittently-freezes-during-long-agent-runs-main-process-reaches-99-cpu/168695 (forum)

**Devin Desktop (tidligere Windsurf)**

32. https://docs.devin.ai/desktop/cascade/worktrees.md
33. https://docs.devin.ai/desktop/changelog
34. https://docs.devin.ai/desktop/changelog-next
35. https://devin.ai/blog/windsurf-is-now-devin-desktop
36. https://docs.devin.ai/desktop/devin-desktop-faq

**Zed**

37. https://zed.dev/docs/ai/agent-panel
38. https://zed.dev/docs/ai/parallel-agents
39. https://zed.dev/docs/ai/tool-permissions og https://zed.dev/docs/ai/agent-profiles
40. https://zed.dev/docs/ai/use-api-access
41. https://zed.dev/docs/ai/external-agents
42. https://zed.dev/blog/videogame og https://zed.dev/docs/ai/tools

**T3 Code**

43. https://github.com/pingdotgg/t3code
44. https://flaviocopes.com/t3-code (sekundær, detaljert)
45. https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md
46. https://github.com/pingdotgg/t3code/releases
47. https://github.com/Lazurio/t3code/releases/tag/v0.0.45-preview.20261013.1 og https://github.com/ryan-stoffel/parallax/pull/665 (tredjepart)

**PandaCode**

48. https://github.com/aicodeking/pandacode
49. https://github.com/aicodeking/pandacode/blob/main/docs/platform-support.md

**Hermes**

50. https://hermes-agent.nousresearch.com/docs/user-guide/desktop
51. https://github.com/NousResearch/hermes-agent/releases/tag/v2026.7.20
52. https://github.com/NousResearch/hermes-agent/releases/tag/v2026.8.3
53. https://github.com/NousResearch/hermes-agent/pull/72346
54. https://github.com/NousResearch/hermes-agent/issues/126013

**OpenCode**

55. https://opencode.ai/docs/web
56. https://opencode.ai/v2/docs/cli/web/
57. https://opencode.ai/docs/permissions
58. https://opencode.ai/docs/
59. https://opencode.ai/v2/docs/snapshots/
60. https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/desktop/package.json
61. https://github.com/anomalyco/opencode/tree/dev/packages/plugin-browser
62. https://github.com/anomalyco/opencode/issues/54291
63. https://github.com/anomalyco/opencode/issues/56229 og https://github.com/anomalyco/opencode/issues/58127
64. https://github.com/anomalyco/opencode/issues/60519
65. https://advisories.gitlab.com/npm/opencode-ai/CVE-2026-22812/ og https://db.gcve.eu/vuln/CVE-2026-22812

**Cline og Roo**

66. https://docs.cline.bot/core-workflows/checkpoints.md
67. https://docs.cline.bot/features/subagents.md
68. https://docs.cline.bot/usage/kanban og https://docs.cline.bot/kanban/remote-access.md
69. https://docs.cline.bot/core-workflows/task-management
70. https://docs.cline.bot/features/auto-compact
71. https://cline.bot/blog/cline-desktop-an-open-source-app-for-open-weight-models
72. https://github.com/cline/cline
73. https://docs.cline.bot/features/auto-approve
74. https://github.com/RooCodeInc/Roo-Code

**Goose**

75. https://goose-docs.ai/docs/guides/managing-tools/goose-permissions/ og https://github.com/aaif-goose/goose/issues/11017
76. https://goose-docs.ai/docs/guides/goose-cli-commands/
77. https://goose-docs.ai/docs/guides/sessions/smart-context-management/
78. https://goose-docs.ai/docs/mcp/chatrecall-mcp/
79. https://goose-docs.ai/blog/2026/02/23/goose-v1-25-0/
80. https://goose-docs.ai/blog/2026/04/08/goose-acp-and-new-tui

**Aider**

81. https://aider.chat/docs/
82. https://aider.chat/docs/usage/commands.html og https://aider.chat/docs/config/options.html
83. https://aider.chat/docs/usage/browser.html
84. https://aider.chat/docs/usage/modes.html
85. https://aider.chat/docs/git.html
86. https://aider.chat/HISTORY.html

**Sikkerhet**

87. https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
88. https://securitylabs.datadoghq.com/articles/claude-mcp-cve-2025-52882/
89. https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
90. https://developer.chrome.com/blog/local-network-access og https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access
91. https://www.agenticwire.news/article/mcp-dns-rebinding-fix (sekundær)

**Nettleser og Playwright**

92. https://github.com/microsoft/playwright-mcp
93. https://playwright.dev/docs/api/class-electron
94. https://github.com/microsoft/playwright/issues/39507 og https://github.com/microsoft/playwright/issues/39008
95. https://www.electronjs.org/docs/latest/api/web-contents-view

**Electron og ytelse**

96. https://www.electronjs.org/blog/electron-38-0
97. https://www.electronjs.org/docs/latest/breaking-changes
98. https://www.electronjs.org/docs/latest/api/app
99. https://web.dev/articles/content-visibility
100. https://developer.chrome.com/blog/passive-event-listeners og https://developer.chrome.com/blog/inside-browser-part4
101. https://cdn.jsdelivr.net/npm/@xterm/addon-webgl@0.19.0/README.md
102. https://github.com/SirAllap/agentglass/releases/tag/v0.2.1
103. https://paseo.sh/blog/i-was-wrong-about-electron
104. https://github.com/anthropics/claude-code/issues/31643 og https://claudeissues.com/issue/77944-bug-desktop-app-code-30s-delay-before-any-response-on-every-prompt-including-fir
105. https://github.com/openai/codex/issues/52088, https://github.com/openai/codex/issues/25251, https://github.com/openai/codex/issues/55225 og https://github.com/openai/codex/issues/57323
106. https://github.com/logseq/logseq/issues/13554
107. https://github.com/get-bb/bb/pull/898
