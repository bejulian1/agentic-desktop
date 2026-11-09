# Patch log

Hva som er lagt til, runde for runde. Nyeste øverst. Plassholdere er merket **Demo** i appen.

## 0.11.0: Artifacts i Chat med forhåndsvisning og kode, også React (9. november 2026, bygg 32)
Runde 15, SPEC del 31. Bygget av én Opus-agent og verifisert av koordinatoren. Den installerte appen er ikke oppdatert.

- **Artifact-boksen:** en hel én-fils-app i `html`, `jsx` eller `tsx` blir en rolig boks i chatten, ikke en lang kodeblokk.
  - Boksen viser navn, type, antall linjer og versjon.
  - Mens appen skrives, står det «Skriver React · N linjer».
  - Det gamle html-kortet er erstattet av boksen.
- **Panelet:** fanene Forhåndsvisning og Kode, der Kode har linjenumre og fargelegging.
  - Knapper: Kopier, Last ned, Lagre som artifact og Åpne stort. Man kan bla mellom versjonene i tråden.
  - Panelet kan dras bredere eller smalere, og bredden huskes. Esc lukker.
  - I smale vinduer blir panelet en egen rute.
- **React-forhåndsvisning, lokalt og uten nett:**
  - React 19 og Sucrase er pakket som en lokal kjøretid på 432 KB, eller 118 KB gzip, som bare lastes i iframen.
  - Isolasjonen er den samme som for HTML, med en strengere CSP: `connect-src 'none'` og ingen nettressurser.
  - Ukjente pakker, syntaksfeil og krasj gir rolige meldinger på norsk.
- **Tekstblokker** har merket «Tekst» og Kopier. Chat-systemprompten har fått korte instrukser om artifacts og tekstblokker.
- **Demo-modellen** kan lage React- og HTML-artifacts og en versjon 2, så funksjonen kan vises uten API-nøkkel.
- **Artifacts-rommet** tar React-filer (`lang`).
- **Ytelsen er uendret:** 323,5 MB PSS i hvile mot 322,2 MB før, og oppstarten er ikke tregere.
- **Nye pakker**, godkjent av koordinatoren: `react@19.3.1`, `react-dom@19.3.1` og `sucrase@3.35.1`.
- **Tester:**
  - `npm test`: 331 tester, alle grønne.
  - `npm run test:ui`: 169 tester, alle grønne, med en sikkerhetstest for React-rammen.
  - `npm run e2e`: grønt.
  - `npm run test:desktop`: 40 tester, alle grønne, med React-forhåndsvisning i den pakkede appen uten nettkall.

## 0.10.0: Nøkler i nøkkelringen, nytt ikon, gafler, arkiv og mappe som mangler (9. november 2026, bygg 31)
Runde 14, SPEC del 30. Bygget av én Opus-agent og verifisert av koordinatoren. Den installerte appen er ikke oppdatert ennå.

### Nøkler i nøkkelringen (SPEC 30.1)
- API-nøkler og GitHub-tokenet lagres nå i GNOME-nøkkelringen (Secret Service), ikke i klartekst i `keys.json`. Det gjelder både appen og localhost.
- **Hvordan:** en liten Python-hjelper med `gi.repository.Secret` (`server/src/keyring.ts`). Nøkkelen går gjennom stdin og stdout, aldri i argumentlista, og hjelperen får et minimalt miljø. Skjemaet er `io.github.AgenticDesktop.ApiKey`.
- **Flytting:** `keys.json` flyttes inn ved første start. Fila slettes bare når alle nøklene er lagret og lest tilbake. Går noe galt, blir den stående, og Leverandører sier hvorfor.
- **Uten nøkkelring** gjelder en ny nøkkel bare til appen lukkes. Det står én rolig linje om det, med «Prøv igjen». Nøkkelen skrives aldri i klartekst.
- **Felt for nøkler og tokener** (`SecretInput`) viser prikker, har et øye som viser og skjuler teksten, og har autofyll og stavekontroll av.
- Testene kjører mot en egen `gnome-keyring-daemon` under `dbus-run-session`, aldri mot brukerens nøkkelring.

### Nytt appikon og valg av ikon (SPEC 30.2)
- **Nytt standardikon, «Snakkeboble»:** merket fra Kode-startsiden tegnet om til appikon, med en egen 16 px-versjon og et symbolsk ikon til statusfeltet.
- **Innstillinger → Utseende → Appikon:** fire valg med forhåndsvisning: Snakkeboble, Snakkeboble lys, Monogram og Terminal.
  - Valget gjelder favicon, vinduet og statusfeltet med en gang.
  - Ikonet i appbiblioteket byttes bare når appen er installert med `install-local`.
- Arket med alle ikonene ligger i `docs/screenshots/electron/ikoner.png`.

### Gafler (SPEC 30.3)
- «Gaffel herfra» under hver melding og «Lag gaffel» i trådmenyen.
- En gaffel husker hvor den kom fra (`forkedFrom`). Sidefanen, hoverkortet, toppfeltet og toppen av tråden lenker tilbake til meldingen den startet fra, og en strek viser «Gaffelen starter her».
- Navnet blir «‹tittel› (gaffel)», og neste gaffel blir «(gaffel 2)».
- Kode-tråder beholder prosjektet, og filene på disken endres ikke.

### Arkiv (SPEC 30.4)
- **Arkivere mange tråder samtidig:** «Arkiver alle trådene» i prosjektmenyen og «Arkiver alle chattene» i Chat-prosjekter, gjennom det nye kallet `POST /api/threads/archive`.
- **Angre:** all arkivering kan angres fra toasten.
- **Arkivsiden** grupperer etter prosjekt og har «Gjenopprett alle».
- **Lett å finne:** arkivet nås fra sidefanen, ⋯-menyen, paletten og menylinjen.

### Mappe som mangler (SPEC 30.5)
- Mangler prosjektmappen, byttes meldingsfeltet ut med en bar i samme form med to knapper: «Arkiver chattene», som kan angres, og «Velg prosjektmappe».
- Når mappen er valgt, kommer feltet tilbake med en gang, med utkastet.

### Tester
- `npm test`: 324 tester, alle grønne.
- `npm run test:ui`: 163 tester, alle grønne.
- `npm run e2e`: grønt.
- `npm run test:desktop`: 39 tester, alle grønne.

## 0.9.0, bygg 30: appen åpner seg fra appbiblioteket (8. november 2026)
- **Feilen:** Bygg 29 startet fortsatt ikke fra «Vis apper». Journalen viste den samme FATAL-feilen fra Chromium-sandkassen som i bygg 28. Startskriptet valgte riktig, men GNOME Shell kjørte det aldri. Gnome-shell hadde kjørt siden 5. november og startet fortsatt den gamle `Exec`-linja fra bygg 28, som pekte rett på Electron.
- **Rettingen:** Startskriptet har nå navnet `agentic-desktop`, som alle gamle stier peker på, og Electron ligger ved siden av som `agentic-desktop-bin`. `agentic-desktop-start` er en lenke til skriptet. Det samme gjelder .deb-pakken og AppImage.
  - Fusene (Node av, inspektør av) flippes nå i `afterPack` på `agentic-desktop-bin`, fordi electron-builder ellers ville flippet dem på skriptet.
  - AppArmor-profilen og sjekken i `sandbox.ts` gjelder den nye stien.
- **Tester:** `npm run test:desktop` 36 av 36 grønne. Test 08 sjekker oppsettet, og test 10 sjekker begge stiene.
- **Startet og lukket på ditt ekte skrivebord tre ganger:** to ganger med stien fra bygg 28 og én gang med stien fra bygg 29, alle under etiketten «unconfined» som fra GNOME. Ingen FATAL, og ingenting ble liggende igjen.

## 0.9.0: Agentic Desktop som Electron-app, med ikon, statusfelt, ekte nettleserpanel og optimalisering (6. november 2026, bygg 28 og 29)

SPEC del 29. Bygget av sju Opus-agenter: én for skallet, én for nettleserpanelet og fem for optimalisering. Tallene ligger i `docs/perf/`. Nye utviklingspakker med fast versjon: `electron` 45.0.0, `electron-builder` 26.18.0 og `@electron/rebuild` 4.2.1.

### Electron-appen (SPEC 29.1, 29.2 og 29.4)
- **Vinduet:**
  - Eget vindu uten systemramme, med egne vinduskontroller til høyre i toppfeltet. Toppfeltet kan dras.
  - Vinduets størrelse huskes, og bare én kopi av appen kan kjøre om gangen.
  - Ctrl+Q avslutter alltid.
- **Serveren** kjører i en egen prosess på en tilfeldig port med et nytt token hver gang. Den bruker de samme trådene og innstillingene som localhost-versjonen.
- **Sikkerhet:**
  - Låst økt: ingen tillatelser utenom utklippstavle, varsler og fullskjerm.
  - Lenker ut av appen åpnes i systemets nettleser.
  - Feilsiden har «Start på nytt». Siden «kjører allerede i nettleseren» vises når localhost-serveren bruker den samme datamappen.
- **Installasjon:**
  - `npm run dist` lager `dist-desktop/` med en utpakket app, `.deb` og AppImage.
  - **Bygg 29, oppstart fra appbiblioteket:** bygg 28 krasjet ved start. Årsaken var at Ubuntu 24.04 og nyere ikke gir Chromium-sandkassen brukernavnerom uten en AppArmor-profil, og testene merket det ikke. Rettingen:
    - Et startskript (`agentic-desktop-start`) sjekker ved hver start om sandkassen kan brukes.
    - Uten profilen starter appen uten sandkassen. Nettsider åpnes da i serverens Chrome, som har sin egen sandkasse.
    - Profilen ligger i `desktop/apparmor/`, og kommandoen for å legge den inn står i Innstillinger → Om.
    - Nye tester starter appen slik GNOME gjør, og starter og lukker den 22 ganger.
  - Siden «kjører allerede i nettleseren» har knappen «Avslutt nettleserversjonen og åpne appen».
  - `node scripts/install-local.ts` legger appen i `~/.local/opt/agentic-desktop` og i appbiblioteket som `io.github.AgenticDesktop`, med ikoner i alle størrelser. `--uninstall` fjerner den igjen.
- **Tester:** `npm run test:desktop` kjører under xvfb, uten vinduer på skjermen.

### Statusfeltet og ikonet (SPEC 29.6)
- **X legger appen i statusfeltet.** Menyen der har Vis Agentic Desktop, Ny tråd, en statuslinje og Avslutt.
- Ikonet får en prikk i aksentfargen når noe jobber, og i rav når noe venter på deg.
- Første gang appen legges i statusfeltet, kommer ett varsel om det.
- Under Innstillinger → Generelt → Vindu velger du hva lukking gjør.
- Uten statusfelt i skrivebordet avslutter X appen.
- **App-ikonet «Monogram»:** en A med tverrstrek i rav. De fire retningene som ble vurdert, ligger i `docs/screenshots/electron/ikoner.png`.

### Nettleserpanelet i vinduet (SPEC 29.3)
- I Electron er panelet en ekte del av vinduet, med egne innlogginger og importerte informasjonskapsler adskilt fra appen.
- Agenten styrer det gjennom en privat kanal mellom appens prosesser. Ingen åpen port, og appens eget vindu kan ikke nås gjennom den.
- Panelet koster rundt 57 MB, mot rundt 270 MB med headless Chrome, og frigjøres 30 sekunder etter at det er lukket.
- I localhost-versjonen er panelet som før.

### Optimalisering (SPEC 29.5 og 29.7)
- **Minne:** hele appen bruker 324 MB (PSS) i hvile med én tråd åpen. Budsjettet er 500 MB. Før optimaliseringen var det 363 MB.
- **Oppstart:** appen er klar etter rundt 485 ms, mot 714 ms før.
- **Web:** visningen er klar rundt 45 ms tidligere, fordi token og oppstartsdata hentes mens koden lastes. Dialogene lastes først når de åpnes.
- **Scrolling i lange tråder:** hovedtråden er opptatt halvparten så lenge. Radene er ikke lenger innkapslet hver for seg, og knapperaden under en melding lages først når musen eller fokus kommer dit.
- **Serveren:**
  - playwright-core lastes først når nettleseren brukes.
  - Nye indekser i SQLite. Sidefeltet hentes på 2 ms i stedet for 60 ms.
  - Hendelser sendes som lagret tekst.
  - Ingenting tikker i hvile.
- Prosjektnavnet øverst til venstre kuttes ikke lenger når sidefanen er åpen.

### Tester
- `npm test`: 308 av 308.
- `npm run test:ui`: 156 av 156.
- `npm run e2e`: grønn.
- `npm run test:desktop`: 36 av 36.

## 0.8.1: Rettinger etter 0.8 (6. november 2026, bygg 27)

- **Innsatsvelgeren:**
  - Popoveren hopper ikke lenger cirka 40 px til høyre når du velger et nivå. Før hang den i venstre kant av knappen, og den kanten flyttet seg når teksten gikk fra «Velg innsats» til «Ingen». Nå henger den i høyre kant, som står stille.
  - Bryteren er synlig fra første øyeblikk. Den står dempet i midten til du velger, og glir så til valget.
- **Toppfeltet:**
  - ☰ står i hjørnet midt over ikonraden, så hjørnet ikke lenger er tomt.
  - På en startside står det «Kode › Denne datamaskinen» eller «Kode › *prosjekt*» øverst til venstre. Et klikk på prosjektet åpner prosjektvelgeren. I Chat står det «Chat».
- **Tester:**
  - Ny testfil: `37-etter-0-8`.
  - `32-runde11` er oppdatert for den nye plassen til ☰.
  - `npm test`: 300 av 300.
  - UI: 155 tester. Tidslinjetesten feilet én gang under full last, men er grønn når den kjøres alene.

## 0.8.0: Runde 11 til 13 og en designrunde, ryddig toppfelt, stablede paneler, øktpanel og lesbare Kode-steg (6. november 2026, bygg 26)

SPEC del 24 til 28. Bygget av seks agenter, som jobbet etter hverandre og noen samtidig. Brukerens skjermbilder ligger i `docs/design-ref/runde11/`, og nye skjermbilder i `docs/screenshots/runde11/`, `runde11b/`, `runde12/`, `runde13/` og `design-runde/`. Ingen nye npm-pakker.

### Toppfelt, panelknapper og sidepanel (SPEC 24)
- **Toppfeltet:**
  - Ingen doble ikoner, og ikonene øverst til venstre legger seg ikke over ikonraden.
  - En tynn, lys skillelinje går langs sidefanen og under toppfeltet, i alle temaer.
  - Ikonraden har ingen grå boks bak aktive ikoner. Den har et lyst ikon og en liten markør i kanten.
  - Del til høyre og Del nedover står fast i toppfeltet. Løsriv ligger i ⋯, og «Lukk ruten» vises bare med flere ruter.
- **Panelknapper** i to stiler, valgt i Innstillinger → Utseende:
  - «Samlet» har ⋯, panelet og +.
  - «Hver for seg» har én knapp per panel: Økt, Terminal, Endringer, Nettleser og Filer.
  - + åpner en meny med panelene og hvor de skal stå.
  - Det er satt av en tom plass til vinduskontrollene i Electron-versjonen.
- **Sidepanelet** har en startside med verktøyfliser i én, to eller tre kolonner etter bredden, og «Foreslått». Den tomme siden «Velg prosjekt» er borte. Du kan velge faner øverst i stedet.
- **Kode-sidefanen** viser «Chatter» i stedet for «Prosjekter +». Prosjekter dukker opp av seg selv, og tråder uten prosjekt ligger under «Denne datamaskinen».
- **Chat** har ikke noe sidepanel.
- **⋯-menyen i sidefanen** har:
  - Organiser sidepanelet, etter prosjekt eller dato, med fold alle.
  - Sorter samtaler etter.
  - Vis.
  - Legg til prosjekt.
  - «Ny seksjon». Dra tråder inn eller bruk «Flytt til seksjon» i trådmenyen.

### Annotering og Kode-startsiden (SPEC 25)
- **Annoter i nettleserpanelet** (Ctrl+Alt+A):
  - Fryser siden, og du kan sette nummererte markører med kommentarer, tegne, ramme inn og skrive tekst.
  - «Ferdig» legger bildet som vedlegg i meldingsfeltet, og kommentarene som en nummerert liste.
  - Esc avbryter.
- **Kode-startsiden** velges i Innstillinger → Kode:
  - Tekst, i størrelsene Liten, Middels eller Stor, som også skalerer med vinduet.
  - Token-historikk.
  - Prosjektboks med nylige prosjekter, Velg miljø og GitHub.

### Øktpanel, stabling, informasjonskapsler og mappe som mangler (SPEC 26)
- **Øktpanelet** (Ctrl+Alt+7) har fire deler:
  - Miljø.
  - Kontekst, med prosent og hva konteksten består av.
  - Tilkoblinger.
  - Oppgaver i bakgrunnen, med Stopp og «Avsluttet».
- **Stablede paneler** med «Hver for seg»:
  - Panelene står ved siden av og over hverandre, og hvert har en slank linje med faner, ⋯, Maksimer og Lukk.
  - Du kan dra i skillene, dobbeltklikke for lik deling og dra et panel til en ny plass.
  - Terminal og nettleser beholder innholdet sitt.
- **Importer informasjonskapsler** fra Chrome, Chromium eller Firefox, slik at du er innlogget i nettleserpanelet:
  - Du velger nettstedene selv, og passord leses aldri. Nøkkelringen brukes bare idet du importerer.
  - Du kan glemme importen per nettsted eller alt på en gang.
  - Før en agent bruker et innlogget nettsted, spør appen alltid, også med Full tilgang.
- **Mappe som mangler:**
  - Gamle tråder kan leses.
  - Det går ikke å lage nye tråder, meldingsfeltet er låst og + er dempet til mappen er valgt igjen.

### Lesbare Kode-steg og verktøy i Chat (SPEC 27)
- **Kode-stegene:**
  - Hvert steg har ikon, et kort verb og et resultat, for eksempel «Leste app.js · 6 linjer», «Kjørte ls · exit 0» eller «Endret app.js · +2 −1».
  - Like steg samles, for eksempel «Leste 3 filer».
  - Nederst står én linje om hva agenten gjør nå, eller «Venter på deg».
  - Etter turen kommer en oppsummering som åpner Endringer.
  - Samme ord brukes i sidefanen og i vindustittelen.
  - Demo-modellen viser alt med «vis alle steg».
- **Verktøy i Chat:**
  - En knapp ved + med Nettsøk, Les nettsider, Artifacts og Minne, valgt per tråd. Standarden settes i Innstillinger → Chat.
  - Aktive verktøy vises som brikker.
  - Nettsøk viser kildene som kort.
  - Nettsøk bruker leverandørens eget søk når modellen har det, og ellers appens nettleser mot søkesiden du har satt.
- **Sikkerhet:**
  - Nettsøk og «Les nettsider» bruker en egen nettleser uten informasjonskapsler.
  - De når bare offentlige adresser. Lokale og private adresser blokkeres, også etter omdirigeringer.
  - Nettleserpanelet og Kode-verktøyene kan fortsatt åpne localhost.

### Designrunden (SPEC 28)
- 19 funn: 2 høye, 5 middels og 12 lave. Alle høye og middels er rettet, og 4 lave. Listen står i `docs/review/design-runde.md`.
- **Rettet:**
  - Trådnavnet la seg over knappene i toppfeltet i smale vinduer.
  - Varsler dekket panelets knapper og Lukk på ruten.
  - «Velg inns…» ble kuttet.
  - Tre nesten like ikoner i toppfeltet.
  - Tider ble skrevet ulikt i Chat og Kode.

### Tester
- `npm test`: typesjekken er ren, og alle 300 tester er grønne.
- `npm run test:ui`: 153 av 153 er grønne i én samlet kjøring.
- `npm run e2e`: grønt.
- **Nye testfiler:**
  - UI: `32-runde11`, `33-runde11b`, `34-runde12a`, `35-runde12b` og `36-runde13`.
  - Server: `runde11`, `runde11b`, `runde12a`, `runde12b`, `runde13` og `web-sikkerhet`.

## 0.7.0: Runde 10, nettleseren som en liten Chrome, modellvelger med søk og ro i rutene (5. november 2026, bygg 25)

SPEC del 23, med brukerens skjermbilder i `docs/design-ref/runde10/` og nye skjermbilder i `docs/screenshots/runde10/`. Ingen nye npm-pakker.

### Nettleseren
- Flere faner med ikon og lukk, som i en liten Chrome. Hold over + for «Ny fane» og «Ny fane i fullvisning». Et klikk på + lager en ny fane.
- Nye hurtigtaster: Ctrl+Alt+B gir ny fane (Ctrl+Shift+B viser og skjuler allerede panelet), og Ctrl+Shift+F gir ny fane i fullvisning. Begge kan endres.
- Fullvisning gir panelet hele bredden.
- Ny fane foreslår servere som kjører, artifacts og sider fra prosjektene dine. Verktøy og forslag tilpasser seg bredden, og ⋯ dukker bare opp når noe ikke får plass.
- Egen knapp for nedlastinger.
- Importer bokmerker og eventuelt historikk fra Chrome eller Chromium, i Innstillinger → Nettleser. Du ser hva som kommer før noe importeres. Passord, informasjonskapsler, kort og økter leses aldri.

### Kode og Chat
- Modellvelgeren har søk, grupper per leverandør, hake på den valgte og «Administrer modeller». Knappen viser leverandørens merke.
- Innsatsvelgeren er ryddigere, uten lyn og grå boks.
- Knappene øverst i rutene står rolig, dempet, og lyser bare opp under musen. De dukker ikke opp og forsvinner lenger.
- Meldingsfeltet ser likt ut med og uten fokus.
- En ny tråd heter ingenting før den får sin første melding, og tomme tråder står ikke i sidefanen.
- Statusteksten glimter rolig mens modellen tenker eller jobber, og blir rolig når den er ferdig. Modeller som ikke resonnerer, viser ikke «Tenker».
- Ny «Premium» tenkevisning i Chat (Innstillinger → Chat): et kort med «Forespørsel til *modell*», hva den holder på med og en rolig fremdriftslinje. Når svaret er kommet, står «Tenkte i …» over svaret, og et klikk viser sammendraget. Prøv med demo-modellen: skriv «tenk grundig».

### Sidefanen
- Ingen tomtekster. «Denne datamaskinen» vises først når den har tråder.
- Skjult sidefane blir en tynn rad med ikoner. Du kan velge «helt borte» i Innstillinger → Utseende.
- Profilmenyen holder seg innenfor sidefanen.

### Tester
- `npm test`: 271 tester, alle grønne. `npm run test:ui`: 127 tester, alle grønne alene. To tester er ustabile under full last (rutedrag og en synk-test som traff tidslinjens kort), og synk-testen er gjort robust. `npm run e2e`: grønt.
- Nye testfiler: `31-runde10` og `server/test/runde10`.

## 0.6.0: Runde 9, ny Kode-start, sidefane med Festet og en standard-harness (5. november 2026, bygg 24)

SPEC del 21 og 22. To agenter, med brukerens skjermbilder i `docs/design-ref/runde9/` som referanse. Ingen nye npm-pakker.

### Kode, sidefane og meldinger (SPEC 21)
- **Kode-startsiden:** et lite ikon og «Hva skal vi bygge?» uten prosjekt. Med prosjekt står det «Hva skal vi jobbe med i *prosjekt*?», og et klikk på navnet bytter prosjekt. Under står et lite kort med de siste trådene, Velg miljø og GitHub. Utseendet velges i Innstillinger → Kode.
- **Meldingsfeltet:** plassholderen viser `/` kommandoer, `@` filer og `$` skills. Feltet får en rolig grå kant i stedet for blå.
- **Sidefanen:** Festet dukker opp øverst når noe er festet. Prosjekter har + for å velge mappe, og en meny for gruppering, sortering og «Fold sammen alle». Valgene huskes. Hold over et prosjekt for + til en ny tråd.
- **Denne datamaskinen:** Kode-tråder uten mappe samles nederst i sidefanen.
- **Mappe som mangler:** en tydelig linje over feltet med «Velg mappe på PC-en», og et varselmerke på prosjektet.
- **Prosjekter i Chat:** lag dem med + og et navn, og flytt chatter inn fra trådmenyen.
- **Tannhjulet** er et ekte tannhjul og åpner Innstillinger for Kode eller Chat, etter hvor du er. Versjonen står nå nederst i Innstillinger.
- **Innsats:** en egen velger fra Ingen til Maks med glidebryter, modellnavn og nullstilling, i aksentfargen. Ny rød aksent.
- **Ny rute:** en fast knapp øverst til høyre.
- **Tidslinje:** langs venstre kant i både Chat og Kode, med streker for dine meldinger og svarene, som forstørres som en dock når du holder over.
- **Meldinger:** rediger dine meldinger også i Kode (appen sier fra at filene ikke rulles tilbake), velg flere og kopier dem som tekst eller Markdown, og velg om Enter sender eller gir ny linje.
- **Panelet uten tråd:** kan åpnes fra startsiden. Terminalen starter da i hjemmemappen som «Denne datamaskinen», og Chat får Nettleser.

### Harness, minne og Chat-personalisering (SPEC 22)
- Ny tråd i Kode vet hvem den er: på «hei» sier agenten hva den kan, hvilket prosjekt og hvilken gren den jobber i, og hvilke verktøy som er på.
- Ny side: Innstillinger → Kode-harness. Slå deler av grunnen av og på, for eksempel «Spør før store endringer» og «Kjør tester etter endringer».
- En global AGENTS.md med gode standardregler lages første gang appen starter. Den skriver aldri over en fil som finnes.
- «Gjenopprett standard» viser forskjellen før noe endres, og tar vare på den gamle fila som sikkerhetskopi.
- Forhåndsvisning av hele systemprompten, lag for lag, med tokens.
- Minneoppgradering: slå sammen like minner, fjern utdaterte og kort ned. Du ser forslaget og velger selv hva som lagres. Det virker uten API-nøkkel og kan slås av.
- Ny side: Innstillinger → Chat-personalisering, med systeminstruks, om deg, tone og egne Chat-minner med «Oppdater minnet av seg selv». Helt adskilt fra Kode, og Chat får ikke lenger den globale AGENTS.md eller Kode-minnene.
- Skills: importer mange .md-filer på én gang, fra filer, en mappe eller med dra og slipp. Feil vises per fil, og når et navn er tatt, velger du mellom erstatt, behold begge og hopp over.
- Demo-modellen svarer på «hvem er du» og «hva kan du» ut fra den ekte harnessen, og «husk at …» i Kode lagres som et minne.

### Rettet
- Rettet: en nedtrekksliste eller meny som var åpen, lukket seg ikke når du klikket på knappen igjen. Den lukket seg når museknappen gikk ned og åpnet seg igjen med en gang. Nå lukker et nytt klikk menyen. Det gjelder alle menyer som åpnes fra en knapp.
- @-søket hoppet over `.gitignore` i prosjekter som ikke er et git-repo. Nå følges `.gitignore` alltid.

### Tester
- `npm test`: 268 tester, alle grønne. `npm run test:ui`: 118 tester, alle grønne. `npm run e2e`: grønt.
- Nye testfiler: `29-runde9`, `30-harness`, og på serveren `runde9` og `runde9b-harness`. `27-runde8-navigasjon` tester at en åpen meny lukkes med et nytt klikk.
- Research: `docs/research/harness-runde9.md`.

## 0.5.0: Runde 5 til 8, et helt dev-team (5. november 2026, bygg 23)

SPEC del 16 til 20. Sju agenter har bygget, en UI-kritiker og en QA-tester har gått gjennom alt, og to rettere, en detaljagent, en ytelsesagent og en agent for kanttilfeller har tatt funnene. Ingen nye npm-pakker.

### Kode-startsiden og prosjektvelgeren (SPEC 20)
- Kode uten valgt prosjekt viser de fire sist brukte prosjektmappene som kort, med ikon, navn, sti og når de sist ble brukt. Under kortene ligger «Vis alle prosjekter» og «Nytt prosjekt». Teksten du har skrevet, blir med.
- Statistikken er flyttet fra Kode-startsiden til Innstillinger → Bruk.
- Prosjektvelgeren har søk på navn og sti, seksjonene Nylige og Alle prosjekter, og virker med piltaster, Enter og Esc.

### Nytt i runde 5 til 7 (SPEC 16 til 18)
- **Kode:** mål med tid, Rediger, Pause og Slett over meldingsfeltet (`/goal`). Plassholder med `/` kommandoer, `@` filer og `$` skills. Opptil 20 vedlegg. «Tenkte i …» i Chat og «Jobbet i …» i Kode, med verktøysteg i grupper som kan foldes ut. Kort for redigerte filer med Angre og Vis endringer. Tidslinje langs kanten av samtalen, underagenter som ett kort, og et festet sammendrag.
- **Under hver melding ved hover:** Kopier, Forgrening herfra, Fest som kapittel og tidspunktet, med full dato ved hover.
- **+-menyen** i meldingsfeltet: skråstrekkommandoer, mappe, filer og bilder, med ikon på hver rad.
- **Meldinger mens agenten jobber** kan sendes med en gang eller legges i kø over meldingsfeltet (valg i Innstillinger).
- **Navigasjon:** trådnavnet øverst med Gi nytt navn og innstillinger for tråden, kommandopalett (Ctrl+K), trådmeny med Utsett, Forgrening og Kopier, hover-kort, Rediger prosjekt med ikonvelger, profilmeny og profilside, og en smart sidefane som valg (Trenger deg, Jobber, Utsatt, Avsluttet). Favicon i prosjektmappen blir prosjektikon.
- **Høyre panel:** Oversikt med miljø, kontekstbruk og endrede filer, bakgrunnsoppgaver med ikon og tid, og servere modellen har startet, med Stopp. Kommandoer i chatten har Kjør og Kopier.
- **Nettleseren:** ny-fane-side, ⋯-meny med Finn på siden, Zoom, Skjermbilde og Historikk, og nedlastinger til en egen mappe med en liste over dem.
- **Ruter:** opptil 6 tråder side ved side, som kan dras ut, stables og endres i størrelse.
- **Innstillinger:** fylt med det vanlige for en kodeapp. Leverandører som kort med API-nøkkel (OpenRouter, abliteration.ai, Anthropic og OpenAI, merket Beta), hurtigtaster som kan endres, tenkesammendrag og utvidet skallboks av eller på, og `/storage` med Lagring som viser hva appen bruker og kan rydde.
- **Agent-harness, minne og skills:** bedre systemprompt, verktøy og redigering. Modellen kan lagre korte minner globalt og per prosjekt, og foreslå egne skills som du godkjenner. Minner og skills kan ses, endres og slettes i Innstillinger.
- **Chat:** egne verktøy for Chat, midlertidig chat, søk og eksport, uten Kode-elementene.

### Sikkerhet og server (QA-funn)
- Minne- og skillfiler skrives atomisk og aldri gjennom en symlenke ut av mappen.
- `remember` og `forget` spør om godkjenning (globalt alltid, unntatt i Full tilgang), og minnefilteret stopper flere typer hemmeligheter.
- Feiingen sletter ikke en midlertidig chat som er åpen. Nedlastinger blir ikke hengende når Chrome lukkes.
- `Retry-After` har et tak på 60 s, og appen viser en linje som teller ned. En `null`-kropp gir 400, ikke 500. Nedlastingsmappen kan ikke peke inn i datamappen. En `!kommando` i kø sendes ikke til modellen når du stopper.

### Meldingsfelt og samtale (UI-retter 1)
- Chat viser ikke lenger mål, verktøy og filer fra Kode. Søk og eksport ligger i rutens topplinje, og søkefeltet dekker ingen meldinger.
- Godkjenningskortet sier hva som skal skje med vanlige ord, og viser endringen som en diff. Esc avslår.
- Samme status står ikke lenger flere steder i en kjøring. Korte steg viser ikke tid i millisekunder.
- Matte og LaTeX vises som formler. Det appen ikke kan tegne, vises som tekst og er merket.
- Når leverandøren ber om en pause, står det en rolig linje som teller ned til neste forsøk.
- Rettet: en midlertidig chat ble slettet etter et kort besøk i Kode, to raske meldinger ble til to tråder, Esc i målet lagret teksten, et dobbeltklikk på «Lag svaret på nytt» ga en feilmelding, og skråstrekmenyen lukket seg av og til rett etter at den ble åpnet fra +-menyen.
- Mindre støy i meldingsfeltet: én kort plassholder, personlighet som ikon, kontekstringen først når den er i bruk, kortere kø og nivåer for tenkeinnsats med navn.
- HTML-svar i Chat viser forhåndsvisningen først, med koden foldet under.

### Navigasjon, Innstillinger og ruter (UI-retter 2)
- Sidefanen og panelet kommer tilbake når vinduet blir bredt igjen etter å ha vært smalt. I smale vinduer lukkes panelet, så det ikke tar halve høyden.
- Chat og Kode har tekst ved ikonet. Chat viser chattene øverst og prosjektene som én rad hver. Kode viser prosjektene øverst og chattene sammenlagt nederst med antall.
- Toppfeltet er kortere. Prosjektstien står i verktøytipset, Playtest blir en brikke med Stopp ved hover, og VS Code og terminalen ligger under ⋯. Chat viser ikke prosjektverktøy.
- Varsler (toasts) ligger øverst til høyre, til venstre for panelet, og dekker aldri meldingsfeltet. Bjelle-varslene åpnes inne i vinduet.
- Fokus går tilbake dit det var etter kommandopaletten, Innstillinger og trådmenyen. Menyene er ekte menyer for skjermlesere, med piltaster.
- En rute hopper ikke lenger tilbake til en tråd du klikket på rett før.
- Midlertidige chatter vises ikke i sidefanen, den smarte sidefanen, varslene eller paletten.
- Utsett virker i vanlig sidefane: tråden dempes, legger seg nederst og får en klokke som henter den tilbake.
- Profilmenyen viser alltid ukens riktige tall.
- Rediger prosjekt og Prosjektinnstillinger er én dialog med fanene Generelt, Agent og Kilder, og én Lagre.
- Hover-kortet for en tråd viser modell, antall meldinger og når den sist var aktiv, og kommer først etter et lite øyeblikk.
- Flere ruter: bare ruten med fokus viser prosjektraden og det festede sammendraget. Skillet viser hakk ved 1/3, 1/2 og 2/3. Ruter uten tittel heter «Ny tråd».
- Innstillinger: egne nedtrekkslister i stedet for nettleserens, brytere i Lagring, rader med hake i Tillatelser, og Git, MCP-servere, Hooks og Worktrees samlet under «Kommer senere». Menyen er én rad som scroller i smale vinduer.
- Bruk har statistikk-kortet fra startsiden, kostnaden og en lenke til profilen.
- Leverandørene har to bokstaver og egen farge. Modeller viser modellene, og Leverandører har nøkler, Rediger og Koble fra.
- Nettleserpanelet viser ikke lenger grå felt etter at ⋯-menyen har vært åpen, og Spilltesting ligger i ⋯-menyen.
- Nedlastinger viser hvorfor de stoppet og kan fjernes fra lista mens de pågår. «Vis i mappe» heter nå «Kopier stien». En nettside kan bare starte noen få nedlastinger i minuttet, og Lagring advarer før nettleseren lukkes midt i en nedlasting.
- Stopp av en server dreper aldri en annen prosess som har fått samme prosessnummer.
- Hurtigtaster står i én kolonne. Artifacts samler handlingene i ⋯ i smale vinduer.
- Lukkeknappen i høyre panel blir aldri kuttet. Fanene ruller sideveis hvis de ikke får plass, og ikonene forsvinner tidligere når panelet er smalt eller teksten er stor.
- Hover-kortet i sidefanen forsvinner når vinduet endrer størrelse eller sidefanen lukkes, og holder seg innenfor vinduet.
- Aksentfargene fiolett, grønn, oransje og rosa har mørk tekst i mørkt tema, og lys oransje er litt mørkere. Alle holder nå kravet til lesbarhet.
- Prosjektene på Kode-startsiden og i prosjektvelgeren står i riktig rekkefølge med en gang du har laget en tråd eller sendt en melding.
- Når forbindelsen til serveren er borte, sier bare banneret øverst fra.
- I et smalt vindu har Innstillinger «Tilbake» og søk på én rad, og sidene på en rad under som ruller sideveis.
- Terminalen følger med når systemet bytter mellom lyst og mørkt med System valgt.
- Usynlige tegn (tegn med null bredde) fjernes fra navn på prosjekter og tråder.

### Temaer, GitHub og mini-editor (SPEC 19)
- Nye fargetemaer i Innstillinger → Utseende: Høy kontrast, Varm, Kald, Fjord og Solbleket. Hvert tema har en lys og en mørk variant, og hele appen følger med, også terminalen og editorene. Temaet velges med små forhåndsvisninger og piltaster, og det blinker ikke ved oppstart.
- Alle temaer holder WCAG AA for tekst, og Høy kontrast holder AAA. Et lite skript sjekker det: `node scripts/kontrast.ts`.
- GitHub (Beta): koble til med et personlig tilgangstoken. Tokenet lagres som API-nøklene og sendes aldri tilbake til nettleseren. GitHub-fanen i høyre panel viser prosjektets repo, lest fra `.git/config`, med åpne pull requests og issues. Lenkene åpnes i Nettleser. Bare lesing, med tydelige meldinger ved feil token, grense for antall forespørsler og frakobling.
- Mini-editor: klikk «Åpne» på en kodeblokk, en filsti i en verktøyrad, «Rediger» i Filer eller blyanten i Endringer. Den har syntaksfarger, linjenumre, søk (Ctrl+F), gå til linje (Ctrl+G), en oversikt over funksjoner og klasser, og det tråden endret i fila. «Spør om dette» legger det du har valgt inn i meldingsfeltet som sitat. Prosjektfiler kan lagres med Ctrl+S, og editoren sier fra hvis fila er endret på disken.

### Bevegelse og finpuss
- Ett sett med varigheter og kurver for hele appen. Alt beveger seg bare med transform og opacity, og står stille når ingenting skjer. Reduser bevegelse (system eller Innstillinger) slår av alt, også ruteovergangene.
- Menyer, popovers og hover-kort fader og skalerer fra der de åpnes. Dialoger fader og løfter seg litt. Toasts glir inn og ut.
- Verktøytips kommer etter en kort pause, men neste tips vises med en gang når du går langs en rad med ikoner.
- Nye meldinger løfter seg rolig inn. Historikk og gamle meldinger som scrolles inn igjen, står i ro.
- Pilen roterer når verktøyrader, tenkning og grupper foldes ut, og innholdet fader inn.
- Chat/Kode, segmentkontroller og faner har en markør som glir til det nye valget.
- Sidefanen og høyre panel glir inn når de åpnes. Statusprikker puster rolig mens noe kjører, og Stopp har en roterende bue.
- Kopier viser en hake, både under meldinger og på kodeblokker.
- Terminalen og editorene bruker igjen kodeskriften og panelfargen, og terminalen får ny skriftstørrelse uten å åpnes på nytt.
- Dempet tekst oppfyller WCAG AA i begge temaer.
- Menyene har samme rader overalt. Hurtigtaster i menyer er dempet tekst, og tastebokser brukes bare i lister over hurtigtaster.
- Nedtrekkslister, avkrysningsbokser, radioknapper, søkefelt og merker har appens stil. Ikonene har faste størrelser og lik strek.
- Lange lister får en myk kant øverst og nederst når det er mer å scrolle.
- Grå plassholdere i stedet for «Henter…» i statistikken, profilen, Skills og Minner. Tomme paneler har et lite ikon.

### Ytelse
- `npm run perf` henger aldri. Hvert steg har en tidsgrense og sier hva det ventet på. Med `AD_WEB_DIST` bygger den aldri.
- Måleverktøyet målte strømming feil (headless Chrome uten bildetak). «Opptatt» under strømming er 21–25 %, ikke 53–56 %.
- Haken og «Kopiert» under meldingene finnes bare mens de vises. Scrolling i lange tråder: p99 fra 9,7 til 7,5 ms, langt hopp fra 33 til 25 ms.
- Klokkeslett under meldingene lages med faste formatterere, som var halvparten av skripttiden når meldinger kom til syne.
- Deler av en lang tråd som er langt unna, tas ned når appen er ledig, ikke midt i neste scrollebevegelse.
- Symboler som → og ⋯ varmes opp i ledig tid, så første `/`-meny ikke henger på skriftoppslag (fra 33 til 17 ms i verste fall).

### Tester
- `npm test`: 251 tester, alle grønne. `npm run test:ui`: 105 tester, alle grønne. `npm run e2e`: grønt.
- Nye testfiler: `26-runde8-meldingsfelt`, `27-runde8-navigasjon`, `28-temaer-github-editor`, og på serveren `github`, `temaer`, `runde7-qa-server` og `runde8-navn-og-prosjekter`. QA-testene er flyttet inn i dem.

## 0.4.0: Slankere toppfelt, menyikon og Chat/Kode i sidefanen (4. november 2026, bygg 22)

- Menylinjen (Fil, Rediger, Vis, Hjelp) er erstattet av ett menyikon øverst til venstre. Det åpner en liste med Fil, Rediger, Vis, Gå og Hjelp, og hver av dem viser en undermeny til høyre når du holder over den (eller klikker, eller bruker piltastene).
- Undermenyene har fått de vanlige punktene for et skrivebordsprogram. Rediger har Angre, Gjør om, Klipp ut, Kopier, Lim inn og Merk alt, og de virker på feltet som hadde fokus. Vis har Zoom inn, Zoom ut, Faktisk størrelse (huskes til neste gang) og Fullskjerm. Den nye menyen Gå har Forrige og Neste tråd, Artifacts, Skills og Planlagt. Fil har Arkiverte tråder. Alle punktene utfører en ekte handling.
- Chat og Kode er flyttet fra midten av toppfeltet til toppen av sidefanen, som to ikoner (snakkeboble og kode). Når sidefanen er skjult, eller vinduet er smalt, står de i midten av toppfeltet i stedet.
- Navnet «Agentic Desktop» øverst i sidefanen er ren tekst, uten pil og meny.
- Kode uten prosjekt viser bare statistikk-kortet i midten. Overskriften «Velg en prosjektmappe», forklaringen og knappen er fjernet, og prosjekt eller ny mappe velges i prosjektraden over meldingsfeltet.
- `12-ramme` tester menyikonet, undermenyene og Chat/Kode i sidefanen og toppfeltet. `01-kodeflyt` og `09-kanttilfeller` er tilpasset.

## 0.4.0: Kode har alltid meldingsfelt og statistikk (4. november 2026, bygg 19)

- Kode uten valgt prosjekt viste bare «Velg en prosjektmappe». Nå har den samme oppsett som Kode med prosjekt: statistikk-kortet med token-grafen i midten, og meldingsfeltet nederst med prosjektraden (Velg prosjekt, Lokal) over.
- Sender du uten prosjekt, åpnes prosjektvelgeren. Teksten følger med inn i prosjektet du velger.
- `09-kanttilfeller` dekker dette. `01-kodeflyt` søker etter feltet «Sti» med eksakt navn, fordi «Statistikk» også inneholder «sti».

## 0.4.0: Ryddigere Chat-startside (4. november 2026, bygg 18)

- Chat viser ikke lenger prosjektraden (prosjekt, Lokal og gren) over meldingsfeltet. Den finnes bare i Kode.
- Statistikk-kortet er flyttet fra Chat-startsiden til Kode-startsiden, under spørsmålet. Det kan fortsatt slås av i Innstillinger → Generelt.
- Chat-startsiden har fire eksempelkort: Lag et lite spill, Vis et kodeeksempel, Forklar kode og Hva kan du? Et klikk fyller meldingsfeltet, men sender ikke.
- `17-redesign`, `09-kanttilfeller` og skjermbildeskriptet er oppdatert til den nye plasseringen.

## 0.4.0: Redesign mot Codex og Claude desktop (4. november 2026, bygg 17)

SPEC del 15. Utseendet og plasseringen er nytt. Ingen funksjoner er fjernet, bare flyttet.

**Stilarket**
- `web/src/styles.css` er skrevet på nytt som ett system. Overstyringene for 0.2 og 0.3 nederst er foldet inn. Alle farger, avstander, radier, skriftstørrelser og skygger er tokens (CSS-variabler) på `:root`, og mørkt tema definerer de samme på nytt. Død CSS er fjernet (blant annet statuslinjen, `ghost-small`, `sidebar-new`, `section-toggle`, `settings-close`).
- Nøytrale flater med én aksentfarge, nå blå. Den brukes på brytere, fokus, aktivitetskartet og merker. Hovedknapper (Send, Tillat, Lagre) er svarte i lyst tema og hvite i mørkt, som i referansene.
- Lyst tema: hvit midtflate og en svakt grå sidefane. Mørkt: `#1b1b1b` i midten og en litt lysere sidefane. Skiller er farge, ikke streker.
- Ytelse: ingen `backdrop-filter` eller blur. Skygger bare på det som flyter (meldingsfeltet, godkjenningskortet, menyer og dialoger), aldri på rader som scroller. Samtaleradene har `contain` og `content-visibility` som før.

**Toppen**
- Til venstre: sidefane, tilbake og frem, og Fil, Rediger, Vis og Hjelp, små og dempet.
- Chat og Kode er en liten segmentknapp midt på.
- Til høyre: prosjektnavnet dempet, **Stopp alt** som liten rød brikke når noe kjører, og ikonknapper for **Åpne i VS Code**, **Playtest** og **Stopp playtest**, **Ny rute**, **Terminal** og **Panel**. Alle har verktøytips.
- Statuslinjen nederst er borte. Tilkoblingen er en prikk på profilbildet nederst i sidefanen, versjon og byggnummer står dempet under navnet, og kontekst, tokens, kostnad og samlet bruk for prosjektet ligger i kontekstringen i meldingsfeltet.

**Sidefanen**
- Øverst **Agentic Desktop** med en meny (Om, Innstillinger, Hurtigtaster, Kommandoer), og ikonene **Søk** og **Varsler**. Søkefeltet åpnes fra luppen eller hurtigtasten. Varsler viser godkjenninger som venter og tråder som ble ferdige mens du så et annet sted.
- Navigasjon: **Ny tråd** (med en liten ⊕ for ny tråd i et nytt prosjekt), **Artifacts**, **Skills** (liste over skills for prosjektet og deg) og **Planlagt** (Demo).
- Seksjonene **Festet**, **Prosjekter** og **Chatter**, med større og roligere tekst (15 px, rader på 32 px). Prosjekter har mappeikon som blir en pil ved hover. Det valgte prosjektet viser **Ingen tråder** når det er tomt, og lange lister får **Vis flere**.
- Nederst: initialer i en farget sirkel, navnet fra profilen, tannhjul for Innstillinger og et hjelpeikon. Klikk på profilen åpner **Bruk**. Lenken **Arkiverte (n)** åpner Innstillinger → Arkiverte tråder.
- Standardbredden er 280 px. Under 860 px er sidefanen et overlegg, og den lukker seg når vinduet blir så smalt.

**Startsiden (tom rute)**
- Kode: et eget ikon og «Hva skal vi bygge i <prosjekt>?». Prosjektnavnet er stiplet understreket og åpner prosjektvelgeren. Forslagene står under.
- Chat: «Hva skjer nå, <navn>?» og et statistikk-kort med fanene **Oversikt** og **Modeller**, filtrene **Alt**, **30d** og **7d**, åtte ruter (Økter, Meldinger, Tokens totalt, Aktive dager, Nåværende rekke, Lengste rekke, Topptime, Favorittmodell), et aktivitetskart for et halvt år i ett SVG og en setning som «Du har brukt omtrent like mange tokens som Hobbiten». Tallene kommer fra databasen. Kortet hentes på nytt når en kjøring blir ferdig, aldri på tidtaker, og kan skjules i **Innstillinger → Generelt**. Det skjules også i smale ruter.

**Meldingsfeltet**
- Slankt og sentrert, maks 760 px, med radius 20 px og en svak skygge.
- Over feltet: **Prosjektvelger** (søk, hake ved det valgte, **Nytt prosjekt** og **Ikke jobb i et prosjekt**, som gir Chat), **Lokal** (Demo) og **Gren**, lest fra `.git/HEAD`.
- Plassholder «Gjør hva som helst» i Kode og «Spør om hva som helst» i Chat.
- Nederst til venstre: **+** med fil eller tråd (`@`), kommando (`/`), skill (`$`) og kommando i prosjektmappen (`!`), og tillatelsesmodus som brikke: «Spør», «Godta redigeringer» eller «Godkjenn for meg».
- Nederst til høyre: modell og tenkeinnsats i én meny («Demo-modell (uten API) · Standard»), kontekstringen med detaljer ved hover, mikrofon (Demo) og en rund Send-knapp som blir Stopp.
- Tenkeinnsats valgt før tråden finnes, brukes når første melding lager den.

**Samtalen**
- Brukermeldinger i en dempet boble til høyre, svar i full bredde. Verktøyrader og tenkning er kompakte, dempede rader med små ikoner og tid til høyre.
- **Godkjenningskortet ligger rett over meldingsfeltet**, i samme bredde, med Avslå til venstre og Tillat alltid og Tillat til høyre. I samtalen står en rolig linje, «Venter på godkjenning nedenfor», og etterpå hva som ble valgt, som før.
- Toppen av ruten er roligere: tittel til venstre, og knappene (festet sammendrag, del, løsriv, lukk) vises når du holder over toppen. I flere ruter vises de når du holder over ruten. Bryteren for **festet sammendrag** er flyttet hit fra sidefanen, og finnes også i Vis-menyen og Innstillinger.

**Innstillinger som fullside**
- Erstatter hele vinduet. Meny til venstre med **Tilbake til appen**, gruppen **App** (Generelt, Utseende, Modeller, Tilkoblinger (Demo), Git (Demo), Bruk) og gruppen **Vert** med en «Lokal»-velger (Demo): Konfigurasjon, Personalisering og minner, Hurtigtaster, MCP-servere (Demo), Hooks (Demo), Nettleser, Skrivebordsstyring, Tillatelser, Worktrees (Demo), Arkiverte tråder og Om.
- Innholdet er sentrert (maks 720 px) med overskrift og kort med rader: tittel, forklaring og en kontroll til høyre. Brytere i aksentfargen.
- **Bruk** er den gamle Profil, nå også med kostnad der pris er satt. **Konfigurasjon** har global `AGENTS.md` (flyttet hit fra Personalisering), global `settings.json` og prosjektets lag. **Arkiverte tråder** er ekte, med Gjenopprett og Slett. **Tema** ligger under Utseende.
- Esc og Tilbake fører tilbake dit du var. Appen under er `inert` mens siden er åpen, så utkast og scrolling står.

**Små vinduer**
- Under 1180 px deler høyre panel bredden som en kolonne (maks 40 %) i stedet for å legge seg over. Under 860 px legger panelet seg over samtalen i samme kolonne, og meldingsfeltet er alltid synlig. Bare sidefanen kan bli et overlegg. Under 520 px skjules Ny rute, Terminal og VS Code i toppen (de finnes som `Ctrl+\`, panelfanen og `/vscode`).

**Server (med tester)**
- `server/src/git-head.ts` og `GET /api/projects/:id/git`: grenen fra `.git/HEAD`, også via `gitdir:` i worktrees. Ingen git-kommandoer.
- `GET /api/stats?range=` med `HomeStats`, og `costUsd` i `ProfileStats`. Utregningen deler kode med Profil (`usageSteps`, `countStreaks`).
- `GET /api/threads/archived`.
- `Settings.homeStats`.
- `scripts/build-lib.ts`: en endret UI-test i `web/test/` gjør ikke lenger at `npm start` bygger på nytt og øker byggnummeret.

**Tester**
- Nye: `server/test/redesign-v04.test.ts` (7: grenen, ingen kommando, API-et, statistikken med perioder, bryteren, arkiverte tråder, kostnad) og `web/test/17-redesign.test.ts` (3: startsiden og prosjektvelgeren, godkjenningskortet og varsler, Skills, Planlagt og Innstillinger med arkiverte tråder). `rest.test.ts` har fått én sjekk for byggregelen.
- Endret fordi ting er flyttet, med det samme testet: `07-tema` (nye bakgrunnsfarger, Tema under Utseende), `08-chat` (luppen åpner søket), `09-kanttilfeller` (ny startside, Tilbake til appen), `10-sikkerhet` (kostnaden leses i kontekstringen i stedet for statuslinjen; angrepene og sjekkene er uendret), `11-innstillinger` («Godkjenn for meg», og «små vinduer» sjekker nå at ingenting dekker meldingsfeltet i stedet for at statuslinjen synes), `13-innstillinger-kategorier` (Bruk og Konfigurasjon), `06-samarbeid` (samlet bruk i kontekstringen) og `16-artifacts` (seksjonen heter Festet, og dialogene over forhåndsvisningen besvares med tastaturet, se under).
- `web/test/screenshots.ts` tar 23 bilder per tema med nye navn, blant annet startsiden i Chat og Kode, prosjektvelgeren, samtale med verktøyrader og innstillinger som fullside. Gamle bilder slettes først.

**Funnet underveis:** I headless Chrome kan et museklikk på en dialog som ligger over en forhåndsvisning som nettopp er lastet, havne i den fremmede iframen i stedet for på knappen (klikket når aldri siden). Det ga tilfeldig feil i `16-artifacts` omtrent én av tre ganger. Å skjule iframen under dialogen hjalp ikke, så det er en kappløpsfeil i Chromes ruting av input. Testen svarer nå på de to dialogene med tastaturet. Isolasjonstesten for artifacts er ikke rørt.

## 0.3.0: Artifacts, versjon 1 (4. november 2026)

SPEC del 14. Alt er ekte, ingen plassholdere.

**Sidefanen**
- Rekkefølgen er Ny tråd, søk, **Artifacts** (med antall), **Festede prosjekter**, Prosjekter og Chatter.
- Prosjekter festes og løsnes fra prosjektmenyen (**Fest prosjektet** / **Løsne prosjektet**). Et festet prosjekt vises bare i sin egen seksjon, og seksjonen er borte når ingenting er festet. `Project.pinned` lagres i SQLite.

**Artifacts-rommet**
- Galleri med kort: tittel, når den ble endret (laget-tidspunktet i hjelpeteksten), tråden den kom fra, prosjektet når det finnes, og et ikon med størrelsen. Søk i tittel og trådnavn, sortering på sist endret, sist laget eller navn.
- En åpen artifact har koden i CodeMirror med HTML-utheving (også CSS og JavaScript inni), redigerbar, og en live forhåndsvisning ved siden av. **Delt**, **Kode** og **Forhåndsvisning**, og valget huskes. Forhåndsvisningen viser det som er lagret, og lastes på nytt når du lagrer (knappen eller Ctrl+S) og når du trykker **Kjør på nytt**.
- Knapper: **Ny artifact**, **Gi nytt navn**, **Dupliser**, **Last ned .html**, **Åpne i Nettleser-panelet**, **Slett** med bekreftelse, og **Forrige versjon** når en finnes.
- Lagres i SQLite med tittel, HTML, tråd, melding, prosjekt, `created` og `updated`. En ny versjon skyver den gamle inn i `previous_html`, og **Forrige versjon** bytter dem.
- Rutene blir liggende under rommet, så utkast og scrolling er der når du går tilbake. Chat, Kode, en tråd eller et prosjekt lukker rommet. Høyre panel er skjult mens rommet er åpent.

**Kort i chatten**
- En `html`-blokk som ser ut som et helt program (`<!doctype`, `<html`, `<body>` eller `<script>`) får et kort rett under seg når blokken er ferdig strømmet, i Chat og i Kode. **Skjul** / **Vis forhåndsvisning**, **Lagre som artifact** og **Åpne i Artifacts** (som lagrer først). En lagret blokk viser «Lagret som «tittel»».
- Ingen iframe mens blokken strømmer: kortet lages av en krok som bare kalles for ferdige blokker. En delt `IntersectionObserver` lager iframen når kortet kommer i syne og fjerner den etter 4 s utenfor. Høyden er 340 px og kan dras.
- Forhåndsvisningen i chatten kan slås av i **Innstillinger → Generelt → Artifacts** (`Settings.artifactPreview`). Da venter kortet på et klikk.
- Demo-modellen svarer på `artifact` og `html-spill` med et lite canvas-spill med poeng, i Chat og Kode.

**Sikkerhet (14.4)**
- Egen forhåndsvisningsserver (`server/src/preview.ts`) på `127.0.0.1` med tilfeldig port, nådd som `http://localhost:<port>` mens appen er `127.0.0.1`, slik Playtest gjør, så app-cookien aldri sendes dit.
- Lagrede artifacts har adressen `/a/<id>/<HMAC av id>`, med en nøkkel på 32 byte som lages per kjøring. Kort i chatten får øyeblikksbilder i minnet bak et tilfeldig token på 32 byte. Feil nøkkel gir samme 404 som noe som ikke finnes. Serveren importerer ikke `fs` og gir aldri ut filer.
- Iframen har `sandbox="allow-scripts allow-modals"` uten `allow-same-origin`, og hvert svar fra forhåndsvisningen har i tillegg `Content-Security-Policy: sandbox allow-scripts allow-modals; frame-ancestors <appen>`, så siden får opak origin også når den åpnes alene, for eksempel i Nettleser-panelet.
- Appens CSP har fått `frame-src` med akkurat den origin-en og ingenting annet.
- Lagring, sletting, nedlasting og øyeblikksbilder går gjennom de vanlige kontrollene: cookie, Origin og JSON. Nedlastingen er et vedlegg med `Content-Security-Policy: sandbox`.

**Nye API-ruter:** `GET/POST /api/artifacts`, `GET/PATCH/DELETE /api/artifacts/:id`, `POST /api/artifacts/:id/duplicate`, `POST /api/artifacts/:id/restore`, `GET /api/artifacts/:id/download` og `POST /api/previews`. `PATCH /api/projects/:id` tar `pinned`, og `PATCH /api/settings` tar `artifactPreview`. I `shared/protocol.ts` er alt tillegg: `ArtifactSummary`, `Artifact`, `MAX_ARTIFACT_HTML`, `Project.pinned`, `Settings.artifactPreview`, `Bootstrap.artifacts`, og `artifact.changed` og `artifact.deleted` i `ServerMessage`.

**Tester:** `server/test/artifacts.test.ts` (10 nye) og `web/test/16-artifacts.test.ts` (2 nye).
- Fra innsiden av forhåndsvisningen i ekte headless Chrome: `origin` er `null`, `document.cookie` og `parent.document` gir `SecurityError`, `fetch` mot API-et med cookie feiler (CORS, og `Cross-Origin-Resource-Policy` stopper også `no-cors`), POST med JSON stopper i preflight, WebSocket kobles ikke til, og ingenting i databasen er endret etterpå.
- Mot serveren direkte: `Origin: null` og forhåndsvisningens origin avvises med 403 på ni ruter, også med gyldig cookie, og WebSocket avvises før upgrade.
- Forhåndsvisningsserveren: 17 adresser uten riktig nøkkel gir 404 (også stier som `/etc/passwd`, `..`, en annen artifacts nøkkel og databasefilen), feil `Host` gir 403, `POST` gir 405, en nøkkel fra en annen kjøring virker ikke, og den svarer ikke på `::1`.
- **Rettet med vilje:** `web/test/10-sikkerhet.test.ts` krevde null iframes i svaret. Den onde `html`-blokken med `<script>` får nå et forhåndsvisningskort, så testen krever i stedet at hver iframe i svaret ligger i et artifact-kort, har nøyaktig `allow-scripts allow-modals`, ikke har `srcdoc` og peker til forhåndsvisningens port. Kortets eget SVG-ikon er unntatt fra sjekken av `svg`.

**Valg og avvik fra del 14**
- **Ikon, ikke forhåndsbilde,** på kortene i galleriet. SPEC-en tillater begge, og et ikon koster ingen iframe.
- **Angre og gjør om er laget for hånd** (`web/src/panels/html-editor.ts`), fordi `@codemirror/commands` ikke er installert og ingen pakker skulle lastes ned. Det samme gjelder Tab, Ctrl+A og Ctrl+S. Søk og erstatt finnes ikke i editoren ennå.
- **Åpne i Nettleser-panelet krever et prosjekt,** fordi panelet hører til et prosjekt. Knappen bruker prosjektet du står i, ellers artifactens, ellers det sist brukte, og er grå med en forklaring når det ikke finnes noe prosjekt.
- **Øyeblikksbildene for kort i chatten ligger i minnet** og forsvinner ved omstart. Kortet ber om et nytt når det trenger det.
- **Ulagrede endringer:** Tilbake-pilen og lukking av fanen spør, men å klikke en tråd i sidefanen lukker rommet uten å spørre.

**Utestet:** Svært store artifacts nær grensen på 2 MB i editoren. Forhåndsvisning i flere vinduer samtidig. At brukerens kjørende app på port 4317 trenger omstart for å bruke dette: en gammel server mangler `frame-src` og de nye rutene.

## Runde 4: de store, som plassholdere med demo-flyt (3. november 2026)

**Ekte**
- **Kodegjennomgang:** **Gjennomgå** i Endringer og `/review [ekstra ønske]`. Serveren samler endringene fra trådens turer som ikke er angret, lager en kort linjediff per fil og sender den til modellen med beskjed om ikke å endre filer. Det virker med ekte modeller også. Demo-modellen svarer med en gjennomgang ut fra faste regler (inline-skript, `console.log`, knapp uten `type`).
- **Agent Teams:** Én delt oppgaveliste per prosjekt, i SQLite. Verktøyene `task_list`, `task_add` og `task_update` endrer bare appens tilstand og trenger ingen godkjenning. Panelet **Team** viser listen live, gruppert på Pågår, Å gjøre og Ferdig, med eier-tråd, og du kan legge til, krysse av og slette. Demo-modellen viser flyten ved ordet `team`: teamlederen lager to oppgaver og to hjelpetråder, gir oppgavene til dem, venter, og krysser av.
- **Bakgrunnsinstanser** (fra runde 3) har status i sidefanen: kjører, venter på deg, feilet eller stoppet.
- **Tilpasning:** Sidefanen og høyre panel kunne allerede dras og ble husket. Nå gir dobbeltklikk på kanten standardbredden tilbake. Panelfanene viser bare ikon når panelet er smalt.
- Nye API-ruter: `GET/POST /api/projects/:id/tasks`, `PATCH/DELETE /api/tasks/:id`, og `review: true` på `POST /api/threads/:id/messages`. `ServerMessage` har fått `project.tasks`. Oppgaver kan bare få en eier i samme prosjekt, og verktøyene når ikke andre prosjekters oppgaver.

**Demo**
- `/worktree`: forklaring, ingen git-kommandoer.
- **Spilltesting headless:** et kort i Nettleser-panelet (spillkontroll-knappen) som forklarer headless testing av spill og programmer, for eksempel Minecraft med Sodium. Ingenting startes.
- **Skrivebordsstyring** med `cua-driver` i Innstillinger, status *Ikke installert* (laget i runde 2). Ingenting lastes ned, installeres eller kjøres.

**Tester:** `server/test/team-review-r4.test.ts` (4 nye) og `web/test/15-team-og-gjennomgang.test.ts` (1 ny).

**Utestet:** Gjennomgang av svært store differ (de kuttes ved 48 kB). Teamflyt med en ekte modell. Oppgavelisten har ingen rekkefølge utover når oppgaven ble laget.

## Runde 3: prosjekter og instanser (3. november 2026)

**Ekte**
- **To hovedmapper:** Den globale `$XDG_CONFIG_HOME/agentic-desktop/` (standard `~/.config/agentic-desktop/`) og `.agentic/` i roten av hvert prosjekt. Begge kan ha `AGENTS.md`, `settings.json` og `skills/`. Prosjektet går foran, nøkkel for nøkkel.
  - `settings.json` kan sette `model` (id, navn eller modellstreng), `permissionMode` og `personality`. Andre nøkler ignoreres, og en ødelagt fil vises som feil i stedet for å stoppe noe.
  - Systemprompten får global `AGENTS.md` først, så prosjektets `AGENTS.md` eller `CLAUDE.md`, så `.agentic/AGENTS.md`, og en linje om at prosjektet vinner.
  - Nytt prosjekt får tillatelsesmodus fra `settings.json`. Ny tråd får modell fra prosjektets standardmodell, ellers fra `settings.json`, og personlighet fra `settings.json`.
- **Prosjektinnstillinger** fra menyen på prosjektet i sidefanen: navn, farge, ikon, standardmodell, tillatelsesmodus, instruksjoner (`.agentic/AGENTS.md`), en tabell som viser hvilke valg som gjelder og hvor de kommer fra, og **Bytt mappe**. Flytting bruker samme kontroll som et nytt prosjekt, nekter mens en tråd kjører, og stopper terminaler og playtest først.
- Prosjektet har **(+)** for ny instans og menypunktet **Ny bakgrunnsinstans**, som starter en tråd på en oppgave uten å åpne en rute.
- Instanser laget av en annen instans vises som et tre under den som lagde dem. Prikken ved hver tråd viser om den kjører, venter på deg, feilet eller ble stoppet.
- Nye API-ruter: `GET /api/projects/:id/config` og `PUT /api/projects/:id/instructions`. `PATCH /api/projects/:id` tar også `color`, `icon`, `defaultModelId` og `path`. `Project` har fått `color`, `icon` og `defaultModelId`. Skrivingen til `.agentic/` går gjennom stikontrollen, så en symlenke ut av prosjektet blir avvist.

**Demo:** Ingen nye i denne runden.

**Tester:** `server/test/projects-r3.test.ts` (3 nye, med midlertidig konfigurasjonsmappe) og `web/test/14-prosjekter.test.ts` (1 ny). Alle UI-tester setter nå `XDG_CONFIG_HOME` til en midlertidig mappe, og det samme gjør `npm run e2e`.

**Utestet:** Flytting av et prosjekt mens et annet vindu har terminalen åpen. Endring i `settings.json` mens appen kjører leses ved neste tråd, men UI-et får ikke beskjed.

## Runde 2: innstillinger og modeller (3. november 2026)

**Ekte**
- Innstillinger er delt i **Generelt og utseende**, **Modeller**, **Profil**, **Personalisering og minner**, **Hurtigtaster**, **Tillatelser**, **Skrivebordsstyring** og **Om**.
- **Leverandør med bare nøkkel:** En liste med OpenAI, Anthropic, OpenRouter, Google Gemini (OpenAI-kompatibel adresse), DeepSeek, xAI, Mistral, Groq, Ollama (lokal), LM Studio (lokal) og Egendefinert. Du velger leverandør, limer inn nøkkelen og trykker **Hent modeller**. Appen leser leverandørens `/models` (Anthropic: `/v1/models` med egne hoder) og lar deg krysse av. Kontekstvinduet tas fra svaret (`context_length`, `context_window`, `max_context_length`, `max_input_tokens`), ellers fra en liten tabell, ellers 128 000, som kan endres etterpå.
  - Adressene er sjekket mot leverandørenes egen dokumentasjon 3. november 2026, uten å kalle API-ene. Kilden står ved hver linje i `server/src/providers/presets.ts`. Ikke bekreftet: Mistral-ID-en `mistral-large-4`, om eldre Claude-modeller har mindre vindu, og om LM Studio noen gang krever nøkkel.
- **Profil:** navn og profilkort, tokens totalt, toppdag, dager på rad nå og lengst, dager i bruk, søyler for de siste 28 dagene og bruk per modell. Alt regnes ut fra `usage`-hendelsene og kjøringene i databasen.
- **Personalisering:** global `AGENTS.md` i `$XDG_CONFIG_HOME/agentic-desktop/` kan redigeres, og den går inn i systemprompten i alle tråder. Prosjektets egne instruksjoner går foran.
- **Hurtigtaster:** se og endre. Endringene lagres i innstillingene på serveren, og kollisjoner stoppes.
- Nye API-ruter: `GET /api/provider-presets`, `POST /api/providers/:id/models/fetch`, `POST /api/providers/:id/models`, `GET /api/profile`, `GET /api/config` og `PUT /api/config/agents-md`. `POST /api/providers` tar `preset`. `Settings` har fått `shortcuts`, `profileName`, `memories` og `alwaysOnTop`. Alle rutene går gjennom de samme kontrollene som før, og nøkkelen sendes aldri til UI-et, heller ikke i feilmeldinger fra leverandøren.

**Demo:** **Alltid øverst** (lagres, men en nettleserfane kan ikke ligge øverst), **Minner** (bryteren lagres, ingenting huskes), og kortet **Skrivebordsstyring** med `cua-driver`, status *Ikke installert*. Ingenting lastes ned eller kjøres.

**Tester:** `server/test/settings-r2.test.ts` (7 nye, alle mot lokale falske servere) og `web/test/13-innstillinger-kategorier.test.ts` (2 nye). `09-kanttilfeller.test.ts` velger nå **Egendefinert** først, siden **Legg til leverandør** åpner listen.

**Utestet:** Ingen ekte leverandør er kalt. Gemini sin kompatible `/models` gir ikke kontekststørrelse, så tabellen brukes. Ollama og LM Studio sine egne API-er for kontekst (`/api/show`, `/api/v1/models`) er ikke brukt. Profiltallene teller en kopiert tråd sin historikk på nytt.

## Runde 1: rammen rundt vinduet og meldingsfeltet (3. november 2026)

**Ekte**
- Toppstripen har knapp for sidefanen, **tilbake** og **frem** i trådhistorikken (også Alt+← og Alt+→), og en menylinje med **Fil**, **Rediger**, **Vis** og **Hjelp**. Alle menypunktene gjør noe: ny tråd, ny chat, ny rute, åpne mappe, lag AGENTS.md, innstillinger, søk, gi nytt navn, kopier tråd, komprimer, angre tur, stopp, Chat/Kode, sidefane, panel, festet sammendrag, panelfaner, tema, hurtigtaster, kommandoer og Om.
- Hurtigtastene ligger i én tabell (`web/src/state/shortcuts.ts`), som menyene og dialogen **Hurtigtaster** leser fra.
- Sidefanen har **Ny tråd** øverst og en bryter for **festet sammendrag**. Sammendraget står øverst i samtalen med mål, plan og tall for meldinger, verktøykall og endrede filer, og kan foldes ut med siste svar.
- Kommandoene fra ønskelisten har de engelske navnene, med de norske som alias (`/modell` → `/model`, `/hjelp` → `/help` og så videre). Ekte: `/model`, `/reasoning`, `/status`, `/compact`, `/fork`, `/goal`, `/plan`, `/init`, `/project`, `/task`, `/side` og `/personality`.
  - `/goal`, `/plan`, `/reasoning` og `/personality` lagres per tråd og går inn i systemprompten. Planmodus gir modellen bare lesende verktøy, og serveren avviser andre verktøykall. Planen lagres og vises i sammendraget.
  - `/reasoning` sendes som `output_config.effort` til Anthropic og `reasoning_effort` til OpenAI-kompatible leverandører.
  - `/fork` kopierer historikk og valg til en ny tråd, som åpnes ved siden av. `/side` åpner en ny tråd i en rute til høyre. `/init` lager en `AGENTS.md`-mal og overskriver aldri.
- `$` åpner skills i meldingsfeltet, i tillegg til `/navn`.
- Nye API-ruter: `POST /api/threads/:id/fork` og `POST /api/projects/:id/init`. `PATCH /api/threads/:id` tar også `goal`, `planMode`, `reasoning` og `personality`. `Thread` har fått `goal`, `planMode`, `plan`, `reasoning`, `personality` og `lastStatus`, og `CommandInfo` har fått `aliases`, `args` og `demo`. Alt er tillegg.
- Utseende: tettere toppstripe og sidefane, nytt meldingsfelt med fokusring i aksentfargen, roligere fargepalett og finere rader for verktøy og tenkning.

**Demo** (plassholder med merke og forklaring, gjør ingenting): `/approve`, `/ide-context`, `/local`, `/mcp`, `/memories`, `/review` og `/worktree`.

**Tester:** `server/test/threads-extra.test.ts` (4 nye) og `web/test/12-ramme.test.ts` (2 nye). `commands.test.ts` og fargene i `07-tema.test.ts` er rettet etter bevisste endringer.

**Utestet:** `reasoning_effort` mot en ekte leverandør. Rebinding av hurtigtaster kommer i runde 2. Menylinjen skjules under 860 px, og er bare prøvd med mus i testene.

**Feil underveis:** Servertesten for `npm start` startet `scripts/start.ts`, som bygde `web/dist` på nytt fordi kildene var endret. Det økte byggnummeret fra 13 til 14 og byttet ut filene brukerens kjørende app serverer. `start.ts` bygger nå ikke når `AD_WEB_DIST` er satt, og testen setter den.
