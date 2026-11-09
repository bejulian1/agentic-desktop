# Serveren: oppstart, arkitektur og API

Kort veiledning for den som bygger UI-et. `shared/protocol.ts` er kontrakten, og her står det koden ikke sier selv.

## Oppstart

| Kommando | Hva den gjør |
|---|---|
| `npm install` | Installerer. `node-pty` bygges fra kilde, så `g++`, `make` og `python3` må finnes. |
| `npm start` | Bygger `web/` hvis det er utdatert, starter serveren og åpner lenken. `npm start -- --no-open` åpner ikke. |
| `npm run build` | Produksjonsbygg: øker `build` i `version.json` og skriver `web/dist/build-info.json`. |
| `npm test` | Typesjekk og alle tester. |
| `npm run e2e` | Ende-til-ende uten UI, med ekte Chrome. |
| `AD_DATA_DIR=/tmp/x npm run seed:perf` | Lager en tråd med 5 000 meldinger for `npm run perf`, og skriver tråd-ID-en. |

Miljøvariabler: `AD_DATA_DIR`, `AD_PORT` (`0` gir ledig port), `AD_WEB_DIST`, `AD_BROWSER_IDLE_MS`, `AD_MOCK_DELAY_MS`.

Serveren kjører TypeScript direkte med Node 26, uten byggsteg. UI-et må ha et `build`-skript i `web/package.json` som lager `web/dist/index.html`. Filer under `web/dist/assets/` får lang cache, så de må ha hash i navnet.

**Bruk bygd UI gjennom serveren under utvikling** (`vite build --watch`). Origin-sjekken stopper Vite sin dev-server, og den skal ikke svekkes for å få det til.

**For automatiske tester:** Start `node server/src/index.ts --no-open` med `AD_PORT=0` og midlertidig `AD_DATA_DIR`, og les lenken fra stdout: `http://127.0.0.1:<port>/#token=<token>`. Token-filen slettes ved første innlogging, men tokenet virker så lenge serveren lever.

## Arkitektur

```
server/src/
  index.ts  app.ts     oppstart og kobling av alt
  config.ts  env.ts  paths.ts  secrets.ts  errors.ts
  db.ts                SQLite: all lagring
  http/  security.ts   Host, Origin, cookie, billetter, CSP
         api.ts        REST
         ws.ts         WebSocket-nav, ett per vindu
         static.ts     web/dist
  agent/ runner.ts     løkka, kø, godkjenning, stopp, gjenoppretting
         tools.ts      verktøyene
         collab.ts     thread_*-verktøyene og bremsene
         permissions.ts  context.ts  turns.ts  filestate.ts  events.ts  command.ts
  providers/           openai-compatible, anthropic, mock
  terminal.ts  browser.ts  playtest.ts  skills.ts  files.ts
  artifacts.ts         artifacts i SQLite, én tidligere versjon
  preview.ts           forhåndsvisningsserveren for artifacts, egen port
```

- `events` er det UI-et spiller av. `messages` er det modellen ser, og det kan komprimering skrive om. De to er adskilt med vilje.
- All kjøring er knyttet til tråd i `Runner.active`.
- Hver klient har én WebSocket. Tråder, terminaler og nettleser har sett av abonnenter, så flere vinduer kan følge det samme.

## Innlogging

1. Les `#token=` fra adressen og **fjern det fra adressen med en gang** (`history.replaceState`).
2. `POST /api/auth/exchange` med `{ token }`. Det gir en `HttpOnly`-cookie.
3. `GET /api/bootstrap`. Svarer det 401, må brukeren bruke lenken fra terminalen. Tokenet er nytt for hver kjøring.
4. `POST /api/ws-ticket`, og koble til `ws://<samme host>/ws?ticket=...` innen 30 sekunder. Billetten virker én gang, så hent en ny ved hver gjenkobling.

Alle kall som endrer noe, må ha `Content-Type: application/json` når de har innhold. `fetch` fra samme origin sender riktig `Origin` selv.

**CSP:** Ingen inline-skript. Temaet må derfor settes av en liten egen `.js`-fil som lastes blokkerende i `<head>`, og den kan lese valget fra `localStorage` for å unngå blink. `style-src` tillater inline fordi CodeMirror og xterm trenger det. Web Workers må ligge som egne filer på samme origin, ikke som `blob:`.

## Tråder og hendelser

- Last slutten av en tråd med `GET /api/threads/:id/events?tail=500`, og abonner med `thread.subscribe` og `afterSeq` lik siste `seq`. Bruk `after` og `limit` for å laste eldre eller alt.
- `thread.subscribe` sender det som mangler, så live hendelser, uten hull. Ved gjenkobling sender du siste `seq` du har.
- Ruter abonnerer bare på sin egen tråd. `thread.changed` og de andre globale meldingene går til alle, så sidefanen trenger ingen abonnement.

| Hendelse | Hva UI-et gjør |
|---|---|
| `user.queued`, så `user.message` med samme `messageId` | Vis i kø, og flytt inn i samtalen når den slippes. |
| `text.delta` per `messageId` | Hvert modellsteg har egen `messageId`. Deltaene er slått sammen til maks én per 24 ms. |
| `thinking.delta`, `thinking.done` | Tenkeraden. `blockId` binder dem sammen. |
| `tool.started` | `status` er `running` eller `awaiting-approval`. |
| `approval.requested` | Vis kortet. Svar med `POST /api/approvals/:id`. Vis **Tillat alltid** bare når `canAllowAlways` er sann. |
| `approval.resolved` | Etter `allow` kjører verktøyet. |
| `tool.output` | Live utdata, koblet på `callId`. |
| `tool.finished` | `screenshotId` vises med `GET /api/screenshots/:id`. |
| `turn.changes` | Rad for filendringer. Hent diff med `GET /api/turns/:turnId/diff`. |
| `usage` | Akkumulert per tråd. `contextTokens` er siste steg. `costUsd` er `null` uten pris. |
| `project.usage` (ServerMessage) | Statuslinjens sum for prosjektet. |
| `context.compacted` | Rad i samtalen. |
| `thread.spawned` | Rad med lenke til barnetråden. |
| `run.finished` | `status`: `done`, `stopped`, `error` eller `interrupted`. |

`POST /api/turns/:id/revert` svarer 409 med `conflicts` hvis en fil er endret etter turen. Spør brukeren, og send `{ "force": true }` for å overskrive. Si også i panelet at endringer gjort av kommandoer ikke fanges.

Etter **Stopp** blir meldinger i kø stående i samtalen, men de startes ikke. Den neste meldingen tar dem med.

## `/`, `@` og `!`

- `GET /api/projects/:id/commands` gir innebygde kommandoer og skills. `/api/commands` er det samme uten prosjekt.
- De innebygde kommandoene utføres av UI-et: `/ny`, `/modus`, `/modell`, `/hjelp`, `/komprimer` (`POST /api/threads/:id/compact`), `/angre` (`POST /api/turns/:id/revert`), `/playtest` og `/vscode`.
- En skill sendes med `POST /api/threads/:id/messages` og `{ text: "<argumenter>", skill: "<navn>" }`.
- `GET /api/projects/:id/mentions?q=` gir filer, mapper og tråder. Svaret er bufret i 10 sekunder og tømmes når filer endres.
- `@`-vedlegg sendes som `attachments: [{ kind: "file", path }, { kind: "dir", path }, { kind: "thread", threadId }]`. Innholdet går bare til modellen, mens `user.message.attachments` har det brikkene trenger.
- `!npm test` sendes som `{ text: "", shell: "npm test" }`. Det blir en kjøring uten modellkall, med vanlig godkjenning og vanlige verktøyhendelser.

## Ruter og flere vinduer

- `PUT /api/projects/:id/layout` med `{ layout }` lagrer rutenettet som fritt JSON, maks 64 kB. Bruk `chat` som id for tråder uten prosjekt.
- Andre vinduer får `project.layout`. Sammenlign med din egen tilstand så du ikke går i ring.
- Alt som endrer delt tilstand, sendes til alle vinduer: `thread.changed`, `thread.deleted`, `project.changed`, `project.deleted`, `settings.changed`, `playtest.state` og `project.files-changed`.
- `settings.autoOpenAgentThreads`: Når `thread.changed` viser en ny tråd med `origin: "agent"`, kan den åpnes i en ny rute.
- `Thread.pendingApprovals` er merket i sidefanen. `parentThreadId` viser hvem som lagde tråden.
- `POST /api/projects/:id/stop-all` er **Stopp alt**.

## Terminal

- `terminal.open` uten `terminalId` lager en ny fane. Med `terminalId` kobler den til igjen, og `terminal.opened.replay` skal skrives til xterm først.
- `GET /api/projects/:id/terminals` lister fanene etter sidelast. Terminaler lever til de lukkes eller serveren stopper.
- Flere vinduer kan koble til samme terminal. Siste `resize` gjelder for alle.

## Nettleser

- `browser.open` med størrelsen på canvaset starter Chrome ved behov. Det kan ta et sekund.
- Tegn hver `browser.frame`, og send `browser.frame-ack` med samme `sessionId`. Uten ack stopper strømmen, så det er også mottrykket.
- `browser.close` når panelet lukkes. Da stopper skjermstrømmen.
- `browser.input`: `modifiers` er CDP-bitmasken Alt=1, Ctrl=2, Meta=4, Shift=8. `button` er `left`, `middle`, `right` eller `none`.
- Bare `http`, `https` og `about:blank` kan åpnes, og aldri appen selv. Feil kommer som `{ type: "error" }`.
- Agenten og panelet deler siden. En lenke som åpner ny fane, åpnes i samme side.
- `browser.closed` betyr at Chrome stoppet eller ble lukket etter inaktivitet. Send `browser.open` igjen ved behov.

## Playtest

`POST /api/projects/:id/playtest/start` svarer med en gang. Følg `playtest.state`.

- Med `dev` eller `start` i `package.json`: `status: "starting"` og `terminalId`, som åpnes med `terminal.open`.
- Ellers `running` med statisk tjener.

Når den kjører, åpner serveren adressen i nettlesersiden selv. Adressen er alltid `http://localhost:<annen port>/`, så cookien på `127.0.0.1` ikke følger med. Punktfiler som `.env` serveres aldri.

## Artifacts

Artifacts er globale, ikke per prosjekt. Listen (`GET /api/artifacts`, og `artifacts` i bootstrap) har aldri HTML-en med; hent den med `GET /api/artifacts/:id`. Endringer sendes til alle vinduer som `artifact.changed` og `artifact.deleted`.

- **Forhåndsvisning:** `previewUrl` er `http://localhost:<egen port>/a/<id>/<nøkkel>`, der nøkkelen er en HMAC av ID-en med en hemmelighet som er ny for hver kjøring. Lag iframen med `sandbox="allow-scripts allow-modals"` og aldri `allow-same-origin`. Siden leses fra databasen ved hver lasting, så samme adresse viser det som sist ble lagret.
- **Kort i chatten:** `POST /api/previews` med `{ html }` gir en adresse `/s/<tilfeldig token>` til et øyeblikksbilde i minnet (maks 64 eller 32 MB, eldste går først). Samme HTML gir samme adresse.
- **Hvilken blokk:** `messageId` og `sourceKey` (en hash av blokken som UI-et regner ut) gjør at kortet ser at blokken er lagret.
- **Nedlasting:** `GET /api/artifacts/:id/download` er et vedlegg med `Content-Security-Policy: sandbox`, så det vises aldri på appens origin.
- Appens CSP har `frame-src` med akkurat forhåndsvisningens origin. Forhåndsvisningsserveren svarer bare på `GET` og `HEAD`, bare med riktig `Host`, og leser aldri fra disken. Feil nøkkel gir samme 404 som en artifact som ikke finnes.

## Startsiden, grenen og arkiverte tråder (0.4)

- **`GET /api/stats?range=all|30d|7d`** gir `HomeStats` til statistikk-kortet: økter (tråder med minst én kjøring i perioden), meldinger, tokens, aktive dager, rekker, topptime, favorittmodell, bruk per modell og et aktivitetskart med dagene fra mandag for 25 uker siden til i dag. Tallene regnes ut fra samme `usage`-hendelser som `GET /api/profile`, som nå også har `costUsd` (summen der pris er satt, ellers `null`). Ugyldig periode gir 400.
- **`GET /api/projects/:id/git`** gir `{ branch, detached }`, lest fra `.git/HEAD` i prosjektmappen (`server/src/git-head.ts`). En `.git`-fil med `gitdir:` følges, slik worktrees og submoduler har det. Ingen git-kommando kjøres, og modulen kan ikke starte prosesser. Lest på nytt ved hvert kall.
- **`GET /api/threads/archived`** gir arkiverte tråder, nyeste først. Gjenopprett er `PATCH /api/threads/:id` med `{ archived: false }` som før.
- **`Settings.homeStats`**: `false` skjuler kortet. Bare `true` slår det på igjen.

## Samarbeid

Verktøyene er `thread_list`, `thread_create`, `thread_send`, `thread_read` og `thread_wait`. Grensene ligger i `agent/collab.ts`:

| Brems | Verdi | Når den slår inn |
|---|---|---|
| `MAX_DEPTH` | 2 | Verktøyet feiler |
| `MAX_AGENT_THREADS` | 4 per prosjekt | Verktøyet feiler |
| `MAX_THREAD_MESSAGES` | 20 per brukermelding | Godkjenningskort, også i Full tilgang. Tillat gir 20 til. |
| `permissionCap` | Skaperens modus | Settes når tråden lages |

## Demo-modellen

Skriv `hjelp` for listen. `lag en side` kjører hele flyten, `godkjenning` gir et kort uansett modus, `rediger` endrer filen, `samarbeid` lager en hjelpetråd, `lang kommando` kan stoppes, `løkke` utløser bremsen, `feil` viser et verktøy som feiler, og `lang strøm 200000` er for ytelsestest, og `artifact` eller `html-spill` gir et lite HTML-spill i en `html`-blokk. Med `rolig` til slutt, som i `lang strøm 10000 rolig`, strømmer den 2,5 kB/s, omtrent som en rask ekte modell. I Chat-modus svarer den med Markdown og kodeblokker.
