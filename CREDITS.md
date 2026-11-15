# Bidragsytere og AI-assistanse

Agentic Desktop eies og vedlikeholdes av [bejulian1](https://github.com/bejulian1), som bestemmer retning, funksjoner, designreferanser og publisering, og tester appen på egen maskin.

## Modeller brukt i utviklingen

Prosjekteieren krediterer disse modellene for AI-assistanse i utviklingen:

| Leverandør | Modell |
|---|---|
| Anthropic | Claude Opus 5.5 |
| OpenAI | GPT 6.1 Sol |
| Anthropic | Claude Fable 5.2 |

## Claude Code – Anthropic

Prosjektets opprinnelige implementering frem til v0.11.0 ble laget med Claude Code og Claude Opus 5.5. Den opprinnelige v0.11.0-commiten inneholder allerede en `Co-Authored-By`-kreditering til Claude. Denne historikken beholdes.

Fra v0.24.1 er Claude Code brukt igjen, med **Claude Fable 5.2** som koordinerende modell:

- **v0.24.1:** glassbakgrunnen bak hele samtalen, gradvis uskarphet mot meldingsfeltet og halvgjennomsiktig meldingsfelt og brukermeldinger.
- **v0.25.0:** MCP-servere og hooks. Fable 5.2 la opp designet og grensene, to **Claude Opus 5.5**-underagenter skrev hver sin del, og to nye Opus 5.5-underagenter sto for uavhengig kodegjennomgang og UI-tester. Fable 5.2 gikk gjennom resultatet, prøvde funksjonene i appen (blant annet mot den ekte Playwright MCP-serveren), laget valget mellom glass-stiler og sto for bygg, utgivelse og installasjon.

Commits fra dette arbeidet har en `Co-Authored-By`-linje til Claude.

## Codex – OpenAI

Videreutviklingen fra v0.11.0 til v0.24.0, samt v0.24.2 og v0.24.3, er gjort med Codex, blant annet med GPT 6.1 Sol og underagenter: Chat-/Kode-flyt, harness og kontekst, skills, meldingsfelt, sidepanel, annotering, Git-grener/arbeidstrær, gjennomgang og feilrettinger. Codex har også hjulpet med dokumentasjon, skjermbilder, bygg og publisering til GitHub.

## Om GitHubs Contributors-graf

README og denne filen krediterer modellene og AI-verktøyene som prosjekteieren oppgir. GitHubs graf beregnes fra commit-historikk og e-postadresser som GitHub kan knytte til kontoer; en tekstoppføring her registrerer ikke en konto i grafen. Eksisterende historikk er ikke omskrevet for å endre statistikken. Nye Codex- og Claude-assisterte commits kan ha en tydelig `Co-authored-by`-linje.

Verktøyene oppføres som AI-assistanse, ikke som mennesker, prosjekteiere eller garantister. Krediteringen innebærer ingen offisiell støtte eller tilknytning til Anthropic eller OpenAI. Lisensvilkår endres ikke av denne filen.
