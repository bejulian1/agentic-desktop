# Status

## 0.25.0

**v0.25.0 (bygg 71):** MCP-servere og hooks er ekte funksjoner i Innstillinger, ikke lenger Demo. MCP har egen klient uten nye avhengigheter (stdio og Streamable HTTP, protokoll 2025-11-25 og eldre), utgangspunkt for GitHub og Playwright, hemmeligheter i nøkkelringen, godkjenning som for kommandoer, stabile kortnavn per server og høyst 60 MCP-verktøy per tur. Hooks kjører egne kommandoer før og etter verktøykall, når en melding sendes og når en tur er ferdig, med samme kontrakt som Claude Code; en melding som ikke har kommet gjennom en hook, regnes som ikke sendt. «Glass over bakgrunner» har tre valg: hele bakgrunnen uskarp, flater bak svar, eller ingen uskarphet eller flater. Versjonsloggen åpnes også fra Innstillinger og Om.

Kontroll: typekontroll av server/web/Electron og 501 servertester består. Nye UI-forløp for MCP (3) og hooks (2) består, sammen med de tilpassede forløpene for `/mcp`, navigasjon, bakgrunn og versjonslogg. MCP er prøvd mot den ekte Playwright-serveren i en isolert instans (25 verktøy, godkjenning, ett kall, og prosessene ryddet bort ved avslutning). GitHub-serveren er ikke prøvd mot GitHub, fordi det krever et token. En uavhengig kodegjennomgang fant ti forhold i MCP og åtte i hooks; alle er rettet og dekket av tester, bortsett fra hemmeligheter i selve adressen, som i stedet har en advarsel i skjemaet og dokumentasjonen.

Kjente mangler: hele UI-suiten gir 278 av 304. De 25 forløpene som feiler (sidepanel, terminal, nettleserpanel, sidefane og Chat-prosjektdialog) feiler likt mot v0.24.3 og er ikke rettet i denne versjonen; ett forløp til feilet bare under full belastning og består alene. Servere som bare snakker MCP 2026-07-28, OAuth og det gamle HTTP+SSE-transportet støttes ikke. Beskyttelsen av datamappen mot modellens kommandoer er en tekstsjekk, ikke en sandkasse. README-skjermbildene viser ikke de nye sidene.

## 0.24.3

**v0.24.3 (bygg 70):** prosjektlinjen over meldingsfeltet følger samme glasstone som feltet. Den gamle grå flaten og brede overlappen er fjernet over bakgrunner. Tynn skjøt, eksisterende knapper og vanlig visning uten bakgrunn beholdes.

To isolerte UI-forløp bekrefter overgangen, prosjektvelger, bevart utkast, smalt vindu og avgrensningen av glassbakgrunnen i Chat/Kode. Ingen serveratferd er endret.

Se [full versjonslogg](PATCHLOG.md) for tidligere versjoner.
