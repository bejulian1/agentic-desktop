# Velkomst og import av samtaler

Velkomstskjermen vises når du åpner Agentic Desktop uten leverandør eller tråder for første gang. Velg språk og standardmodell, eller velg **Start** for å gå videre. **Hopp over** lar deg gå rett til appen. Du kan åpne skjermen igjen fra **Innstillinger → Generelt → Velkomstskjerm**.

## Velg en modell

Velg **Prøv uten API-nøkkel** for å bruke den innebygde demo-modellen uten nettverk. Med **Finn lokale servere** kan du sjekke standardadressene for Ollama, LM Studio, llama.cpp og vLLM. Velg **Legg til leverandør** for å åpne den samme katalogen som under **Modeller og leverandører**. Der kan du velge en tjeneste eller oppgi adressen til en egen server. API-nøkler lagres i systemets nøkkelring når den er tilgjengelig. [Modellleverandører i Agentic Desktop](PROVIDERS.md)

## Hent prosjekter og tråder

1. Velg **Søk etter samtaler** på velkomstskjermen. Du kan også gå rett til **Innstillinger → Generelt → Importer fra andre kodeapper**.
2. Åpne **Se alle** for å se mappe, kilde, tråder og siste aktivitet for hvert prosjekt. Velg prosjektene og trådene du vil hente. Velg bort alle hvis du vil starte uten import.
3. Start importen. Oversikten viser hvor mange prosjekter appen opprettet eller gjenbrukte, hvor mange tråder den hentet eller hoppet over, og hvor mange problemer den fant.

De importerte trådene ligger under **Kode** i de eksisterende prosjektmappene. Åpne en tråd for å se kilden og importdatoen, lese de opprinnelige tekstmeldingene og fortsette med en modell du velger. Verktøykall og resultater vises som korte tekstnotater. Bilder, vedlegg og internt modellinnhold fra kildeappene følger ikke med. Når du sender en ny melding i en importert tråd, kan den valgte modellen få den importerte historikken som samtalekontekst.

## Hva søket finner

| Kilde | Standardplassering under hjemmemappen |
| --- | --- |
| Claude Code | `~/.claude/projects/` |
| Codex CLI | `~/.codex/sessions/` |
| Gemini CLI | `~/.gemini/tmp/` med `.project_root` og økter i `chats/` |
| Pi | `~/.pi/agent/sessions/` |

Søket leser lokale filer først når du ber om det. Kildene beholdes som de var, og søk og import foregår på maskinen. Søket følger ingen symlenker i kildemappene. Det hopper over økter der prosjektmappen mangler eller ikke kan brukes. For Gemini CLI må prosjektmarkøren angi mappen, og Pi importerer den aktive grenen slik den er lagret i økten.

Søket leser inntil 160 filer og 32 MiB per kilde. Hver fil kan være opptil 8 MiB og hver JSONL-fil kan ha opptil 50 000 linjer. Søkeresultatet viser når appen hopper over en fil eller når en grense er nådd. Du kan søke igjen hvis en mappe er på plass eller historikken har endret seg. En tråd som allerede er importert, merkes i oversikten og hoppes over ved ny import.
