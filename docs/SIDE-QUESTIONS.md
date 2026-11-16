# Sidespørsmål og bakgrunnsøkter

Disse kommandoene finnes i både Chat og Kode. Skriv kommandoen og teksten i det vanlige meldingsfeltet.

| Kommando | Hva skjer? |
|---|---|
| `/btw Hva betyr dette?` | Et kort sidesvar vises over meldingsfeltet. Hovedoppgaven fortsetter. |
| `/background Undersøk dette alternativet` | En egen samtale starter i bakgrunnen. Åpne kortet når du vil følge den. |
| `/queue Kontroller resultatet etterpå` | Meldingen venter til den aktive turen er ferdig. |
| `/steer Bruk den eksisterende komponenten` | Korrigeringen tas inn ved neste steg i den aktive turen. |

`/bakgrunn`, `/kø` og `/styr` er norske aliaser. Kø og styring overstyrer bare leveringsvalget for den ene meldingen. Uten aktiv tur sendes teksten som en vanlig melding. Et verktøy som allerede kjører, stoppes ikke av `/steer`.

## Et midlertidig sidesvar

`/btw` bruker den valgte modellen og et avgrenset tekstutdrag av samtalen ved sending. Modellen får ingen verktøy, nettleser eller filtilgang og kan ikke utføre handlinger. Den får ikke nye vedlegg eller hele innholdet i bilder og prosjektfiler. Be den ordinære samtalen om oppgaver som krever slike verktøy.

Spørsmålet og svaret legges ikke i hovedsamtalens meldinger, kjøringslogg eller minner. Panelet ligger bare i minnet i det åpne meldingsfeltet. Lukk det for å fjerne det. Avbryt-knappen stopper bare sidespørsmålet; hovedoppgaven fortsetter. Bytte av samtale, modell eller prosjektkontekst, tilbakestilling, sletting og brutt tilkobling forkaster panelet. Det gjenopprettes ikke ved omstart eller ny tilkobling.

Svaret er vanlig tekst. Det inneholder ingen knapper som kjører kode eller oppretter filer. Ved feil beholdes eller gjenopprettes kommandoutkastet når du ikke har skrevet noe nyere. Sidespørsmål bruker leverandørens API og kan koste tokens. De oppretter ingen vanlig tur i appens brukslogg.

Det må finnes en åpen samtale først. Maks to sidespørsmål kan kjøre samtidig per samtale, og åtte totalt. Et sidespørsmål har en tidsgrense på ett minutt og et kort svarbudsjett.

## En egen bakgrunnssamtale

`/background` lager en vanlig, lagret samtale med et tekstbasert øyeblikksbilde av kilden. Den får valgt modell, prosjekt, midlertidig Chat-status, Chat-verktøyvalg og planmodus fra kilden. I Kode følger den kildens effektive tillatelsesgrense; kommandoen gir ingen ekstra rettigheter. Den kan bruke de verktøyene som faktisk er tillatt, med vanlige godkjenninger.

Bakgrunnssamtalen er selvstendig etter opprettelsen. Den følger ikke senere rettelser eller nye meldinger fra kilden. Svarene legges i bakgrunnssamtalen, ikke automatisk i hovedsamtalen. Klikk kortet eller åpne den fra historikken for å lese videre, svare eller stoppe den. Opptil fire slike bakgrunnsøkter kan jobbe samtidig.

I samme Kode-prosjekt deler samtalene prosjektfiler. Gi avgrensede oppgaver hvis flere agenter skal endre filer samtidig. `/fork` beholder sin eksisterende oppførsel; `/background` starter oppgaven umiddelbart og lar deg fortsette der du var.

Nye vedlegg støttes ikke med `/btw` eller `/background`; send dem som en vanlig melding først. `/queue` og `/steer` støtter vanlige vedlegg.
