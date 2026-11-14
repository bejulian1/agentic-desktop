# Tema og visuelle mods

I Chat kan du også åpne **Tema og bakgrunn** på startsiden eller i meldingsfeltets verktøymeny.

Åpne **palettknappen øverst → Tema og mods**, eller **Innstillinger → Utseende → Egne temaer og mods**. Eksempeltemaene Nordlys, Stjernehimmel og Hav følger med. Biblioteket er lokalt, og hver samtale har sitt eget temavalg. Når du velger et tema på en tom startside, setter du standard for den aktuelle modusen. En samtale med et eget valg følger dette; **Tilbake til standard** viser appens vanlige utseende i akkurat den samtalen.

Du kan be modellen om for eksempel:

- «Lag et mørkt pixelart-tema med nordlys og klokke over meldingsfeltet.»
- «Gjør bakgrunnen roligere og bruk grønn aksent.»
- «Lag et lyst tema med blå paneler og mer plass til teksten.»
- «Tilbake til standardtema.»

## Samtykke og innlasting

Første gang modellen vil aktivere eller redigere en mod, spør appen om du vil slå på mods **for denne samtalen**. Velg **Slå på** eller **Avslå**. I Kode med Full tilgang godtas den visuelle endringen automatisk. Dette gir ingen nye fil-, kommando- eller nettverkstillatelser. Temaet lastes når modellens tur er ferdig, og venter under strømming. En avbrutt eller mislykket tur forkaster modellens ventende modendringer. Et manuelt valg i biblioteket gjelder med en gang.

Temaet tegnes bak samtalen, også etter at startsiden er borte. Nordlys og de andre nattscenene velger mørk modus midlertidig. Appens vanlige lys-/mørkvalg overskrives ikke. En ny samtale beholder standardutseendet hvis ingen standardmod er valgt. Valg per samtale beholdes ved gjenåpning.

**Mods i denne samtalen** trekker tilbake samtykket og fjerner temaet fra samtalen. **Tillat visuelle mods** slår hele funksjonen av. **Animerte bakgrunner** pauser bevegelsen uten å fjerne fargene eller motivet. Operativsystemets og appens reduserte bevegelse respekteres. Animasjon kjører bare når bakgrunnen er synlig, maksimalt 24 bilder/sekund. Pikselfigurer tegnes til mellomlager og flyttes som bilder.

## Tilpasning

Biblioteket har kopiering, redigering, eksport og sletting. Eksempeltemaene beholdes, men kan kopieres til egne varianter. Editorens fargefelt, bakgrunnsvalg og skyveknapper er en inngang til JSON-definisjonen under. Modellen kan også redigere denne gjennom `ui_mod`-verktøyet. Den får faktisk verktøybeskrivelse og skal ikke påstå at den har sett grensesnittet.

En mod kan endre:

- bakgrunn, paneler, flater, tekst, aksent og kodefarger
- tekstbredde, hjørner og kompakt meldingsvisning
- nordlys, stjernehimmel, hav, skog eller egen scene med figurer og pikselrader
- et lite felt over meldingsboksen med notat, klokke, tokenbruk for siste tur eller arbeidsområde

Pikselgrafikk bruker et logisk lerret på **320 × 180**. Lag kan være `rect`, `ellipse`, `polygon` eller `sprite`. En sprite består av rader med ett tegn per piksel; punktum er gjennomsiktig og øvrige tegn henviser til hex-farger i `palette`. Lag kan flyte, gli eller blinke med begrenset hastighet og utslag. Temaenes dataformat er definert i [shared/ui-mods.ts](../shared/ui-mods.ts).

Appen bruker et validert, deklarativt format for visuelle mods. Det inneholder ingen kjørbar JavaScript/TypeScript, fri HTML/CSS, eksterne adresser, nye modellinstruksjoner eller verktøykroker. Funksjonelle utvidelser utenfor de støttede informasjonsfeltene er ikke en del av denne versjonen. Claude sine pluginfiler kan brukes som inspirasjon, men må oversettes til Agentic Desktop-formatet.

## Lokale filer og validering

Biblioteket viser mappen med lokale JSON-filer under appens datamappe, i `ui-mods/`. Filnavn og `id` skal stemme. Filendringer lastes inn automatisk; et tema som modellen arbeider på venter til turen er ferdig. Ugyldig JSON eller for dårlig kontrast gir advarsel og beholder sist fungerende variant. Ved første innlasting utelates en ugyldig fil. Maks 24 egne mods, 60 000 tegn per definisjon, 24 grafikklag, 64 × 64 piksler per sprite og fire informasjonsfelt.

Tekst må ha minst 4,5:1 kontrast mot de definerte hovedflatene, dempet tekst minst 3:1. Bilder og bakgrunner påvirker opplevelsen i tillegg; vurder alltid lesbarheten i appen. Godkjenninger og appkontroller tegnes av appen og kan ikke erstattes av moddata. En mod laget fra en samtale kan ikke overskrive eller slette en annen samtales egendefinerte mod gjennom modellverktøyet. Bibliotekets manuelle redigering er brukerens felles kontrollflate.

Inspirasjon: Anthropic dokumenterer [farger og bakgrunner per økt](https://code.claude.com/docs/en/plugins/mods/interface) og [mods som pluginutvidelser](https://code.claude.com/docs/en/plugins/mods). Agentic Desktop har sin egen implementasjon og sitt eget format.

## Globalt bakgrunnsbilde og glassflater

**Innstillinger → Utseende → Bakgrunn og glassflater** lar deg velge et eget PNG-, JPEG- eller WebP-bilde for hele appen. Bildet brukes i både Chat, Kode, navigasjonen og innstillingene. Du kan bytte eller fjerne det straks, og justere bildestyrke og uskarphet. Valget beholdes etter omstart. Et samtaletema med eget motiv tegnes over den globale bakgrunnen inne i akkurat den samtalen. Nullstilling av samtaletemaet viser den globale bakgrunnen igjen.

Bildet lagres lokalt under `appearance/images/`, adskilt fra meldingsvedlegg. Det sendes ikke til modellen. Originaler opptil 12 MB behandles lokalt, skaleres til høyst 2560 piksler på lengste side og lagres som et bilde på maks 3 MB. Bytte og fjerning rydder den gamle lokale bakgrunnsfilen. SVG og animerte GIF-bakgrunner er ikke støttet.

Når et bilde eller scenetema vises, står modellsvar og tenkeutdrag uten egne flater eller omriss. **Uskarp glassbakgrunn** legger ett uskarpt, dempet lag bak innholdskolonnen, fra topp til bunn, med myk uttoning mot skarpe sidemarger, slik at teksten er lesbar rett på motivet. Bryteren er på som standard, finnes også i modbiblioteket, og kan slås av for å se bakgrunnen skarpt. Samtalen går i tillegg gradvis over i uskarphet ned mot meldingsfeltet, med samme avgrensning mot sidene. Bredden følger vinduet og temaets innholdsbredde. Bare meldingsfeltet og dine egne meldinger har en flate: halvgjennomsiktig og mørk i mørk modus, med et tynt omriss. Meldingsfeltet skifter ikke farge ved fokus. Vanlig visning uten bakgrunn bruker ingen filtre.
