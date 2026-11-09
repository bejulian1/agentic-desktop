# Regler for agentene i produksjonsrunden (SPEC del 29)

Disse reglene gjelder alle agentene som jobber med Electron-porten og optimaliseringen. Et brudd på dem er alvorlig. Er du i tvil, gjør du mindre og skriver det i rapporten.

## Brukerens maskin
- **Ingen vinduer på brukerens skjerm.**
  - Electron startes bare under `xvfb-run -a …` eller med `--ozone-platform=headless`.
  - Chrome og Playwright kjører headless.
  - Kjør aldri `electron .` eller den pakkede appen uten en av disse.
  - **Electron 45 velger Wayland når `WAYLAND_DISPLAY` er satt, også under `xvfb-run`.** Da havner vinduet på brukerens skjerm. Fjern derfor alltid variabelen (`env -u WAYLAND_DISPLAY`) og sett `--ozone-platform=x11` under xvfb eller `--ozone-platform=headless`. Bruk `npm run test:desktop` eller hjelperne i `desktop/test/`, som nekter å starte uten dette.
- **Minnet:**
  - `MemAvailable` i `/proc/meminfo` skal aldri under 4 GB.
  - Sjekk minnet før tunge steg: bygg, pakking, Electron, Chrome, hele testpakker og perf. Kommandoen er `awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo`.
  - Er det under 8192 MB ledig, vent og sjekk igjen, eller kjør med lavere samtidighet.
  - Flere agenter jobber samtidig, så ingen kjører mer enn én hel UI-testpakke om gangen.
- **Ingen git-kommandoer i det hele tatt.**
- **Ingen sudo og ingen systeminstallasjon.** Ikke rør `/usr`, `/opt` eller `/etc`.
- **Brukerens porter er 4317 (Agentic Desktop) og 4318 (Agentic Rigg).** Ikke start noe på dem, og ikke stopp noe som kjører der.
- **Brukerens ekte mapper skal aldri røres:**
  - `~/.config/agentic-desktop`
  - `~/.local/share/agentic-desktop`
  - `~/.local/opt`
  - `~/.local/share/applications`
  - `~/.local/share/icons`
  - `~/.config/google-chrome`, `~/.config/chromium` og `~/.mozilla`
  - nøkkelringen og ekte `secret-tool`
  - nedlastingsmappen
- **Bruk alltid midlertidige mapper.** Sett `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME` og `AD_DATA_DIR` til midlertidige mapper, også i engangsskript. `scripts/install-local.ts` testes bare med en midlertidig `HOME`.

## Nettverk og avhengigheter
- **Tillatte nedlastinger:** bare `npm install -D --save-exact` av `electron`, `electron-builder` og `@electron/rebuild`, og det disse selv laster ned: Electron-binæren og verktøyene til electron-builder. Andre pakker krever at du først spør koordinatoren.
- **Ingen ekte API-nøkler, betalte kall, GitHub-kall eller nettsøk.** Bruk mock og lokale falske servere.

## Prosesser
- **Stopp bare én prosess om gangen, og bare en med kjent PID.**
  - Hent PID-en fra `$!` eller `child.pid`.
  - Finn barneprosessene med `pgrep -P <pid>` rekursivt.
  - Sjekk hver PID med `ps -o pid,cmd -p <pid>` før `kill`.
- Bruk aldri `pkill`, `killall`, `pkill -f` eller `kill` på en liste du har bygget med awk.
- Brukeren kjører selv Chrome, Electron-apper, Claude og andre programmer. Rør aldri dem.

## Det koordinatoren gjør
- Agentene kjører ikke `npm run build` eller `npm start`. De skriver ikke til `web/dist` og ikke til den ekte installasjonen.
- Agentene redigerer ikke `version.json`, versjonen i `package.json`, `docs/PATCHLOG.md` eller `docs/STATUS.md`.
- `npm run dist` er lov og skriver til `dist-desktop/`.
- Agentene bygger web til en midlertidig mappe, slik: `D=$(mktemp -d); (cd web && npx vite build --outDir "$D/dist" --emptyOutDir); cp web/dist/build-info.json "$D/dist/"`. Testene kjøres med `AD_WEB_DIST="$D/dist"`.

## Innholdet i appen
- Ingen merkevarer eller logoer fra andre. GitHub-ikonet ved GitHub-koblingen er unntaket.
- Ingen knapper for funksjoner som ikke virker.
- Tekst i appen og i rapportene skal være på norsk bokmål.
