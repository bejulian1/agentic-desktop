# Bidragsytere og AI-assistanse

Agentic Desktop eies og vedlikeholdes av [bejulian1](https://github.com/bejulian1), som bestemmer retning, funksjoner, designreferanser og publisering, og tester appen på egen maskin.

## Modeller brukt i utviklingen

Prosjekteieren krediterer disse modellene for AI-assistanse i utviklingen:

| Leverandør | Modell |
|---|---|
| Anthropic | Claude Opus 5.5 |
| OpenAI | GPT 6.1 Sol |
| OpenAI | GPT 6.2 Sol og GPT 6.2 Astra |
| Anthropic | Claude Fable 5.2 |

## Claude Code – Anthropic

Prosjektets opprinnelige implementering frem til v0.11.0 ble laget med Claude Code og Claude Opus 5.5. Den opprinnelige v0.11.0-commiten inneholder allerede en `Co-Authored-By`-kreditering til Claude. Denne historikken beholdes.

Fra v0.24.1 er Claude Code brukt igjen, med **Claude Fable 5.2** som koordinerende modell:

- **v0.24.1:** glassbakgrunnen bak hele samtalen, gradvis uskarphet mot meldingsfeltet og halvgjennomsiktig meldingsfelt og brukermeldinger.
- **v0.25.0:** MCP-servere og hooks. Fable 5.2 la opp designet og grensene, to **Claude Opus 5.5**-underagenter skrev hver sin del, og to nye Opus 5.5-underagenter sto for uavhengig kodegjennomgang og UI-tester. Fable 5.2 gikk gjennom resultatet, prøvde funksjonene i appen (blant annet mot den ekte Playwright MCP-serveren), laget valget mellom glass-stiler og sto for bygg, utgivelse og installasjon.
- **v0.26.0:** ny harness for Kode og Chat (grunnprompt, verktøybeskrivelser og standardinstrukser), 15 innebygde skills, og åtte personligheter med stilvalg i Chat, skrevet av Fable 5.2. Tre **Claude Opus 5.5**-underagenter sto for en uavhengig, kritisk gjennomgang av harnessen, opprydding i 25 utdaterte UI-tester med to feilrettinger i appen, og nye skjermbilder.

Commits fra dette arbeidet har en `Co-Authored-By`-linje til Claude.

## Codex – OpenAI

GPT 6.2 Astra implementerte diktering med valgt taleleverandør og planlagte Chat- og Kode-tråder, og fjernet uvirksomme betjeningselementer.

Videreutviklingen fra v0.11.0 til v0.24.0, samt v0.24.2 og v0.24.3, er gjort med Codex, blant annet med GPT 6.1 Sol og underagenter: Chat-/Kode-flyt, harness og kontekst, skills, meldingsfelt, sidepanel, annotering, Git-grener/arbeidstrær, gjennomgang og feilrettinger. Codex har også hjulpet med dokumentasjon, skjermbilder, bygg og publisering til GitHub.

Codex med GPT 6.2 Sol samlet slash-kommandoene i en søkbar guide og integrerte dem i Chat og Kode. GPT 6.2 Astra-underagenter implementerte samtale- og prosjektkommandoer og gjennomgikk tastaturbruk, rutevalg og samtidige endringer.

**v0.27.0:** Codex koblet skills til Chat og bevarte prosjektgrenser og verktøyvalg. En GPT 6.1 Sol-agent utformet fire fil-skills for Excel, Word, PowerPoint og tekst/data og gjennomgikk integrasjonen. Lokale falske modeller brukes i kontrollene; skillenes effekt på ekte modellsvar er ikke målt.

Codex skrev fem skills for kildearbeid, oppfølging fra notater, dataanalyse, ytelsesmåling og CI-diagnose. GPT 6.2 Sol og GPT 6.2 Astra vurderte dagens katalog og prøvde skillene på oppgaver med blant annet manglende data og avbrutte kjøringer.

**v0.28.0:** Codex implementerte midlertidige sidespørsmål, parallelle bakgrunnsøkter og eksplisitt kø/styring. Separate agenter bidro med grensesnitt, isolerte ende-til-ende-tester og uavhengig gjennomgang av kontekstgrenser, historikk og tillatelser.

**v0.29.0:** Codex implementerte lesestatus og kommandosnarveier. GPT 6.1 Sol-underagenter undersøkte og rettet agentkommunikasjon, tenkeinnsats og foreldrekjeder, skrev isolerte regresjonstester og gjennomgikk køgrenser og stoppatferd. Claude Fable 5.2 la til arbeid på «Denne datamaskinen» uten valgt prosjekt, med beskyttelse av nøkler og innlogginger i hjemmemappen.

Codex implementerte stolpe- og linjediagrammer i chatmeldinger og kontrollerte strømming og gjenåpning av samtaler med en lokal testmodell.

For leverandørkatalogen undersøkte en GPT 6.2 Sol-underagent leverandørenes dokumentasjon og skrev katalogoppføringene. En GPT 6.2 Astra-underagent bygde det søkbare grensesnittet og tilkoblingsflyten. Codex integrerte og kontrollerte adapterne og migreringen av eksisterende oppsett.

For lokale modellservere bidro GPT 6.2 Sol med serverprofiler, oppdagelse av modeller, maskinvarebaserte anbefalinger, oppsett i Innstillinger og integrasjon med den eksisterende agentkjøringen. Codex samlet disse funksjonene i katalogflyten og la til isolerte tester.

## Gemini – Google

Gemini bidro med den første implementeringen av reservasjon av datamappen, gjenkobling etter omskriving og åpning i standardnettleseren. Codex med GPT 6.2 Sol gjennomgikk og integrerte endringene, rettet oppstarts- og gjenkoblingskappløp og la til regresjonstester.

## Om GitHubs Contributors-graf

README og denne filen krediterer modellene og AI-verktøyene som prosjekteieren oppgir. GitHubs graf beregnes fra commit-historikk og e-postadresser som GitHub kan knytte til kontoer; en tekstoppføring her registrerer ikke en konto i grafen. Eksisterende historikk er ikke omskrevet for å endre statistikken. Nye Codex- og Claude-assisterte commits kan ha en tydelig `Co-authored-by`-linje.

Verktøyene oppføres som AI-assistanse, ikke som mennesker, prosjekteiere eller garantister. Krediteringen innebærer ingen offisiell støtte eller tilknytning til Anthropic, OpenAI eller Google. Lisensvilkår endres ikke av denne filen.
