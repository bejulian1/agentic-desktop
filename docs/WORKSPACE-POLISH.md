# Skills, modeller og prosjektmenyer

Fra v0.17.0 åpner **Skills** i sidefanen et eget arbeidsområde. Biblioteket kan søkes og filtreres etter kilde, prosjekt og status. Velg en skill for å lese eller redigere instruksjonene. Appens medfølgende skills er skrivebeskyttet; **Lag egen variant** lager et redigerbart utkast. Ny skill, import, på/av og fjerning bruker de samme validerte serverhandlingene som før.

Skill-utkast beholdes når arbeidsområdet skjules. Bytte av skill eller import krever bekreftelse hvis endringer må forkastes. Ved oppdagede eksterne filendringer beholdes utkastet og filen må lastes inn på nytt. Redigereren leser filen igjen før lagring; serverens eksisterende API gir fortsatt ingen atomisk revisjonskontroll mot samtidige eksterne skrivere. Ctrl+S lagrer bare når Skills er aktivt og ingen innstillinger eller bekreftelsesdialog ligger over.

**Modeller og leverandører** er nå én side i Innstillinger. Standardmodell og agentgrenser står sammen med kort for tilkoblede leverandører, nøkkelstatus og modellene deres. Gamle innganger til Modeller eller Leverandører åpner denne siden. Skjemaer og feil beholdes under sidebytte i samme innstillingsbesøk. Kataloglasting og katalogfeil skjuler ikke lagrede modeller. Valgt sidemarkering oppdateres umiddelbart; hover-markeringen er svakere. Hele innstillingsrammen flyttes eller tones ikke ut ved raske sidebytter. Sidemenyen bruker ikke den globale glidemarkøren; valgt bakgrunn samsvarer med innholdet også gjennom faktiske museklikk og raske sidebytter.

I Kode åpner prosjektvelgeren ved **Denne datamaskinen / prosjektnavnet i topplinjen** under den knappen. Velgeren ved meldingsfeltet forblir forankret der. Bare én slik meny er åpen om gangen. Et nytt klikk på utløseren lukker menyen; valg av samme prosjekt beholder meldingsutkastet. Søk, piltaster, Enter, Escape, naturlig Tab-navigasjon og systemets mappe-/tillitsflyt brukes som før.

Ved valgt Kode-prosjekt viser tannhjulet **Konfigurer lokalt miljø** faktisk gren eller frakoblet HEAD, lokal mappe og snarveier til prosjektinnstillingene. Fra v0.20 åpner Gren og Nytt arbeidstre en fungerende lokal Git-dialog. Miljøet er den lokale maskinen. Se [Git og verktøy](GIT-AND-TOOLS.md) for handlinger og sperrer. Mappebytte i samme prosjekt-ID ugyldiggjør gammel greninformasjon; forsinkede svar fra forrige mappe forkastes.

Innsatsvelgeren har faste høyder på overskriften og modellraden. Skyveknappen skaleres ikke lenger ved trykk/drag, så vertikal plass og høyde beholdes under nivåvalg og tilbakestilling. Blåfarge og eksisterende nivå-/lagringsfunksjon er bevart.

## Kontroll i v0.17.0 bygg 57

Typekontroll for server, web og Electron og alle 398 servertester består. 46 ulike relevante UI-forløp er kontrollert headless, inkludert nye tester 62–64, innstillingsstabilitet i test 45, eldre leverandør-/modell-/nøkkelfeltflyt og promptfullføring. To eldre testlokatorer ble oppdatert for nye tilgjengelige navn/demomerking. Nye rammeprøver bruker faktiske museklikk og observerer hele markørens tidligere animasjonstid, i tillegg til programmerte hurtige bytter.

Tolv skjermbilder i docs/screenshots/v0.17/ viser lyst/mørkt grensesnitt ved 1440 px og smalt ved 680 px. Electron-mappe, AppImage og .deb er bygget; begge headless pakke-/oppstartskontroller består. Localhost-forhåndsvisningen er autentisert og bekreftet som bygg 57. Dette er målrettet regresjonskontroll, ikke en garanti mot alle feil eller et nytt fullstendig UI-testløp. Den installerte PC-appen er uendret.
