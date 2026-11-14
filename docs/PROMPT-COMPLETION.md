# Autofullføring med TAB

Slå på **Innstillinger → Generelt → Samtale → Autofullfør meldinger med TAB**. Under **Modell til autofullføring** velger du en egen modell, eller **Samme som samtalen**. Alle allerede konfigurerte modeller er tilgjengelige. Valget bytter ikke modellen som svarer når meldingen sendes. Funksjonen er av som standard.

Forslag begynner først når tråden har to tidligere besvarte brukerturer, altså fra tredje brukermelding. Dette kontrolleres også av serveren, og oppdateres uten omlasting. En vanlig kommando-/fil-/skillmeny kan fortsatt fullføres med TAB fra første utkast.

Etter en kort skrivepause vises en mulig fortsettelse med grå tekst. **TAB** setter den inn i utkastet uten å sende. **Escape** avviser forslaget frem til du skriver videre. **Enter** følger ditt vanlige sende-/linjeskiftvalg. Shift+TAB og TAB uten et tilgjengelig forslag beholder vanlig fokusvandring. Det sendes ikke forslagskall under IME-skriving eller mens tråden arbeider.

Forslag vises når markøren står i slutten av utkastet, ved 3–4000 tegn. Forslagene er korte og valgfrie; modellen kan også la være å foreslå noe. Hvis du trenger et helt svar eller en handling, send meldingen som vanlig.

## Kontekst og modellkall

Forslagsmodellen får et avgrenset utdrag av tidligere bruker-/assistenttekst i den aktuelle tråden. I Kode kan den også få et utdrag av den faktisk åpne tekstfilen i Filer-panelet i samme prosjekt og tråd. Gamle filvalg i en annen tråd, nylig-fil-historikk, binærfiler, ufullstendige filvisninger og beskyttede `.env`-filer brukes ikke som åpen fil. Ingen prosjektgjennomsøking eller automatisk innlasting av minner og systeminstruksfiler gjøres.

Dette er egne modellkall til den valgte leverandøren. Egen forslagsmodell mottar derfor samtaleutdraget selv om en annen modell brukes til vanlige svar. Forslagskall kan bruke API-kvote; samtalens eksisterende tokenmåler teller foreløpig samtaleturene, ikke disse sidekallene. Leverandørens oversikt er kilden for samlet fakturert bruk.

Forslagskall har ingen verktøy, nettsøk eller bilder, kan ikke utføre handlinger og blir ikke lagt inn som meldinger i historikken. Bare godkjent tekst legges i utkastet. Det brukes omtrent 650 ms skrivepause, maks to samtidige forespørsler, 8 sekunders tidsgrense og et lite utbudsjett. Ny tekst, fokus-/tråd-/modellbytte eller å slå av funksjonen avbryter ventende forslag. Sene svar kan ikke erstatte nyere tekst. Demomodellen gir enkle lokale eksempelforslag; ekte modellkvalitet avhenger av valgt modell.

## Menyer

TAB i `/`- og `$`-menyer fullfører navnet som tekst; den utfører ikke kommandoen og sender ikke meldingen. Enter og klikk beholder menyens vanlige handling. `@`-menyen legger til valgt fil-/mappe-/trådvedlegg og støtter søk med filstier. Menyen viser tastaturhjelp og beholder IME og vanlig fokusvandring.
