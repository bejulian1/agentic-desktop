# Patch log

Hva som er lagt til, runde for runde. Nyeste øverst. Plassholdere er merket **Demo** i appen.



## 0.27.2: Rediger systemprompten lag for lag i Forhåndsvisning (16. november 2026, bygg 76)

- **Rediger de innebygde lagene:** under **Innstillinger → Konfigurasjon → Forhåndsvisning** kan du åpne et lag, trykke **Rediger**, skrive din egen tekst og lagre. Gjelder Grunn-harness, Chat-grunn, Skills, Tema og mods og MCP-verktøy. Modellen får teksten din fra neste tur.
- **Plassholdere holder det levende:** redigeringen starter fra den innebygde teksten, der det som endrer seg per tråd står som plassholdere, for eksempel `{{project}}`, `{{project_path}}`, `{{abilities}}`, `{{skills}}` og `{{environment}}`. Appen fyller dem inn for hver tråd, så en egen tekst ikke fryser prosjekt, verktøy eller dato.
- **Tilbakestill:** hvert endret lag har **Tilbakestill**, og **Tilbakestill alle** fjerner alle egne tekster for modusen du ser på. Endrede lag er merket «Endret».
- **Per modus:** en egen tekst gjelder det du forhåndsviser: Kode med prosjekt, Kode uten prosjekt eller Chat. De andre beholder sin innebygde tekst.

Miljø-laget kan ikke redigeres, fordi det bare er levende tilstand. Global `AGENTS.md` og Chat-personalisering redigeres som før på sine egne steder. Et lag med egen tekst følger ikke appens senere forbedringer av det laget, og når grunnen er din egen tekst, gjelder ikke bryterne for delene i Grunn-harness. Godkjenninger og tillatelser håndheves av appen uansett. Kontrollert med 515 servertester, et nytt UI-forløp og typekontroll.

## 0.27.1: Agenten presenterer seg bedre, og gamle standardinstrukser følger med (16. november 2026, bygg 75)

- **Bedre svar på «hvem er du og hva kan du?»:** grunnprompten har fått en kort del om appen og agenten (harness 16.2). Modellen forklarer hva Agentic Desktop er, hva den kan gjøre akkurat nå, og én ærlig begrensning, i vanlige ord i stedet for verktøynavn. Gjelder både Kode og Chat.
- **Kode uten prosjekt:** agenten sier ikke lenger at den bare kan endre temaer. Den forklarer hva Kode kan med et prosjekt valgt, hva den kan hjelpe med uten, og hvordan du velger et prosjekt.
- **Selvbildet kommer fra verktøyregisteret:** hvert verktøy har nå sin egen korte tekst om hva det lar agenten gjøre, også MCP-verktøy, tema-verktøyet og Chat-verktøyene. Beskrivelsen av hva agenten kan akkurat nå, og av hva Kode kan med et prosjekt, bygges ved kjøring fra verktøyene tråden faktisk har. Et nytt verktøy dukker opp der av seg selv, og en test stopper et verktøy uten slik tekst.
- **Standardinstrukser følger appen:** en lagret global `AGENTS.md` eller Chat-instruks som fortsatt er helt lik en tidligere standard, byttes automatisk til den nye, korte standarden ved oppstart. Den gamle `AGENTS.md` legges i sikkerhetskopiene først. Tekster du har endret selv, røres ikke.

Kontrollert med 513 servertester og typekontroll. Svarene er ikke prøvd mot ekte modeller.

## 0.27.0: Fil-skills i Chat og Kode (15. november 2026, bygg 73)

- **Fire nye skills:** `/excel`, `/word`, `/powerpoint` og `/data-files` for Markdown, tekst, CSV og JSON. De følger med appen og er tilgjengelige i begge moduser; totalt 19 innebygde skills.
- **Chat laster relevante instruksjoner ved behov:** modellen får en kort katalog og kan bruke `use_skill` før filarbeid. Slash-/dollar-valg fungerer også, inkludert innebygde skills i Chat-prosjekter. Hele biblioteket lastes ikke inn i samtalen.
- **Tilpasset faktiske verktøy:** skillene beskriver datatyper, formelkontroll, dokumentstruktur, lesbare lysbilder og bevaring av data. Chat bruker den eksisterende dokumentgeneratoren; Kode kan bruke tilgjengelige prosjektbiblioteker og kontrollverktøy. Skillene lover ikke avansert formatering, Office-redigering eller visuell kontroll som Chat mangler.
- **Prosjektgrenser og brytere beholdes:** Chat-prosjekter laster bare innebygde app-skills for Chat/begge moduser. Globale bruker-skills, Kode-instruksjoner og andre prosjektfiler holdes utenfor. En skill slår ikke på «Lag filer», Python, nettverk eller filsystemtilgang. Kode kan ikke laste Chat-spesifikke skills gjennom modellverktøyet.

Kontroll: 510 servertester, typekontroll av server/web/Electron og syv berørte grensesnittforløp består med isolerte data og lokale modeller.

Harness 16.1. Instruksjonene bygger på de eksisterende filverktøyene; ingen nye kjøretidsavhengigheter. Effekten på ekte modellers skill-valg eller dokumentkvalitet er ikke målt. Se [filverktøy](CHAT-FILES.md) og [skills](SLASH-SKILLS.md).

## 0.26.0: Ny harness, 15 innebygde skills og personligheter i Chat (15. november 2026, bygg 72)

- **Ny grunnprompt for Kode (harness 16):** bygget rundt arbeidsmåten: undersøk koden og hvordan prosjektet løser det samme, følg prosjektets mønstre, gjør endringen fullstendig men liten, finn årsaken før en feil rettes, kontroller og rapporter. Nye faste regler: aldri reverser endringer agenten ikke har gjort selv, ingen destruktive kommandoer uten at du har bedt om akkurat det, og ingen utviklingsservere gjennom `run_command`.
- **15 innebygde skills for Kode:** `/debug`, `/tdd`, `/review`, `/verify`, `/plan-change`, `/refactor`, `/explore`, `/git`, `/web-qa`, `/security-audit`, `/docs`, `/frontend-design`, `/gauntlet-loop`, `/skill-creator` og `/memory`. Modellen laster en skill når du nevner den eller oppgaven tydelig passer. Skills kan merkes med `mode: code` eller `mode: chat`; Kode-skills vises ikke i Chat.
- **Minner og nye skills av seg selv:** instruksen peker på `remember` når du retter modellen eller sier en varig preferanse, og på `propose_skill` når en framgangsmåte bør gjenbrukes. Minnene ligger som før i `MEMORY.md`, globalt og per prosjekt.
- **Åtte personligheter i Chat:** Standard, Profesjonell, Vennlig, Ærlig, Spesiell, Nerdete, Effektiv og Skeptisk, som standard for alle chatter eller per chat med `/personality`. Fire stilvalg kan settes til Mindre, Standard eller Mer: Varm, Entusiastisk, Overskrifter og lister, og Emoji. Tidligere toner og personligheter oversettes automatisk.
- **Ny grunnprompt for Chat** med konkrete råd om svarkvalitet, og kortere standardinstrukser for både Chat og Kode. Standard-`AGENTS.md` er seks korte punkter uten innledning.
- **Tydeligere verktøybeskrivelser:** tolv verktøy sier nå når de skal brukes, blant annet nettleserverktøyene og hjelpetråder. Miljølaget teller MCP-verktøy per server i stedet for å liste hvert navn.
- **Rettinger:** forhåndsvisningen i Konfigurasjon hopper ikke lenger til toppen når du bytter mellom Kode og Chat. Filer-panelet åpner ikke lenger en fil som er slettet eller angret. Tastaturfokus går tilbake til ⋯-knappen når en trådmeny lukkes. `personality` i global `settings.json` gjelder bare Kode-tråder, og teksten i Innstillinger forklarer hva filen gjør.

Din egen lagrede `AGENTS.md` og Chat-instruks byttes ikke ut automatisk: velg **Gjenopprett standard** under Kode-harness og Chat-personalisering for å få de nye, korte tekstene. Effekten på modellenes svar er ikke målt mot ekte modeller. Se [Slash-skills](SLASH-SKILLS.md), [Personlighet og stil i Chat](CHAT-PERSONALITIES.md) og [standardinstruksjonene](system-instructions/README.md).

## 0.25.0: MCP-servere, hooks og valg av glass-stil (15. november 2026, bygg 71)

- **MCP-servere:** koble modellen til verktøy fra MCP-servere i **Innstillinger → MCP-servere**. Ferdige utgangspunkt for **GitHub** (adresse og hemmelig token) og **Playwright** (`npx @playwright/mcp`), og egne servere med kommando (stdio) eller adresse (Streamable HTTP). Statusprikk, verktøyliste med av/på per verktøy, ny tilkobling og utdata fra serveren. `/mcp` åpner siden.
- **Godkjenning og hemmeligheter:** MCP-verktøy spør som kommandoer i Kode, med «Tillat alltid» per verktøy, og før hvert kall i Chat. En server kan settes til automatisk godkjenning. Tokener lagres i systemets nøkkelring, vises aldri igjen i grensesnittet og skjules i svar, feil og logger. Verktøyene tilbys ikke i planmodus, og hver tur får høyst 60 MCP-verktøy.
- **Hooks:** egne kommandoer som kjøres **før verktøykall**, **etter verktøykall**, **når du sender en melding** og **når en tur er ferdig**, i både Kode og Chat. Samme kontrakt som Claude Code: JSON på stdin, avslutningskode 2 stopper. Filter på verktøynavn (også `mcp__<kortnavn>__*`), tidsgrense, testknapp og tre ferdige eksempler. Hooks som stopper eller legger til noe, vises som en egen linje i samtalen.
- **Trygghet rundt hooks:** bare du kan lage og endre dem i Innstillinger. De leses aldri fra prosjektmapper, og modellen har ikke noe verktøy for dem. En melding som ikke har kommet gjennom en hook, regnes som ikke sendt og kan sendes på nytt.
- **Glass over bakgrunner:** velg mellom **Hele bakgrunnen uskarp**, **Flater bak svar** og **Ingen uskarphet eller flater** i Utseende og i modbiblioteket. Flater bak svar gir hvert svar sin egen glassflate og små glasspiller for tenkeutdrag og steg. Ingen uskarphet eller flater viser svarene rett på den skarpe bakgrunnen; bare meldingsfeltet og dine egne meldinger har flate med omriss. Gjelder både Chat og Kode.
- **Versjonslogg i Innstillinger og Om:** hele versjonsloggen åpnes nå også fra sidefanen i Innstillinger og fra Om-siden, i én liste med versjonsmerke, dato og bygg, og «Denne versjonen» merket.

MCP er prøvd mot den ekte Playwright-serveren. GitHub-serveren er ikke prøvd mot GitHub, siden det krever et token. Protokollen fra 2025-11-25 og eldre støttes; servere som bare snakker 2026-07-28 kan ikke kobles til ennå. Hooks kjører med din fulle tilgang til maskinen, som en kommando i terminalen. Se [MCP-servere](MCP.md), [Hooks](HOOKS.md) og [Tema, bakgrunn og mods](UI-MODS.md).

## 0.24.3: Renere prosjektlinje over meldingsfeltet (15. november 2026, bygg 70)

- **Jevn glasstone i promptbaren:** prosjektlinjen bruker samme dempede flate som meldingsfeltet over bakgrunner, med en tynn kant.
- **Fjerner grå stripe:** den gamle overlappen på 14 piksler er erstattet med en liten skjøt, slik at prosjektlinjen ikke skinner gjennom øverst i meldingsfeltet. Prosjektvelger, lokal vert og øvrige kontroller er beholdt.

Vanlig visning uten bakgrunn beholdes. Kontrollert i bredt og smalt vindu, med prosjektvelger og bevart meldingsutkast.

## 0.24.2: Myk avgrensning av glassbakgrunnen (15. november 2026, bygg 69)

- **Glass følger innholdet:** den uskarpe bakgrunnen begrenses til samtalens og meldingsfeltets bredde, med en rolig uttoning mot skarpe sidemarger. Bredden følger vinduet og temaets innholdsinnstilling.
- **Samme uttoning ved meldingsfeltet:** den gradvise uskarpheten nederst er også avgrenset sideveis, slik at den ikke lager et bredt slør over resten av motivet.

Gjelder både Chat og Kode, med globalt bakgrunnsbilde eller samtaletema. Claudes glasspolering fra 0.24.1 er beholdt.

## 0.24.1: Uskarp glassbakgrunn og renere samtale over bakgrunner (14. november 2026, bygg 68)

- **Ett glasslag bak hele samtalen:** bryteren heter nå **Uskarp glassbakgrunn** og legger ett uskarpt, dempet lag over hele bakgrunnen, fra topp til bunn. Den er fortsatt på som standard og finnes i Utseende og modbiblioteket. Av viser bakgrunnen skarpt.
- **Ingen flater bak svar:** modellsvar og tenkeutdrag står rett på bakgrunnen, uten grå flater eller omriss, også når tenkeutdraget er åpnet.
- **Gradvis uskarphet mot meldingsfeltet:** samtalen går mykt over i uskarphet ned mot meldingsfeltet i stedet for en fargeovergang.
- **Meldingsfelt og egne meldinger:** halvgjennomsiktig mørk flate med tynt omriss, slik at tonen følger bildet bak. Meldingsfeltet blir ikke lenger grønt ved fokus over bakgrunner.

Vanlig visning uten bakgrunn er uendret og bruker ingen filtre. Se [Tema, bakgrunn og mods](UI-MODS.md).

## 0.24.0: Global bakgrunn og glassflater i Chat og Kode (14. november 2026, bygg 67)

- **Eget bakgrunnsbilde for hele appen:** Utseende har opplasting, bytte og fjerning, med justering av bildestyrke og uskarphet. Valget beholdes ved omstart og fungerer i Chat, Kode og innstillinger. Samtaletemaer kan fremdeles ha et eget motiv i samtalen.
- **Lokale bilder:** PNG, JPEG og WebP behandles og skaleres på maskinen. Bakgrunnsfiler er adskilt fra meldingsvedlegg og sendes ikke til modellen. Gamle filer ryddes ved bytte og fjerning.
- **Glassflater:** dempede flater med uskarp bakgrunn bak modellsvar og tenkeutdrag. Egen bryter i Utseende og modbiblioteket. Vanlig visning uten bakgrunn bruker ingen glassfiltre. Mørkt meldingsfelt med tydelig kant over bakgrunner.
- **Temaer enklere å finne i Chat:** egen inngang på startsiden og i meldingsfeltets verktøymeny. Samme lokale modbibliotek som i Kode, med valg per samtale. Fungerer også i løsrevne chatvinduer.

Se [Tema, bakgrunn og mods](UI-MODS.md).

## 0.23.0: Tema og visuelle mods per samtale (14. november 2026, bygg 65)

- **Egne temaer fra samtalen:** modellen har et nytt ui_mod-verktøy i Chat og Kode, også uten prosjekt. Det kan se på, lage, endre, velge, nullstille og fjerne visuelle mods. Modellens endringer valideres og lastes inn når turen er ferdig; avbrutt eller mislykket tur forkaster ventende endringer.
- **Samtykke per samtale:** første modendring spør om å slå på mods i den aktuelle samtalen. Full tilgang i Kode godtar den visuelle endringen automatisk. Manuelle valg i biblioteket gjelder straks. Temavalg og samtykke følger samtalen ved gjenåpning, mens nye samtaler følger standard for sin modus.
- **Animerte pixelart-bakgrunner:** Nordlys, Stjernehimmel og Hav følger med. Egne scener kan bruke skog, figurer og pikselrader med rolig bevegelse. Animasjon kan pauses, følger redusert bevegelse, stopper uten synlighet og begrenses til 24 bilder/sekund. Pikselfigurer mellomlagres for å spare arbeid.
- **Farger og små UI-mods:** tilpass paneler, tekst, aksent, kodefarger, tekstbredde, hjørner og kompakt visning. Et felt over meldingsboksen kan vise klokke, notat, tokenbruk eller arbeidsområde. Mørke temaer bruker mørk modus midlertidig; det vanlige temavalget overskrives ikke.
- **Bibliotek og editor:** palettknappen øverst og Utseende åpner kopiering, redigering, eksport og sletting, med fargefelt og avansert JSON. Lokale modfiler lastes inn ved endring. Ugyldig JSON eller kontrast beholder sist fungerende variant og viser en advarsel. Standardutseende og avbrytere er alltid tilgjengelige.

Mods bruker validerte visuelle data. JavaScript/TypeScript, fri HTML/CSS, eksterne adresser og endringer i modellens verktøy/tillatelser er ikke del av formatet. Dette er Agentic Desktop sitt eget modformat. Se [Tema og visuelle mods](UI-MODS.md).

## 0.22.0: Chat-filer, isolert Python og rask tokenkalender (14. november 2026, bygg 64)

- **Lag nedlastbare filer i Chat:** egne verktøy lager ekte Word-, Excel- og PowerPoint-filer, samt Markdown, tekst, CSV og JSON. Filkort med størrelse og nedlasting vises etter verktøysteget, også når detaljer er lukket. Excel støtter eksplisitte formler; makroer og aktive eksterne koblinger er ikke støttet.
- **Valgfri Python-analyse:** separat bryter i Chat-verktøy og Chat-innstillinger. Python kjører i et isolert arbeidsområde uten nettverk, hjemmemappe, API-nøkler eller Kode-prosjekter. Standardbiblioteket er tilgjengelig; ekstra analysepakker er ikke inkludert. Hver kjøring starter med nye variabler, mens støttede arbeidsfiler beholdes i den aktuelle chat-konteksten.
- **Egne arbeidsfiler per chat:** filene får tilfeldige ID-er og autentiserte nedlastinger. Tidligere versjoner beholdes. Prosjektbytte/kontekstendring gir et nytt arbeidsområde; historiske filkort kan fremdeles lastes ned manuelt. Sletting av chat rydder filene. Midlertidige Chat-filer ryddes også ved avslutning.
- **Tydeligere harness:** modellen får faktiske verktøy og begrensninger. Chat-dokumenter og Python er adskilt fra PC-/prosjektfilene og verktøyene i sidepanelet. Ingen påstått fil, kjøring eller nedlastingslenke før et faktisk verktøyresultat. Demoen kan vise dokumenteksport og Python uten API-nøkkel.
- **Umiddelbar tokenkalender:** profilens dag-/ukekalender og aktivitetskartene viser infoboks ved musepekeren uten ventetid. Dag og full dato står øverst, eksakt tokenantall under. Kalenderen støtter også tastatur og Escape. Fargenivåene beregnes én gang per datasett.

Dokumenter og filer: maks 10 MB per fil, 200 filversjoner/50 MB per chat. Python: 30 sekunder, 512 MB, 20 MB resultatfiler per kjøring. Krever Python 3 og bubblewrap på Linux; appen kjører ikke kode uten fungerende isolering. Opplasting/tolkning av eksisterende Office-filer er ikke innført. Se [Filer og Python i Chat](CHAT-FILES.md).

## 0.21.1: Midtstilte modellbytter og navn i topplinjen (14. november 2026, bygg 63)

- **Roligere samtalevisning:** modellbytte-linjen ligger midtstilt i samtaleområdet i både Chat og Kode. Lange modellnavn brytes innenfor vinduet.
- **Riktig modusikon:** «Fortsett der du slapp» viser Chat- eller Kode-ikon ut fra samtalens egen modus.
- **Navn på samme sted:** klikk på samtaletittelen for å redigere direkte i topplinjen, uten et ekstra navnekort nedenfor. Enter lagrer, Escape avbryter, og fokusbytte lagrer. Pilen ved siden av åpner detaljer og samtalehandlinger.


## 0.21.0: Egne Chat-prosjekter og tankebobler (14. november 2026, bygg 62)

- **Prosjektside i Chat:** ekte meldingsfelt over samtalelisten, søk, åpning, navn og sletting. Klikk på prosjektnavnet åpner siden; egen pil folder sidefanens liste. Ingen tom tråd opprettes bare ved åpning.
- **Eget uttrykk:** velg mellom 15 ikoner og åtte ikonfarger. Prosjekteditoren samler navn, opptil 10 000 ord med instruksjoner og minnevalg.
- **Avgrenset Chat-kontekst:** egne prosjektminner som standard, eller eksplisitt deling av globale Chat-minner. Global systeminstruks, profil, tone, personlighet, posisjon, skills og all Kode-personalisering holdes utenfor. Dette er kontekststyring, ikke OS-isolasjon.
- **Tryggere kontekstbytte:** flytting og endrede prosjektinstruksjoner bygger historikken fra synlige meldinger og eksisterende vedleggsreferanser. Gamle skjulte sammendrag og intern modelltilstand følger ikke med. Aktive og kølagte turer beskyttes mot endring, og sene TAB-forslag forkastes ved kontekstbytte.
- **Utkast og redigering:** separate prosjektutkast, bevarte vedlegg ved langsom første sending, og konfliktbeskjed ved redigering fra et annet vindu. Delte minner merkes tydelig; egne minner beholdes når du bytter minnetype.
- **Små detaljer:** samtaletittel og navnefelt står litt høyere i både Chat og Kode. Tenkerader og kompakte tenkesammendrag bruker en tankeboble.

- **Hvem skrev svaret:** modellbytter vises som en diskret linje i Chat og Kode. Ikonet under hvert svar viser modell og leverandør ved hover eller klikk. Nye svar beholder opprinnelige modellnavn selv etter senere omdøping eller sletting. Endring under strømming vises først når det aktive svaret er ferdig.
- **Leverandører:** Beta-merkene er fjernet etter brukerens ønske. abliteration.ai har egen direkteinngang med API-nøkkel og enklere tekst. Hver tilkoblet leverandør beholder «Test tilkobling», med ventestatus mens testen pågår. Brukeren har bekreftet OpenRouter og abliteration.ai; OpenAI/Anthropic er kontrollert lokalt uten ekte API-kall.

Bruk og grenser er beskrevet i [Chat-prosjekter](CHAT-PROJECTS.md).

## 0.20.0: Arbeidstrær, versjonslogg og verktøypolish (14. november 2026, bygg 60)

- **Grener og arbeidstrær:** prosjektets tannhjul ved meldingsfeltet åpner en ekte gren-/arbeidstrevelger. Bytt lokal gren, opprett gren eller åpne et nytt arbeidstre som eget prosjekt. `/worktree` åpner oppretting i Kode. Git-innstillinger er samlet på én fungerende side. Lokale endringer sperrer grenbytte; aktive modellkjøringer sperrer Git-endringer i samme repo, også fra andre arbeidstrær. Filvisningen oppfriskes etter bytte. Ingen automatisk stash, commit, push, tvunget bytte eller sletting.
- **Versjonslogg fra Profil:** direkte menyvalg åpner hele den medfølgende historikken, med søk og utfellbare oppføringer. «Hva er nytt» beholder de tre siste versjonene. Escape lukker også når søkefeltet har fokus; meldingsutkastet beholdes.
- **Flere verktøystartsider:** pluss lager en ny, selvstendig startfane i felles topprad. Verktøyvalg bruker bare den valgte startsiden, og eksisterende nettleser-/terminaløkter beholdes. Utseende → Pluss i sidepanelet velger verktøystartside eller direkte ny nettleserfane. Grå kant rundt valgt fane er fjernet.
- **Elementannotering:** hold over et synlig nettsideelement for å se ramme, tagg, størrelse, skrift og farge. Klikk legger til en kommentar ved elementet. Skjermbilde og elementkontekst legges i utkastet ved Ferdig, uten automatisk sending. Tegneverktøyene beholdes. Snapshotet leser ikke verdier i skjemafelt; annoteringen gjelder en frossen ramme i hoveddokumentet.
- **Midtstilt Til bunnen:** knappen ligger sentrert over meldingsfeltet i hver samtalerute, også når sidepanelet er åpent.
- **Vedlegg som kan rulles bortover:** bilder og filer ligger i én rad i meldingsfeltet. Musehjul og tastatur kan rulle til vedlegg utenfor kanten; åpning og fjerning virker fortsatt.
- **Utfyllende Kode-innstillinger:** egne lyse og mørke kodepaletter med forhåndsvisning, egen installert monospace-skrift, skriftstørrelse, tabulatorbredde og linjebryting. Standard samtalevisning velger Normal, Tenkning eller Detaljert. Kodekontrollene er samlet under Kode, med inngang fra Utseende.
- **Stabil innsatsmeny:** flytting og skalering av hele menyen er fjernet. Tittel, nullstilling og skyveknapp holder vertikal plass under raske åpninger ved både 100 og 125 prosent skalering.
- **Tydelig nøkkellagring:** modell-/leverandørsiden viser systemnøkkelring, bare øktminne eller eventuell eldre nøkkelfil. Nye nøkler får ingen klartekstreserve på disk. OpenRouter er ikke lenger Beta etter brukerens bekreftede tilkobling og modellhenting; andre leverandører beholder Beta til egne ekte tilkoblinger er bekreftet.

## 0.19.0: Tom oppstart, felles øktfaner og slash-kontroll (14. november 2026)

- **Ny samtale ved oppstart:** standarden er en tom samtalerute i sist brukte modus, eller Chat/Kode valgt under Generelt. Lagrede samtaler beholdes i sidefanen. Fortsett der jeg slapp er et eget valg. Oppfriskning og eksplisitte trådlenker gjenoppretter visningen. Gjenåpning fra statusfeltet følger valget, uten å stoppe arbeid i bakgrunnen eller overskrive andre vinduers lagrede oppsett.
- **Felles topprad:** hver terminaløkt og nettleserfane vises ved siden av øvrige verktøy. Pluss åpner startsiden med egne Ny terminal og Ny nettleserfane. Valg, lukking og tastatur virker per økt. Verktøyene beholdes under fanebytte; skjult nettleser slipper skjermstrøm/native visning. Utseende → Faner i sidepanelet velger felles topprad eller separate rader, også med stablede paneler.
- **Slash:** prosjekthandlinger gir tydelig beskjed uten Kode/prosjekt, også ved direkte inntasting. Hjelp og forslag følger modus. Fem planlagte Demo-kommandoer er skjult fra vanlige forslag; direkte bruk forklarer fortsatt at funksjonen mangler. Norske innsatsargumenter viser Ekstra høy. Alias, argumenter, skills og berørte prosjekthandlinger er kontrollert med lokale testdata.

## 0.18.0: Sidepanel og lokal nettleser uten prosjekt (14. november 2026, bygg 58)

- **Nettleser uten prosjekt:** bare vertsnavn som google.com får riktig adresseoppløsning i Denne datamaskinen. Lokal identifikator behandles ikke som et lagret prosjekt. Adressefeltet støtter også søkeord, med konfigurert søketjeneste.
- **Tydelig verktøyrad:** bare åpnede verktøy vises som lukkbare faner. Fast pluss åpner verktøystartsiden i begge startinnstillinger og stablet modus. Ny terminal og Ny nettleserfane er separate navngitte handlinger. Siste lukking viser startsiden. Faner/valg skilles per prosjekt og lokalt arbeidsområde; lagret stack gjenopprettes etter omlasting.
- **Lokal fillesing:** Filer åpner hjemmemappen uten prosjekt, med full mappesti, systemmappevalg, Hjem, overordnet mappe, oppfriskning og skrivebeskyttet filvisning. Ingen prosjektoppretting eller nye modellrettigheter følger av manuell lesing. Appens datamappe og symlenker inn i den er sperret.
- **Alle verktøy kan åpnes i Kode:** Oversikt viser lokal kontekst uten prosjekt; Endringer og Økt følger aktiv tråd. Team/GitHub forklarer prosjektbehov og har fungerende innganger til valg/innstillinger. Chat beholder sitt separate grensesnitt.
- **Feil og fokus:** nettleserfeil vises per fane med nytt forsøk. Forespørsels-ID hindrer gammel feil i å skjule nyere vellykket navigasjon. Reattach overskriver ikke retry. Ugyldig WS-JSON kan ikke krasje feilbehandleren. Terminalen stjeler ikke fokus fra fanetastaturet. Skjulte stackpaneler slipper portalmenyer og native nettleservisning.
- **Kontroll:** lokale falske sider/API-er, tempfiler, ekte PTY og headless Chrome/Electron. Se docs/SIDEPANEL-WORKSPACE.md for bruk og avgrensninger.

## 0.17.0: Skills-arbeidsområde og stabile prosjektmenyer (13. november 2026, bygg 57)

- **Eget Skills-arbeidsområde:** søk, kilde-/prosjekt-/statusfiltre, instruksjonsredigering, ny skill, importkontroll og på/av. Appens originaler er skrivebeskyttet; lag en egen variant for tilpassing. Utkast beholdes under navigasjon og observerte eksterne filendringer beskyttes ved lagring.
- **Modeller og leverandører samlet:** standardmodell, komprimering, steggrense, leverandørnøkler og modellhåndtering på én side. Skjemaer og feil beholdes under sidebytte i samme innstillingsbesøk. Gamle lenker og søketreff åpner riktig side.
- **Roligere innstillinger:** valgt sidemarkering er umiddelbar og tydeligere enn hover. Ingen flytting eller uttoning av hele rammen under raske sidebytter. Sidemenyen er unntatt fra appens felles glidemarkør, slik at gammelt menyvalg ikke fremheves over nytt innhold. Skjulte beholdte visninger slipper fokus, portalmenyer og lagresnarveier.
- **Riktig prosjektforankring:** topplinjens prosjektvelger åpner ved topplinjen; prosjektbrikken åpner ved meldingsfeltet. Søk, tastatur, mappevalg og tillit er bevart. Menyene lukkes ved navigasjon og følger aktiv rute.
- **Lokalt prosjektmiljø:** tannhjul ved valgt Kode-prosjekt viser faktisk gren, lokal maskin og mappe, med fungerende snarveier til prosjektinnstillingene. Grenbytte og arbeidstrær er ikke implementert i menyen.
- **Stabil innsatsvelger:** faste radhøyder og skyveknapp uten skalering ved trykk/drag. Blåfarge, nivåvalg og tilbakestilling beholdes uten vertikalt hopp.
- **Kontroll:** isolerte lokale modellservere og headless Chrome/Electron. Ingen ekte nøkler, betalte modellkall eller installasjonsendring. Bruk og avgrensninger i docs/WORKSPACE-POLISH.md.

## 0.16.0: Prosjektmenyer og redigerbar meldingskø (13. november 2026, bygg 55)

- **Prosjekt- og trådmenyer:** like handlinger fra høyreklikk og ⋯, med tastaturnavigasjon. Kode har fungerende prosjektfiler og kopiering av prosjektsti; Chat har egne prosjektkort uten mappevalg. Informasjonskort viser riktig modus, navn, antall samtaler og eventuell mappe, og lukkes ved navigasjon/innstillinger.
- **Lest/ulest og eksport:** manuell markering beholdes også på aktiv tråd og etter sidelast. Ctrl+Shift+U kan tilpasses i Hurtigtaster. Trådmenyen har lokal Markdown-eksport med hele samtalen, i tillegg til kopiering, forgrening, festing og arkivering.
- **Kø eller straks:** Generelt → Samtale velger standard for nye meldinger i begge modus. Kø/Straks ved feltet kan også endre egne ventende vanlige meldinger i aktuell tråd. Meldingene kommer inn ved neste steg; det avbryter ikke en pågående tekststrøm midt i svaret.
- **Kømeny:** rediger tekst uten å endre køplass/vedlegg, fjern meldingen, eller flytt den til en usendt sidesamtale. Menyen lukkes når meldingen forlater køen. Skallkommandoer, skills og agentmeldinger beholder sine grenser og snapshot.
- **Gjenopprettbart sideutkast:** flytting lagrer tekst og vedleggsreferanser i samme transaksjon som køuttak og sidechatoppretting. Utkastet tåler mistet HTTP-svar og kan åpnes på nytt uten modellkall. Sen gjenoppretting overskriver ikke nyere skriving eller sending; vedlegg/skill bevares ved lokal navigasjon. Kopien ryddes først ved akseptert egen sending og beskytter vedlegg fra opprydding i mellomtiden.
- **Autoritativ køvisning:** køen hentes separat fra samtalehistorikken med hendelsesgrense. Eldre kømeldinger blir ikke borte når bare siste samtaleside er lastet, og sene svar gjenoppliver ikke fjernede meldinger. Redigering, fjerning og styring synkes via loggen til andre vinduer.
- **Kontroll:** lokale falske modellservere og headless Chrome/Electron. Bruk og avgrensninger i docs/SIDEBAR-AND-QUEUE.md. Installert PC-app er ikke endret.

## 0.15.0: Samlede innstillinger og Kode-sammendrag (13. november 2026, bygg 54)

- **Fire sider blir to:** Konfigurasjon samler kode-harness, global AGENTS.md, innstillingsfiler og prosjektkonfigurasjon, med seksjonshopp. Personalisering og minner samler Chat og Kode i en lokal modusvelger. Gamle innganger og søkeresultater åpner riktig side og del.
- **Plass til egne instrukser:** Systeminstruks og Om deg har hver sin grense på 10 000 ord, med ordtelling og lik servervalidering. Overlange utkast beholdes og kan rettes før lagring. Ulagrede Chat-felt beholdes ved bytte til Kode-delen. Chat- og Kode-minner lagres, slettes og brukes hver for seg.
- **Ekstra høy innsats:** nytt valgbart trinn før Maks for demo, Anthropic og OpenRouter. OpenRouter får nivået i reasoning.effort, uten tidligere nedjustering til Høy. Andre kompatible servere beholder den konservative skalaen.
- **Stabil innsatslagring:** raske nivåvalg og nullstilling lagres i rekkefølge, med siste valg som mål. Send venter på bekreftet lagring. Ved lagrefeil beholdes utkastet og riktig lagret nivå vises.
- **Sammendrag øverst til høyre:** Kode får et kompakt kort med prosjekt, registrerte filendringer, trådens underagenter og prosjektets bakgrunnsterminaler. Utvid detaljer for mål, plan, kilder og kapitler. Åpning starter ingen terminal eller modellkall.
- **Komplett filhistorikk:** kortet og Endringer-panelet henter egne endringsmetadata for hele tråden, også før siste lastede samtaleside. Angre, forgreninger og prosjekt-/trådbytte er avgrenset. Diffen hentes bare for valgt tur.
- **Innstillingsfokus:** åpning lukker sammendragskortets portal. Samtalens dokumentsnarveier kan ikke arkivere eller lage tråder mens brukeren redigerer innstillinger. Ctrl+, og Escape fungerer fortsatt.
- **Kontroll:** isolerte lokale modellservere og headless Chrome/Electron; ingen ekte API-nøkler eller betalte modellkall. Installert PC-app er ikke oppdatert. Bruk og avgrensninger er beskrevet i docs/SETTINGS-AND-SUMMARY.md.

## 0.14.0: Kontekstbasert TAB-fullføring og UI-polish (12. november 2026, bygg 52)

- **Grå tekstforslag:** et kort forslag vises etter markøren i promptfeltet. TAB setter inn suffikset uten å sende meldingen; Escape avviser. Linjebryting følger tekstfeltet. Ingen forhåndstekst blir lagret i utkastet før den godtas.
- **Historikk først:** funksjonen er av som standard og begynner først ved tredje brukermelding etter to tidligere besvarte brukerturer. Første og andre utkast lager ingen forslagskall. Gjelder både Chat og Kode.
- **Av/på og egen modell:** Generelt → Samtale har «Autofullfør meldinger med TAB» og «Modell til autofullføring». Velg en egen konfigurert modell eller «Samme som samtalen». Valget endrer ikke samtalens modell; slettes modellen, brukes samtalens modell igjen.
- **Avgrenset kontekst:** siste samtaleutdrag og faktisk åpnet tekstfil i riktig Kode-tråd. Chat får ikke kodefiler. Ingen prosjektgjennomsøking, minner, systeminstruksfiler, terminalbuffer eller verktøytilgang. Forslag bruker egne modellkall og API-kvote.
- **Rolig livsløp:** kort skrivepause før oppslag, avbrudd ved ny tekst, Escape, fokus-/tråd-/modellbytte og av-valg. Gamle svar kan ikke erstatte nyere utkast. IME, Shift+TAB og vanlig fokusvandring bevares. Forslag vises bare ved markøren i slutten av utkastet.
- **Trygg menyfullføring:** TAB fullfører `/`-kommandoer og skills som tekst uten å utføre; Enter/klikk beholder sin handling. `@` støtter filstier, og sene treff forkastes. Disse menyene virker fortsatt uten tidligere historikk.
- **Rene innstillinger:** fjernet rulleskyggene som ga en svak svart stripe på tvers av siden. Innsatsvelgeren beholder blåfargen ved standard, nivåvalg og tilbakestilling. Leverandørenes små bokstavmerker, blant annet OR, er fjernet fra modellknappen og innstillingene; navn og modellgrupper beholdes.
- **Kontroll:** lokale falske modellservere, tempfiler og headless UI. Ingen betalte kall, ekte nøkler eller installasjonsendringer. Se `docs/PROMPT-COMPLETION.md` for bruken og avgrensningene.

## 0.13.3: Chat som egen samtalemodus (12. november 2026, bygg 49)

- **Tydelig modusskille:** Chat får samtaleveiledning i harness 15.6, uten Kodes mål-/planinstruksjoner eller prosjektarbeidsflyt. Personlighet og egen Chat-personalisering beholdes. `/goal` og `/plan` er Kode-handlinger; `!` er vanlig tekst i Chat.
- **Tryggere redigering:** vedlegg, skill og erstatningsmelding valideres før historikken kuttes. Manglende vedlegg eller ugyldig melding bevarer gamle svar, kapittel og modellvalg. Valgt ny modell og opprinnelige vedlegg brukes ved vellykket nytt forsøk.
- **Synlige svar ved feil:** mislykket redigering opphever falming og beholder utkastet; nytt svar kan prøves igjen. Rene samtaler får ikke Kodes tillatelsesvelger, planbrikke, arbeidsrad eller endringskort.
- **Midlertidig uten lagrede minner:** midlertidige chatter verken leser eller oppdaterer Chat-minner. Minnevalget er tydelig av og deaktivert. Teksten beskriver midlertidig lokal oppbevaring og sletting ved lukking korrekt.
- **Kontroll:** faktisk utsendt prompt og serverens verktøyavvisning er testet mot lokal falsk API-modell. Vedlegg, redigering, nytt svar, minnevalg, stopp og modusskille kontrolleres headless. Se `docs/reviews/2026-11-12-chat-readiness.md`. Installert app er ikke oppdatert.

## 0.13.2: Kodeflyt, underagenter og tryggere Angre (12. november 2026, bygg 48)

- **Tryggere filhistorikk:** etterbytes registreres ved hver vellykket filskriving/sletting. En annen agents senere endringer blir ikke tilskrevet feil tur. Overlappende redigeringer merkes og vanlig Angre avvises; eksplisitt overstyring krever bekreftelse. Prosjektets apptråder må være ferdige før Angre.
- **Underagentkø:** meldinger bak opptatt brukerarbeid reserverer nå kapasitet og kan ikke omgå grensen på fire. Testet med samtidige lokale API-hjelpere, feil, stopp, reconnect og omstart.
- **Filer og endringer:** faktisk arbeidsfil vises uten å overta brukerens filvalg. Grønne/røde linjetall vises i filtre, filhode, Oversikt, sluttkort og diff. Ordnet linjediff, EOF-markør, tydelige anslag og binærmerking erstatter misvisende tall.
- **Levende arbeid:** første strømmede kommandoutdata blir synlig, med avgrenset gjengivelse. Økt viser kjørende modellkommandoer, siste utdata og eksplisitt Stopp turen. Trådbytte isolerer innholdet.
- **Stabile sluttkort:** gjentatte endringshendelser gir ett kort. Angre oppdaterer eldre historikk, oversikt og topplinje; forsinkede diff-svar forkastes. Rene svar/kommandoer uten filverktøyendringer får ikke et tomt endringskort.
- **Oppdragsstyring:** obligatorisk brukeroppdrag og siste avklaringer gjelder også med gamle egendefinerte instrukser eller workflow avslått. Harness 15.5. Kodegjennomgang merker binærfiler, overlapp og shell-dekning, slik at modellen ikke skal gjette innhold eller forfatterskap.
- **Ærlige grenser:** vilkårlige shellendringer spores fortsatt ikke; shell er ikke en OS-filsandkasse. Se `docs/reviews/2026-11-12-code-readiness.md` for funn, rettelser og videre arbeid. Installert app er ikke oppdatert.

## 0.13.1: Valgfri modellkontekst i innstillinger (12. november 2026, bygg 47)

- **Tre brytere per modus:** lokal dato/tid, modell/leverandør og omtrentlig posisjon ligger under Kode-harness og Chat-personalisering. Chat og Kode lagrer egne valg. Dato og modellopplysninger er på som standard; posisjon er av.
- **Tid:** maskinens ukedag, lokale dato, klokkeslett og IANA-tidssone erstatter den tidligere UTC-datoen. Av-valget fjerner denne automatiske tidskonteksten.
- **Modell:** valgt visningsnavn, teknisk modell-ID, leverandørnavn/-type og et endepunkt uten innloggingsdata kan deles. Av-valget fjerner den automatiske identitetskonteksten og ber modellen unngå gjetting.
- **Posisjon:** skriv by/land manuelt, eller velg «Hent fra IP». Oppslaget gjøres bare ved dette klikket mot ipapi.co, fra appmaskinens nettverk. Bare by/land og tidspunkt lagres, med tydelig kilde; rå IP og koordinater sendes ikke som posisjonskontekst.
- **Korrekte grenser:** modus, faktisk verktøyliste, bildebegrensninger og gjeldende tillatelsesnivå er fast informasjon. Kontekstbryterne gir ingen ekstra verktøy eller rettigheter. Harnessversjonen er 15.4.
- **Stabil lagring:** delvise endringer bevarer andre felt og den andre modusen. En feilet lagring ruller bryteren tilbake; nyere manuelt utkast beholdes ved et forsinket IP-svar. IP-oppslag som kommer etter en nyere lagret endring avvises.
- **Kontroll:** falske IP-svar og midlertidige mapper brukes i testene. Ingen ekte posisjonsoppslag, betalte modellkall eller endring av installert app.

## 0.13.0: Slash-skills, trådfaner og terminaldeling (12. november 2026, bygg 46)

- **Skills fra filer:** `skills/<navn>/SKILL.md` i appen og prosjektet, med navn, beskrivelse og valgfri argumentbeskrivelse. Prosjekt overstyrer globalt; eldre skill-mapper og import beholdes. Ugyldige metadata gir advarsel uten å stoppe appen.
- **Slash-meny:** `/` åpner navn og beskrivelser, med fuzzy-filtrering, piltaster, Enter og Esc. Menyen oppdateres ved filendring uten omstart. Rå argumenter, inkludert mellomrom og linjeskift, erstatter `{{args}}` bokstavelig.
- **Instruksjoner per tur:** skill-kroppen settes i systeminstruksen for gjeldende tur, også ved kø og styring. Kroppen vises ikke som brukertekst og blir ikke liggende i senere modellhistorikk eller komprimeringssammendrag. Harnessversjon 15.3.
- **Én demo:** `/review` følger med og kan vises skrivebeskyttet i Innstillinger. Den tidligere endringsgjennomgangen heter `/review-changes`; review-alias beholdes når ingen review-skill finnes.
- **Egen nettleserfane per Kode-tråd:** modellens navigasjon, snapshot, klikk, tekst, console, skjermbilder og innloggingssamtykke bindes til faktisk servertråd. Manuelle panelbytter endrer ikke modellens fane. Eier vises i tabstripen, med knapp for å vise den fokuserte trådens fane.
- **Terminaldeling:** «Del utvalg» og «Del siste utdata» legger ren terminaltekst i riktig kodetråds eksisterende utkast. Ingen sending eller ny tråd opprettes automatisk. Grensen er 200 linjer / 12 000 tegn, med tydelig avkortingsmerknad.
- **Uavhengig review:** rettet tap av nyere utkast ved forsinkede kommando-/sendesvar, et lukke-/oppretterace for nettleserfaner og manglende endringssignal sent i store Unicode-skills. Se review-notatet for omfang og begrensninger.
- **Kontroll:** lokale falske modellservere, ekte tempfiler og PTY, headless UI og native Electron under xvfb. Ingen betalte modellkall, ekte nøkler eller installasjonsendringer.

## 0.12.2: Markert svartekst og kontroll av modell/paneler (12. november 2026, bygg 45)

- **Markeringsmeny:** markert tekst i et modellsvar får «Legg til i chat» og «Legg til i sidechat». Utdraget legges som sitat i et utkast uten å sende; eksisterende tekst beholdes. Sidechat opprettes i samme modus/prosjekt med bare utdraget, uten kopiert samtalehistorikk. Menyen støtter tastatur, Escape og smale vinduer, og skjules ved rulling. Den native nettleservisningen i Electron viker hvis menyen overlapper. Grensen er 64 000 tegn per utdrag.
- **Løsrevet vindu:** samme-chat-handlingen virker; sidechat-handlingen er deaktivert med forklaring om å bruke hovedvinduet. Det opprettes ingen skjult tråd.
- **Filer:** gammel forhåndsvisning og Rediger-knapp skjules under lasting, ved feil og for binærfiler. Forsinkede svar kan ikke erstatte den valgte filen. Mappesignaler oppfrisker også den åpne filen.
- **Nettleser:** en aktiv fane som lukkes fra et annet vindu erstattes av en eksisterende fane. En ny fane som venter på serveren beholdes. Finn svarer riktig også når søket har mellomrom rundt teksten.
- **Terminal:** forsinket henting av terminaler kan ikke lenger starte et skjult skall etter at panelet er forlatt.
- **Modellens miljø:** prompten beskriver den delte aktive prosjektfanen og skillet mellom modellens separate kommando og brukerens PTY-terminal. Lokal-forklaringen skiller app/verktøy på maskinen fra modellens valgte leverandør. Harnessversjonen er 15.2; egne lagrede instrukser bevares.
- **Bildestøtte:** OpenAI-kompatible modeller uten bildestøtte får nå uttrykkelig beskjed når et bilde i et verktøyresultat ikke er videresendt. Tekstdelen beholdes.
- **Kontroll:** ekte filendringer, PTY og lokale nettsider/falsk modellserver brukes i testene. Ingen betalte modellkall eller ekte nøkler. Den installerte appen er ikke oppdatert.

## 0.12.1: Modellvelger, Kode-tidslinje og panelpolish (11. november 2026, bygg 43)

- **Tillatelser før prosjektvalg:** knappen i Kode virker også uten prosjekt. Den lagrer standarden for nye prosjekter, synkronisert med en egen tillatelsesgruppe øverst i Generelt. Eksisterende prosjekter og tråders tillatelsestak beholdes; valget legger ikke til fil- eller kommandotilgang uten prosjekt.
- **Tidslinje bare i Kode:** vises fra fire meningsfulle meldinger (spørsmål og svar), med tynne streker. Forhåndsvisningen viser spørsmål og siste svartekst, samt kapittel når det finnes. Meldingshopp og tastaturstøtte beholdes.
- **Modell og innsats:** avrundet modellknapp, nøytral avhuking, søk og leverandørgrupper. Menyene vises utenfor rutens avgrensning og følger vindus- og rutestørrelsen. OpenRouter-oppsettet og modellens faktiske innsatsnivåer beholdes.
- **Generelt:** tillatelser først, ryddige grupper og vindusvalg som faktisk fungerer. Plassholderen «Alltid øverst» er tatt ut av siden.
- **Sammendrag, Oversikt og Økt:** kontrollert mot faktisk redigering av testfiler, kontekstdata og resultatknapper. Oversikt og Økt viser feil med «Prøv igjen» og unngår å vise forrige tråds data ved trådbytte.
- **Avgrensning:** Sammendrag er strukturert status fra innlastet trådhistorikk, ikke en separat KI-oppsummering av hele samtalen. Ingen ekte API-nøkler eller betalte modellkall brukes i kontrollene. Installert app er ikke oppdatert.

## 0.12.0: Nye standardinstrukser, agentvalg og stabile innstillinger (11. november 2026, bygg 40)

- **Standarder i Markdown:** `docs/system-instructions/chat.md` og `code.md` er forkortede, leverandøruavhengige tilpasninger av referansefilen brukeren fant. Claude-spesifikke verktøy, modellpåstander, private maskinstier og øktdata er utelatt. De samme filene følger den pakkede appen.
- **Chat-personalisering:** en ikke-tom systeminstruks følger med. «Gjenopprett standard» for bare systeminstruksen bevarer «Om deg», tone og minner. Eksisterende egne instrukser bevares, også bevisst tømt tekst.
- **Riktig modus og verktøy:** Kode uten prosjekt fikk tidligere Chat-instruksjoner. Den beholder nå Kode-identiteten og holdes adskilt fra Chat-minner. Miljølaget beskriver faktisk prosjekt, verktøy, modellendepunkt og panelbegrensninger uten å love tilgang til hele skrivebordet.
- **Modeller:** automatisk komprimering kan slås av og på. Manuell `/compact` virker fortsatt. Steg per tur kan settes fra 1 til 1000, med 50 som standard; den valgte grensen gjelder fra neste tur.
- **Fest tråder:** en egen knapp ved ⋯ fester og løsner tråden, også i Kode uten prosjekt. Tastaturfokus følger tråden når den flyttes.
- **Endringer:** endringskort og lenken til Endringer vises etter registrerte filendringer, uten tomme endringsoppsummeringer etter vanlige svar, lesing eller kommandoer uten filendringer. Filoversikt, diff og Angre er beholdt.
- **Innstillinger:** lasting av én underside skjuler ikke lenger hele innstillingsvinduet. Navigasjonen beholder plasseringen, innholdet har en lokal lastetilstand, og sideanimasjonene som ga «pop inn/ut» er fjernet. Rullefeltet har fast plass, og gamle søke-/rullekall avbrytes ved rask navigasjon.
- Den installerte appen er ikke oppdatert.

## 0.11.3: Ryddigere Chat-modus (11. november 2026, bygg 38)

- **Sidefanen:** Prosjekter står over Chatter i Chat. Prosjektgrupper, tomtilstander og knappene for å legge til er beholdt.
- **Meldingsfeltet:** én knapp med innstillingsikon samler Chat-funksjonene. Verktøyvalgene finnes fortsatt i menyen, mens de separate brikkene for aktive verktøy er fjernet.
- **Personlighet:** flyttet fra meldingsfeltet til Innstillinger → Chat. Valget gjelder den aktive chatten eller utkastet før første melding.
- **Lagring og egne vinduer:** personlighetsvalget viser lagring, beholder faktisk verdi ved feil og kan prøves igjen. Innstillinger åpnes også fra Chat i et eget vindu.
- **Modellvelgeren i Chat:** viser modellnavn og pil uten leverandørikon. Leverandørgruppene i modellmenyen er beholdt.
- **Kontroll:** typesjekk for server, web og Electron består. Ti relevante UI-tester består, inkludert sidefanens rekkefølge, verktøyvalg, personlighet i utkast og eksisterende chat, feil og nytt forsøk, Chat i eget vindu og kontroll av Kode. Visuelt kontrollert i lyst og mørkt tema, samt ved 390 px bredde.
- Endringene er avgrenset til Chat. Den installerte appen er ikke oppdatert.

## 0.11.2: Tillatelsesvalg i meldingsfeltet i Kode (11. november 2026, bygg 35)

- **Knapp i meldingsfeltet:** tillatelsesnivået kan endres direkte i Kode, med en meny over feltet og en hake ved valgt nivå. Knappen vises ikke i Chat.
- **Tre tydelige nivåer:** Be om godkjenning, Godkjenn for meg og Full tilgang. Forklaringene beskriver appens faktiske tillatelser: automatisk filredigering på mellomnivået og automatisk godkjenning av vanlige verktøykall ved Full tilgang. Beskyttede filer krever fortsatt godkjenning.
- **Prosjektet:** valget gjelder prosjektets Kode-tråder og endrer ikke standardvalget i Innstillinger. Uten et prosjekt forklarer knappen at et prosjekt må velges først.
- **Trådgrenser:** hjelpetrådens faktiske tillatelsesnivå vises på knappen. Høyere nivåer er deaktivert hvis tråden har et tillatelsestak.
- **Betjening:** piltaster, Home/End og Escape med tilbakeføring av fokus, lagring med feilmelding og nytt forsøk, samt plassering som holder menyen innenfor vinduet.
- **Kontroll:** typesjekk for server, web og Electron består. Åtte nye og tre berørte UI-tester består, blant annet ekte prosjektlagring, hjelpetrådens grense og godkjenning av beskyttet fil selv ved Full tilgang. Menyen er visuelt kontrollert i lyst og mørkt tema og ved 390 px bredde; testene dekker også 360 px.
- Den installerte appen er ikke oppdatert.

## 0.11.1: Ny prosjektflyt i Kode (11. november 2026, bygg 34)

- **Opprett prosjekt:** en egen dialog med prosjektnavn og kildemappe, inspirert av referansebildene. Mappen kan endres eller fjernes før oppretting, og mappenavnet foreslås som prosjektnavn.
- **Ubuntus mappevelger:** skrivebordsappen bruker systemdialogen gjennom en avgrenset Electron-bro. Localhost bruker `zenity`. Hvis systemvelgeren ikke er tilgjengelig, brukes appens mappevelger som reserve. Flytting og ny tilkobling til en prosjektmappe bruker samme mappevalg.
- **Stol på mappen:** Agentic Desktop forklarer tilgang til filer, kommandoer og mappeinstruksjoner før prosjektet opprettes. Avbryt bevarer utkastet. Bekreftelsen gir ikke flere tillatelser.
- **Avbryt og feil:** vern mot dobbel innsending og sene svar fra mappevelgeren, forståelige feilmeldinger og mulighet til å prøve igjen. Systemvelgeren har tidsavbrudd og avsluttes når localhost-serveren stopper.
- **Versjon:** `package.json`, låsefilen og `version.json` er samkjørt. Den installerte appen er ikke oppdatert.
- **Kontroll:** typesjekk og alle 335 servertester består; 14 nye/berørte UI-tester og 7 berørte Electron-tester består. Skjermbilder er kontrollert i lyst og mørkt tema og ved 390 px bredde. Nettleserens miljøtest sjekker nå variabelprefikset `AD_` uten å feiltolke `CODEX_THREAD_ID`.

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
