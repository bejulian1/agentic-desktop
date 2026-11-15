# Leverandøruavhengige standardinstruksjoner

`code.md` og `chat.md` er de leverte, redigerbare standardene i Agentic Desktop. De er en kraftig forkortet tilpasning av referansefilen «System melding CAgentic desktop.md», som brukeren ba om å få tilpasset. Originalen er bare lest og er ikke endret eller kopiert inn i prosjektet.

Fra harness-versjon 16 ligger arbeidsmåten for Kode (undersøk, følg prosjektet, endre, kontroller, rapporter) i den innebygde grunn-harnessen. `code.md` er derfor kort og inneholder bare brukerens egne valg: svarstil, hva det skal spørres om først, og plass til egne preferanser. Slik sies ikke det samme to ganger på to språk.

Vi beholdt prinsippene om å forstå oppdraget, bruke tilgjengelige verktøy, respektere tillatelser, gjøre nødvendig arbeid ferdig og rapportere kontroller ærlig. Språket og arbeidsmåten er tilpasset appens faktiske Chat- og Kode-modus.

Vi utelot leverandør- og modellidentitet, innebygde verktøyskjemaer, Claude-spesifikke kommandoer, skyfunksjoner, MCP-koblinger som appen ikke tilbyr, personopplysninger, maskinstier, øktdata, minnekataloger og oppdiktede tokenbudsjetter. Referansens beskjed om at brukeren ikke kan svare underveis er heller ikke overtatt. Agentic Desktop støtter avklaringer og godkjenning.

Disse filene definerer ikke appens verktøy eller rettigheter. Den innebygde grunn-harnessen og det aktuelle miljølaget beskriver faktisk modus, prosjekt, valgt modell, verktøy og tillatelser. Instruksjonene må ikke love tilgang bare fordi et panel finnes. Tilgjengeligheten håndheves av kjøretiden, ikke av teksten alene.

- `code.md` blir den globale `AGENTS.md` ved første oppstart hvis den ikke finnes. Eksisterende brukerfiler bevares. «Gjenopprett standard» viser forskjellen og tar sikkerhetskopi før en egen fil erstattes.
- `chat.md` fyller standardfeltet for Chats systeminstruks. Brukeren kan redigere eller tømme det. Egne lagrede instrukser bevares, og en uttrykkelig gjenoppretting henter denne teksten. Chat-teksten må være under 1500 tegn.
- `server/src/agent/harness.ts` leser filene fra `docs/system-instructions` under `REPO_ROOT`. `scripts/dist.ts` kopierer samme mappe til den pakkede appens `resources/app-root/docs`, slik at utviklingskjøring og installert app bruker samme kilde.

Endringer i disse filene oppdaterer den leverte standarden. De overskriver ikke brukerens lagrede kopier. Ingen systemtekst garanterer lik oppførsel fra alle modeller; sjekk både prompten appen sender og modellens faktiske resultater.
