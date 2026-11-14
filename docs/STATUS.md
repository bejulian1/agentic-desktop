# Status

## 0.24.1

**v0.24.1 (bygg 68):** glassbryteren er nå ett uskarpt, dempet lag over hele bakgrunnen bak samtalen («Uskarp glassbakgrunn»). Modellsvar og tenkeutdrag har ingen egne flater eller omriss. Samtalen går gradvis over i uskarphet mot meldingsfeltet. Meldingsfelt og brukermeldinger er halvgjennomsiktige og mørke med tynt omriss, uten grønn fokuskant. Kontrollert i mørk modus med Nordlys i Chat; typesjekk og UI-testen for bakgrunn (75) går gjennom.

## 0.24.0

**v0.24.0 (bygg 67):** eget globalt bakgrunnsbilde under Utseende, med opplasting, bytte, fjerning, bildestyrke og uskarphet. Bildet brukes på tvers av Chat, Kode og innstillinger og beholdes ved omstart. Lokale bakgrunnsfiler er adskilt fra meldingsvedlegg og sendes ikke til modellen. Samtaletemaer beholder eget motiv inne i samtalen.

Glassflater bak modellsvar og tenkeutdrag kan slås av eller på. Filtrene brukes bare når en bakgrunn er aktiv. Meldingsfeltet har en mørk flate i mørk modus og tydelig kant. Chat har snarveier til tema og bakgrunn på startsiden og i verktøymenyen.

**Kontroll:** 445 servertester og typekontroll består. Headless-grensesnittkontrollen dekker opplasting, innstillinger, glassbryter, Chat/Kode, gjenåpning, uavhengige samtaletemaer og temamenyen i løsrevne chatvinduer. Electron-kontroller bekrefter samtykke og at globalt bilde beholdes ved ny tom oppstart. Tre kontroller av den ferdige pakken bekrefter oppstart/stopp, bakgrunn, glass, temaer og dokument/Python-funksjoner med pakkens egne biblioteker. Alle kontroller bruker midlertidige data og lokale modeller. Dette er ikke en full ytelsessammenligning med forrige versjon.

Se [Tema, bakgrunn og mods](UI-MODS.md) og [versjonslogg](PATCHLOG.md).

Se [full versjonslogg](PATCHLOG.md) for tidligere versjoner.
