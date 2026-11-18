# Status

## 0.29.1

**v0.29.1 (bygg 79):** første utgivelse i 0.29-serien. Kode uten prosjekt («Denne datamaskinen») gir agenten fil-, søke- og kommandoverktøy med hjemmemappen som arbeidsmappe, med de vanlige godkjenningene, «Tillat alltid» lagret i appen og angring av turer. Stedene der nøkler, innlogginger og nettleserprofiler ligger under hjemmemappen spør alltid og utelates fra søk. Samme utgivelse inneholder koden fra PR #2: lesestatus under Kode-meldinger, toveis kommunikasjon med underagenter, bevart foreldrekjede, styring før ustartede verktøykall og snarveiene `/agents`, `/diff`, `/context` og `/stop`. PR-koden lå ucommittet i arbeidsmappen og kom inn i `main` sammen med Denne datamaskinen (commit `a1d2bf3`, tagget `v0.29.0`, ikke gitt ut). 542 servertester, 317 UI-forløp og typekontroll består. Ikke prøvd mot ekte modeller. Kjent: kommandosperren er en tekstsjekk, ikke en sandkasse; hjelpetråder, oppgavelisten og appens nettleser krever et prosjekt.

## 0.28.0

**v0.28.0 (bygg 77):** /btw kjører et avgrenset, verktøyfritt provider-kall uten Runner-tur eller historikkskriving. Panelet lever bare i det monterte meldingsfeltet og forkastes ved kontekstbytte, tilbakestilling og brutt tilkobling. /background oppretter en egen samtale med kontekst, modell, verktøyvalg og effektiv tillatelsesgrense fra kilden; fokus og aktiv kildekjøring beholdes. /queue og /steer gjenbruker køens levering med en engangsoverstyring. Se [bruk og grenser](SIDE-QUESTIONS.md).

Kontroll: typekontroll av server/web/Electron, alle 525 servertester og 24 berørte UI-forløp består. Ti nye serverforløp dekker samtidig hovedkjøring, ingen historikk-/minneskriving, avvist verktøykall, grenser, tilbakestilling og arvede rettigheter; syv nye UI-forløp dekker også utkast, feil og reconnect. Tre kontroller av ferdigpakket Electron-app og sammenligning av AppImage/deb med testet runtime består. Uavhengig kodegjennomgang er fulgt opp. Ingen ekte API-nøkler eller betalte modellkall er brukt. Ekte leverandørmodeller og full ytelsesparitet mot forrige produksjon er ikke målt.

## 0.27.2

**v0.27.2 (bygg 76):** de innebygde lagene i systemprompten (Grunn-harness, Chat-grunn, Skills, Tema og mods, MCP-verktøy) kan erstattes med brukerens egen tekst i Forhåndsvisning under Konfigurasjon, per modus og variant (Kode med prosjekt, Kode uten prosjekt, Chat). Levende deler er plassholdere som fylles inn for hver tråd. Hvert lag og hele modusen kan tilbakestilles. Tekstene lagres i `harness.json` og brukes av både forhåndsvisningen og ekte turer. 515 servertester, et nytt UI-forløp og typekontroll består.

## 0.27.1

**v0.27.1 (bygg 75):** harness 16.2. Hvert verktøy har et påkrevd felt (`Tool.can`) med hva det lar agenten gjøre, og agentens selvbilde bygges ved kjøring fra verktøyene tråden faktisk tilbys. Grunnprompten for Kode og Chat har en kort del om appen og agenten, slik at modellen kan presentere seg og sine muligheter i vanlige ord, også i Kode uten prosjekt (der den tidligere bare nevnte `ui_mod`). En lagret global `AGENTS.md` eller Chat-instruks som er bytelik en tidligere levert standard, følger nå appen til den nye standarden ved oppstart, med sikkerhetskopi; egne tekster beholdes. 513 servertester og typekontroll består. Ikke prøvd mot ekte modeller.

## 0.27.0

**v0.27.0 (bygg 73):** fire innebygde fil-skills i Chat og Kode. Chat har behovsstyrt `use_skill`, menyvalg og støtte i Chat-prosjekter med beholdt instruksjonsgrense. Verktøybrytere bestemmer fortsatt faktisk dokument-/Python-tilgang. Harness 16.1, totalt 19 skills. Kontroll: 510 servertester, typekontroll av server/web/Electron og syv berørte UI-forløp består med midlertidige data og lokale falske modeller. Ny kontroll dekker faktisk skill-innlasting fulgt av en ekte Excel-fil med to ark, typedata og formelcache, instruksjonsgrenser i Chat-prosjekter, av/på-brytere, navneoverstyring per modus og menyvalg som brikke. Fire kontroller av den ferdige pakken under virtuell skjerm består, inkludert ekte skill-innlasting, Office-nedlasting, Python og oppstart/stopp. 30 berørte servertester er kjørt på nytt etter siste moduskorrigering. Skill-instruksjonenes effekt på ekte modellsvar er ikke målt.

## 0.26.0

**v0.26.0 (bygg 72):** harness 16 for Kode og Chat. Grunnprompten for Kode er skrevet om rundt arbeidsmåten (undersøk, følg prosjektet, endre, kontroller, rapporter), med nye faste regler om andres endringer, destruktive kommandoer og utviklingsservere. Femten innebygde skills følger med i `skills/` og lastes når oppgaven tydelig passer; skills kan merkes `mode: code` eller `mode: chat`. Chat har åtte personligheter og fire stilvalg (mindre, standard, mer), og en egen grunnprompt om svarkvalitet. Standardinstruksene for Kode og Chat er korte og inneholder bare brukerens egne valg. Tolv verktøybeskrivelser sier når verktøyet skal brukes.

Kontroll: typekontroll av server/web/Electron og 505 servertester består. Hele UI-suiten gir 300 av 304 under full belastning; de fire som feilet, består når de kjøres alene (tre uten endring, én etter at en utdatert forventning ble oppdatert). De 25 UI-forløpene som feilet mot v0.24.3 er gjennomgått: 23 var utdaterte etter tidligere redesign og er oppdatert, to viste ekte feil som er rettet (Filer-panelet åpnet en slettet fil, og tastaturfokus forsvant når en trådmeny ble lukket). En uavhengig gjennomgang av harnessen, skillene og personlighetene er fulgt opp. Personlighetsvalget er prøvd i en isolert instans og bekreftet i forhåndsvisningen av systemprompten.

Kjente mangler: effekten av den nye harnessen er ikke målt mot ekte modeller. Lagrede kopier av `AGENTS.md` og Chat-instruksen byttes ikke automatisk; brukeren må velge Gjenopprett standard. Den felles oppgaveblokken i Chat inneholder fortsatt noen Kode-begreper. Skills i Chat (for eksempel for dokumenter) finnes ikke ennå.

## 0.25.0

**v0.25.0 (bygg 71):** MCP-servere og hooks er ekte funksjoner i Innstillinger, ikke lenger Demo. MCP har egen klient uten nye avhengigheter (stdio og Streamable HTTP, protokoll 2025-11-25 og eldre), utgangspunkt for GitHub og Playwright, hemmeligheter i nøkkelringen, godkjenning som for kommandoer, stabile kortnavn per server og høyst 60 MCP-verktøy per tur. Hooks kjører egne kommandoer før og etter verktøykall, når en melding sendes og når en tur er ferdig, med samme kontrakt som Claude Code; en melding som ikke har kommet gjennom en hook, regnes som ikke sendt. «Glass over bakgrunner» har tre valg: hele bakgrunnen uskarp, flater bak svar, eller ingen uskarphet eller flater. Versjonsloggen åpnes også fra Innstillinger og Om.

Kontroll: typekontroll av server/web/Electron og 501 servertester består. Nye UI-forløp for MCP (3) og hooks (2) består, sammen med de tilpassede forløpene for `/mcp`, navigasjon, bakgrunn og versjonslogg. MCP er prøvd mot den ekte Playwright-serveren i en isolert instans (25 verktøy, godkjenning, ett kall, og prosessene ryddet bort ved avslutning). GitHub-serveren er ikke prøvd mot GitHub, fordi det krever et token. En uavhengig kodegjennomgang fant ti forhold i MCP og åtte i hooks; alle er rettet og dekket av tester, bortsett fra hemmeligheter i selve adressen, som i stedet har en advarsel i skjemaet og dokumentasjonen.

Kjente mangler: hele UI-suiten gir 278 av 304. De 25 forløpene som feiler (sidepanel, terminal, nettleserpanel, sidefane og Chat-prosjektdialog) feiler likt mot v0.24.3 og er ikke rettet i denne versjonen; ett forløp til feilet bare under full belastning og består alene. Servere som bare snakker MCP 2026-07-28, OAuth og det gamle HTTP+SSE-transportet støttes ikke. Beskyttelsen av datamappen mot modellens kommandoer er en tekstsjekk, ikke en sandkasse. README-skjermbildene viser ikke de nye sidene.

## 0.24.3

**v0.24.3 (bygg 70):** prosjektlinjen over meldingsfeltet følger samme glasstone som feltet. Den gamle grå flaten og brede overlappen er fjernet over bakgrunner. Tynn skjøt, eksisterende knapper og vanlig visning uten bakgrunn beholdes.

To isolerte UI-forløp bekrefter overgangen, prosjektvelger, bevart utkast, smalt vindu og avgrensningen av glassbakgrunnen i Chat/Kode. Ingen serveratferd er endret.

Se [full versjonslogg](PATCHLOG.md) for tidligere versjoner.
