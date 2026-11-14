# Prosjekter i Chat

Et Chat-prosjekt samler samtaler uten en kode- eller prosjektmappe. Klikk på prosjektnavnet i sidefanen for å åpne prosjektsiden. Meldingsfeltet står øverst; prosjektets samtaler ligger under. Første sending oppretter og åpner en samtale i prosjektet. Pilen ved navnet folder bare listen i sidefanen sammen eller ut.

## Tilpass prosjektet

Velg **Rediger prosjekt** på prosjektsiden eller i prosjektmenyen. Du kan endre navn, velge mellom 15 ikoner og åtte ikonfarger, og skrive opptil 10 000 ord med egne instruksjoner (maks 200 000 tegn). Prosjektinstruksjonene brukes i alle prosjektets nye svar, sammen med appens grunnregler og faktiske Chat-funksjoner.

Den globale Chat-systeminstruksen, Om deg, tone og personlighet brukes ikke inne i prosjektet. Kode-harness, AGENTS.md, Kode-minner og globale/prosjektbaserte skills injiseres heller ikke. Modell- og datokontekst følger appens valg; global posisjonsinformasjon holdes utenfor.

Dette er en avgrensning av modellkonteksten, ikke en OS-sandkasse. Meldinger og vedlegg som du legger i samtalen, inngår fortsatt. Prosjektet får ikke Kode-verktøy.

## Minnevalg

- **Egne prosjektminner** er standard. De leses og oppdateres bare i dette prosjektet.
- **Del globale Chat-minner** bruker den samme minnelisten som vanlig Chat og andre prosjekter som har valgt dette. Redigering eller sletting gjelder alle disse. Global personalisering og Kode-minner følger fortsatt ikke med.
- **La modellen lagre nye minner** gjelder prosjektet og valgt minnetype. Det er av som standard. Manuell redigering er tilgjengelig uansett. Samtalens minnebryter kan slå bruken av, og midlertidige chatter bruker eller lagrer ikke minner.

Bytte av minnetype sletter ikke egne prosjektminner. Lagre byttet før du administrerer den nye listen. Du kan legge til, endre og slette minner i prosjekteditoren. Hvert minne har en grense på 300 tegn. Nøkler, token og passord avvises.

## Samtaler og flytting

Prosjektsiden lar deg søke i samtalene, åpne dem, gi nytt navn og slette dem. Arkiverte samtaler har en egen visning. Sidefanen har prosjektets samtaler og vanlige trådmenyer.

Når du flytter en samtale mellom prosjekter eller ut av et prosjekt, beholdes den synlige samtalen. Tidligere synlige meldinger kan derfor inneholde opplysninger fra den gamle konteksten. Skjulte komprimeringssammendrag og intern modelltilstand gjenbrukes ikke over denne grensen. Vedleggsreferanser som fortsatt finnes, beholdes.

Appen avviser flytting og endring av prosjektets instruksjoner/minnetype mens berørte svar eller kømeldinger pågår. En gammel prosjekteditor kan ikke overskrive nyere endringer fra et annet vindu uten beskjed. Utkastet blir stående ved feil.

Forgrening og sidechat beholder prosjektet. Fjerner du prosjektet, beholdes samtalene som vanlig Chat; prosjektets egne instruksjoner og minner slettes. Globale Chat-minner beholdes. Sletting av en enkelt chat er permanent etter bekreftelse.

## Utkast og gjenåpning

Vanlig Chat, hvert prosjekt og hver åpnet samtale har separate utkast i appens minne. Tekst og vedlegg følger riktig samtale også om du skriver mer mens første sending venter. Utkast overlever ikke full omlasting eller avslutning. Oppfriskning kan gjenåpne prosjektsiden; ny appstart følger fortsatt oppstartsvalget under Generelt.

## Modellinformasjon

I både Chat og Kode vises modellbytter som en liten linje i samtalen. Ikonet under et ferdig svar viser faktisk modell og leverandør ved hover eller klikk. Informasjonen tas fra kjøringen som skrev svaret og bevares selv om modellen senere endres eller fjernes. Bytter du under et aktivt svar, gjelder valget neste kjøring og linjen vises etter at det aktive svaret er ferdig. Eldre logger kan mangle denne informasjonen.
