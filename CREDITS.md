# Bidragsytere og AI-assistanse

Agentic Desktop eies og vedlikeholdes av [bejulian1](https://github.com/bejulian1), som bestemmer retning, funksjoner, designreferanser og publisering, og tester appen på egen maskin.

## Modeller brukt i utviklingen

Prosjekteieren krediterer disse modellene for AI-assistanse i utviklingen:

| Leverandør | Modell |
|---|---|
| Anthropic | Claude Opus 5.5 og Claude Sonnet 5.5 |
| OpenAI | GPT 6.1 Sol |
| OpenAI | GPT 6.2 Sol og GPT 6.2 Astra |
| Anthropic | Claude Fable 5.2 |
| Google | Gemini 4 Neon (koordinator i Google Antigravity for 1.2.0–1.3.1) |

## Claude Code – Anthropic

Prosjektets opprinnelige implementering frem til v0.11.0 ble laget med Claude Code og Claude Opus 5.5. Den opprinnelige v0.11.0-commiten inneholder allerede en `Co-Authored-By`-kreditering til Claude. Denne historikken beholdes.

Fra v0.24.1 er Claude Code brukt igjen, med **Claude Fable 5.2** som koordinerende modell:

- **v0.24.1:** glassbakgrunnen bak hele samtalen, gradvis uskarphet mot meldingsfeltet og halvgjennomsiktig meldingsfelt og brukermeldinger.
- **v0.25.0:** MCP-servere og hooks. Fable 5.2 la opp designet og grensene, to **Claude Opus 5.5**-underagenter skrev hver sin del, og to nye Opus 5.5-underagenter sto for uavhengig kodegjennomgang og UI-tester. Fable 5.2 gikk gjennom resultatet, prøvde funksjonene i appen (blant annet mot den ekte Playwright MCP-serveren), laget valget mellom glass-stiler og sto for bygg, utgivelse og installasjon.
- **v0.26.0:** ny harness for Kode og Chat (grunnprompt, verktøybeskrivelser og standardinstrukser), 15 innebygde skills, og åtte personligheter med stilvalg i Chat, skrevet av Fable 5.2. Tre **Claude Opus 5.5**-underagenter sto for en uavhengig, kritisk gjennomgang av harnessen, opprydding i 25 utdaterte UI-tester med to feilrettinger i appen, og nye skjermbilder.

Commits fra dette arbeidet har en `Co-Authored-By`-linje til Claude.

## Codex – OpenAI

Codex med GPT 6.2 Sol implementerte GitHub CLI-innlogging, pull request- og issue-visningene og de isolerte testene (v1.1.0), og i en egen underagent velkomstskjermen og importen av prosjekter og samtaler fra Claude Code, Codex CLI, Gemini CLI og Pi.

GPT 6.2 Astra implementerte diktering med valgt taleleverandør og planlagte Chat- og Kode-tråder, og fjernet uvirksomme betjeningselementer.

Videreutviklingen fra v0.11.0 til v0.24.0, samt v0.24.2 og v0.24.3, er gjort med Codex, blant annet med GPT 6.1 Sol og underagenter: Chat-/Kode-flyt, harness og kontekst, skills, meldingsfelt, sidepanel, annotering, Git-grener/arbeidstrær, gjennomgang og feilrettinger. Codex har også hjulpet med dokumentasjon, skjermbilder, bygg og publisering til GitHub.

Codex med GPT 6.2 Sol samlet slash-kommandoene i en søkbar guide og integrerte dem i Chat og Kode. GPT 6.2 Astra-underagenter implementerte samtale- og prosjektkommandoer og gjennomgikk tastaturbruk, rutevalg og samtidige endringer.

**v0.27.0:** Codex koblet skills til Chat og bevarte prosjektgrenser og verktøyvalg. En GPT 6.1 Sol-agent utformet fire fil-skills for Excel, Word, PowerPoint og tekst/data og gjennomgikk integrasjonen. Lokale falske modeller brukes i kontrollene; skillenes effekt på ekte modellsvar er ikke målt.

Codex skrev fem skills for kildearbeid, oppfølging fra notater, dataanalyse, ytelsesmåling og CI-diagnose. GPT 6.2 Sol og GPT 6.2 Astra vurderte dagens katalog og prøvde skillene på oppgaver med blant annet manglende data og avbrutte kjøringer.

**v0.28.0:** Codex implementerte midlertidige sidespørsmål, parallelle bakgrunnsøkter og eksplisitt kø/styring. Separate agenter bidro med grensesnitt, isolerte ende-til-ende-tester og uavhengig gjennomgang av kontekstgrenser, historikk og tillatelser.

**v0.29.0:** Codex implementerte lesestatus og kommandosnarveier. GPT 6.1 Sol-underagenter undersøkte og rettet agentkommunikasjon, tenkeinnsats og foreldrekjeder, skrev isolerte regresjonstester og gjennomgikk køgrenser og stoppatferd. Claude Fable 5.2 la til arbeid på «Denne datamaskinen» uten valgt prosjekt, med beskyttelse av nøkler og innlogginger i hjemmemappen.

Codex implementerte stolpe- og linjediagrammer i chatmeldinger og kontrollerte strømming og gjenåpning av samtaler med en lokal testmodell.

**Utviklingsgrenen `feat/ask-user`:** Codex implementerte modellverktøyet `request_user_input`/`ask_user`, spørrekort med valg og fritekst, avbrudd og svarruting til riktig kjøring, samt isolerte tester og dokumentasjon.

For leverandørkatalogen undersøkte en GPT 6.2 Sol-underagent leverandørenes dokumentasjon og skrev katalogoppføringene. En GPT 6.2 Astra-underagent bygde det søkbare grensesnittet og tilkoblingsflyten. Codex integrerte og kontrollerte adapterne og migreringen av eksisterende oppsett.

For lokale modellservere bidro GPT 6.2 Sol med serverprofiler, oppdagelse av modeller, maskinvarebaserte anbefalinger, oppsett i Innstillinger og integrasjon med den eksisterende agentkjøringen. Codex samlet disse funksjonene i katalogflyten og la til isolerte tester.

Codex implementerte modellsøk, godkjenning av leverandørbytte ved delegering og visning av tildelt modell på underagentkortene.

Codex implementerte minneforslag, oppfølging av prosjektkontroller og målrettede skill-endringer med godkjenning.

Codex med GPT 6.2 Sol implementerte trådinnboksen, automatisk ferdigstilling, utsettelsesvalgene og `/grill-me` for Chat og Kode, med isolerte server- og grensesnittester.

Codex med GPT 6.2 Sol implementerte det justerbare terminalfeltet under meldingsfeltet i Kode, med flere faner, snarvei og isolerte grensesnittester.

## Gemini – Google

Gemini bidro med den første implementeringen av reservasjon av datamappen, gjenkobling etter omskriving og åpning i standardnettleseren. Codex med GPT 6.2 Sol gjennomgikk og integrerte endringene, rettet oppstarts- og gjenkoblingskappløp og la til regresjonstester.

Fra v1.2.0 til v1.3.1 var **Gemini 4 Neon** i Google Antigravity koordinator: fordelte oppgaver til Claude-agentene, gjennomgikk og flettet PR #4, #6, #7, #8 og #9, laget v1.2.1 selv, fullførte oversettelsene og sto for kontroll, bygg, utgivelse og lokal installasjon. Se versjonsavsnittene under.

## Språk og 1.0.0

Codex (GPT 6.2 Astra) implementerte språkvalget, katalogverktøyene og de første oversatte flatene i nettgrensesnittet og Electron. Codex gjorde også meldingsfeltet, agentvisningene, sidepanelene og skallet oversettbare, integrerte endringene og testet språkbytte og responsiv layout. Claude Fable 5.2 gjorde blant annet innstillingene, Git- og GitHub-visningene oversettbare og la til `Rich` for setninger med innebygde elementer. Codex rettet senere oppdelte kildesetninger, oppdaterte de elleve katalogene og laget de engelske README-bildene.

Katalogene for de elleve språkene ble oversatt av underagenter, hvert språk lest gjennom i utvalg før fletting:

| Språk | Modell |
|---|---|
| Engelsk, svensk, dansk, japansk og forenklet kinesisk | GPT 6.2 Sol (Codex) |
| Tysk, nederlandsk, fransk, italiensk, spansk og brasiliansk portugisisk | Claude Fable 5.2 (Claude Code) |

To Gemini 4 Neon-underagenter ble satt på tysk, nederlandsk, fransk og italiensk, men stoppet på kvotegrensen før de hadde levert noe, så det arbeidet ble gjort på nytt av Fable 5.2. GPT 6.2 Astra flettet de fire konverteringsgruppene og oversettelsene, ryddet tekst ingen gruppe eide og la inn den strenge oversettelsessjekken i CI.

**Claude Opus 5.5** koordinerte 1.0.0 i Claude Code: fordelte arbeidet på issues, pull requests og oversettelser mellom underagentene, gjennomgikk og flettet resultatene, rettet en testfeil etter flettingen, og sto for versjonsloggen, bygg, utgivelse, overgangen til åpen kildekode og installasjonen.

## Dokumentasjon etter 1.3.1

En **Claude Opus 5.5**-underagent i Claude Code oppdaterte `README.md`, `README.nb.md` og denne filen til å beskrive v1.2.0–v1.3.1, det offentlige repoet og krediteringen. Ingen appversjon eller ny binærutgivelse.

## 1.3.1

En **Claude Opus 5.5**-agent (`effort: high`) bygde PR #9 (`f48832f`: klikkbare fil-, MD- og tråd-lenker, tydelige fargede inline-SVG-favicons på alle web-lenker, `$skill`-brikker og kontrastløft). En egen skrivebeskyttet **Claude Opus 5.5**-kritiker (`effort: high`) gjennomførte en uavhengig `$review`- og `$frontend-design`-gjennomgang av v1.3.0 mot T3 Code-referansene og fant blant annet hurtigtaster med bare Shift, ikke-interaktivt skall for handlinger, manglende Angre ved sletting og avvik i avstand, typografi, sidefane og GitHub-farger. **Gemini 4 Neon** (Google, koordinator i Antigravity) flettet PR #9, implementerte kritikerens feilrettinger (Shift-only hurtigtast-sperre, interaktivt skall, Angre ved sletting, arbeidstre-feilhåndtering) og designpolering, oversatte alle nye tekster til alle elleve språk, og sto for kontroll, bygg og utgivelse.

## 1.3.0

To **Claude Opus 5.5**-agenter (`effort: high`) bygde oppdateringen parallelt: PR #8 (`10bc98b`) bygde opp hele **Innstillinger → Prosjekter** med *Ingen prosjekt (Denne datamaskinen)*, Chat-prosjekter, arkivering, ikonmodal, modell + tenkeinnsats, arbeidsområde, kjørbare handlinger/prosjektskript (også i Tråddetaljer og ved opprettelse av arbeidstrær) og skrifttypevalg under Typografi; PR #7 (`0eeb855`) oppgraderte fargede leverandør- og modell-favicons i Chat-hoverkort, modellbytte-linjer, svarmodell-knappen/kortet, Chat-rader i sidefanen og tenkevisning, la til ekte GitHub-ikon og statusfarger, og innførte automatisk «Mine på GitHub» over alle repoer via `gh` CLI. **Gemini 4 Neon** (Google, koordinator i Antigravity) koordinerte oppgavene, gjennomgikk og flettet PR #7 og PR #8, oppdaterte oversettelsene til alle elleve språk, rettet en utdatert testforventning i `20-innstillinger-runde5.test.ts`, og sto for kontroll, bygg, utgivelse og lokal installasjon.

## 1.2.1

**Gemini 4 Neon** (Google, i Antigravity) gjorde Ocean-temaet lysere i mørk variant (WCAG AA) og oppgraderte leverandør-, VS Code-, lenke- og filtype-ikoner til ekte fargede SVG-favicons i hele appen, samt sto for kontroll, bygg, utgivelse og lokal installasjon.

## 1.2.0

**Claude Opus 5.5** implementerte PR #4 (`b8a7b1a`): prefiksregler for «Tillat alltid», felles nettlesergodkjenning, «Bruk på alle prosjekter» og regeloversikt, «API-adresse (Base URL)» og valgfritt modellfelt i egendefinert leverandøroppsett, underagenter mot valgt API-leverandør med oppgraderte underagentkort, «Kontekstoverføring venter», navngiving og bildestøtte for innlimte bilder, leverandørmerker i modellvelgeren og automatisk GitHub CLI-oppdagelse. **Claude Sonnet 5.5** implementerte PR #6 (`edb0d55`): de fem nye fargetemaene (Ocean, Rosa, Skog, Glød, Iris) med WCAG AA-kontroll, System/Lys/Mørk-kort, kontrast- og breddeinnstillinger, live typografi- og kodeforhåndsvisning, den nye Prosjekter-siden i Innstillinger, 18 prosjektfarger, monogram- og bildeopplasting for prosjektikoner, utvidet favicon-søk, oppdatert sidefane og hover-kort, smarte lenke- og filbrikker i meldinger, innebygd GitHub-detaljvisning i sidepanelet og den flytende Tråddetaljer-menyen. **Gemini 4 Neon** (Google, koordinator i Antigravity) koordinerte utgivelsen, fordelte og flettet de to PR-ene, oversatte alle 131 nye tekster til de elleve språkene, og sto for kontroll, bygg, utgivelse og lokal installasjon.

## 1.1.0

GPT 6.2 Sol (Codex) bygde GitHub-integrasjonen med GitHub CLI og velkomstskjermen med import, i hver sin underagent. Gemini 4 Neon bygde innstillingene for differ (side om side, mellomrom, filtilstand og farger), nettleser (søkemotor, agenttilgang, lenker, zoom og utseende), varsler og rekkefølgen i sidefanen. **Claude Opus 5.5** koordinerte i Claude Code: skrev oppgavene, gjennomgikk og flettet de tre pull requestene, løste flettekonflikter, rettet en utdatert test, og sto for versjonsloggen, bygg, utgivelse og installasjon.

## Om GitHubs Contributors-graf

README og denne filen krediterer modellene og AI-verktøyene som prosjekteieren oppgir. GitHubs graf beregnes fra commit-historikk og e-postadresser som GitHub kan knytte til kontoer; en tekstoppføring her registrerer ikke en konto i grafen. Historikken er ikke omskrevet for å endre statistikken. Da repoet ble offentlig, ble prosjekteierens private e-postadresse i to eldre commits byttet til GitHubs noreply-adresse, og tre falske Stripe-lignende testnøkler ble delt opp så GitHubs hemmelighetsskanner ikke tar dem for ekte. Ellers er innholdet likt. Nye Codex- og Claude-assisterte commits kan ha en tydelig `Co-authored-by`-linje.

Verktøyene oppføres som AI-assistanse, ikke som mennesker, prosjekteiere eller garantister. Krediteringen innebærer ingen offisiell støtte eller tilknytning til Anthropic, OpenAI eller Google. Lisensvilkår endres ikke av denne filen.

## Kode Studio

Codex og underagenter utformet og implementerte det opprinnelige grunnlaget for Kode Studio (filfaner, CodeMirror-editor, direkte prosjektfilovervåking, konflikthåndtering og gjenbruk av kodeagent/verktøy). Gemini 4 Neon fullførte funksjonen etter rebase mot v0.29.1, delte språklasteren med eksisterende editor, koblet Filer-panelet og kommandopaletten til Studio, rettet terminal- og manglende-mappe-håndtering, forbedret tastaturnavigasjon, søk og konfliktreparasjon, samt la til server- og UI-tester.
