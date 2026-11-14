# Sidepanelet i Kode

Fra v0.19.0 er **Felles topprad** standard under Utseende → Faner i sidepanelet. Hver terminaløkt og nettleserside får en egen fane ved siden av Filer, Endringer og øvrige åpne verktøy. Fra v0.20 lager hvert pluss en egen startfane, med egne knapper for Ny terminal og Ny nettleserfane. Utseende → Pluss i sidepanelet kan i stedet åpne en nettleserfane direkte. Lukking av en øktfane lukker den økten; andre økter beholdes. Separate rader gjenoppretter grupperingen fra v0.18.0. Begge valg støtter stablede paneler, og visningsbytte lukker ikke serverens økter.

Generelt → Samtale ved oppstart velger **Ny, tom samtale** (standard) eller **Fortsett der jeg slapp**. Modus følger det separate oppstartsvalget. Tom oppstart skjuler verktøypanelet og åpner en ny lokal samtalerute uten å opprette en lagret tråd. Tidligere samtaler beholdes. Oppfriskning og eksplisitte trådlenker beholdes; gjenåpning fra statusfeltet følger oppstartsvalget. Utkast ved slik statusfelt-gjenåpning ligger fortsatt i den opprinnelige samtalen så lenge prosessen kjører. Vanlige usendte utkast er fortsatt minnelagret og overlever ikke full avslutning; denne runden innfører ikke permanent utkastlagring.

Fra v0.18.0 vises åpne verktøy som faner i én felles rad. Plussknappen **Åpne verktøy** viser verktøystartsiden. Den oppretter ingen terminal eller nettleserfane. Velg et verktøy på startsiden, eller gå tilbake via en åpen fane. Lukk siste verktøy for å vise startsiden igjen. Piltaster, Home/End og Delete virker når verktøyfanen har fokus.

**Ny terminal** oppretter en terminaløkt i Terminal. **Ny nettleserfane** oppretter en side i Nettleser. Disse handlingene er navngitt for å skille dem fra fellesvelgeren. Begge startvalg under Utseende støtter fellesvelgeren. Stablede paneler beholdes montert bak den; deres menyer og native nettsider skjules mens velgeren eller innstillinger ligger over. Åpne verktøy/valg skilles mellom prosjekter og Denne datamaskinen. Lagret stack-layout gjenopprettes etter omlasting.

## Uten prosjektmappe

- **Nettleser** åpner nettadresser, inkludert bare vertsnavn som google.com, og søk fra adressefeltet. Tilbake, frem, oppfriskning, egen historikk, skjermbilder, zoom og sidefaner bruker eksisterende nettlesermotor. Manuell nettlesing krever ingen prosjektmappe. Modellen får ingen nye verktøy av dette.
- **Terminal** starter som før i hjemmemappen og kan dele valgt utdata med riktig Kode-utkast. Ingen melding sendes automatisk.
- **Filer** starter i hjemmemappen i lesemodus. Skriv en full mappesti og trykk Enter/Åpne, bruk systemets mappevelger, Hjem eller Opp ett nivå. Mappen kan være utenfor et lagret prosjekt. Dette oppretter ikke et prosjekt. Redigering i mini-editoren er fortsatt prosjektfunksjonen; lokalvisningen er skrivebeskyttet og registrerer ikke filinnhold i modellkonteksten.
- **Oversikt** viser lokal mappe og valgt samtale/modell, med snarveier til verktøyene. **Endringer** og **Økt** viser data fra aktiv tråd, eller forklarer at det ikke finnes data ennå.
- **Team** og **GitHub** kan åpnes, men oppgaver/repo-visning trenger en prosjektmappe. Disse sidene forklarer behovet og åpner prosjektvelgeren; GitHub har også inngang til kontoens innstillinger.

Chat er fortsatt en egen samtalemodus uten Kodes sidepanel.

## Feil og avgrensninger

En nettleserfeil vises i riktig sidefane med **Prøv igjen**. Gammel feil fra en tidligere adresse får ikke dekke en nyere, vellykket side. Fanebytte/ny tilkobling overskriver ikke navigasjonens retry-handling. Ugyldig JSON i WebSocket avvises kontrollert.

Lokale fil-API-er er eksplisitte manuelle lesehandlinger, ikke nye agentverktøy. Kun absolutte stier, vanlige filer og mapper tillates; relative stier, ..-segmenter, spesialfiler, appens datamappe og symlenker inn i den avvises. Tekstlesing begrenses til 2 MiB, med beskjed ved avkorting. Mapper begrenses til 5 000 oppføringer. Operativsystemets vanlige filtilgang gjelder. Ingen skrivemulighet er lagt til i disse API-ene.

Kontrollen bruker lokale prøvesider og falske modeller, ikke betalte kall, ekte nøkler eller ekte nettleserprofiler. Adresser som google.com er kontrollert i adresseoppløsningen; selve UI-visning/input prøves med lokale HTTP-sider. Dette er ingen ny fullstendig gjennomgang av alle nettleserfunksjoner.
