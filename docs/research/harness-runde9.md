# Standard-harness, lag, minne og skills: hva de andre gjør (runde 9b, 5. november 2026)

Bygger på [harness.md](harness.md) fra runde 6. Det som står der, gjentas ikke her: Codex' grense på 32 KiB, Claude Codes grense på 200 linjer for MEMORY.md, og Hermes' minnefiler med fast øyeblikksbilde.

Kildene er primærkilder, altså dokumentasjon eller kildekode. Påstander som ikke kunne bekreftes der, er merket **ubekreftet**. Ingen prompter er kopiert. Teksten i appen er skrevet på nytt.

## 1. Innebygd systemprompt og identitet

### Claude Code
- Identitetssetningen er ikke publisert (**ubekreftet**).
- Presetet har verktøyveiledning og sikkerhetsregler.
- Miljøet kommer som kontekst: cwd, plattform, shell, OS-versjon, et øyeblikksbilde av git-status og CLAUDE.md. Kilde: https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts

### Codex
- Hver modell har sin egen prompt, og prompten åpner med hvem agenten er. Kilde: https://github.com/openai/codex/blob/main/codex-rs/core/gpt-5.2-codex_prompt.md
- Én av promptene lister hva agenten kan og har en kort personlighet: kortfattet, direkte og vennlig. Kilde: https://github.com/openai/codex/blob/main/codex-rs/core/gpt_5_2_prompt.md
- Miljøet legges inn for seg: arbeidsmapper, shell, dato, tidssone og tillatelser. Kilde: https://github.com/openai/codex/blob/main/codex-rs/core/src/context/world_state/environment.rs

### OpenCode
- Prompten velges etter modell.
- `<env>` legges til automatisk: mappe, om det er git, plattform og dato. Skill-listen og modellnavnet kommer også med.
- Kilde: https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/session/system.ts

### Aider
- Prompten gir agenten en rolle som erfaren utvikler, etterfulgt av formatreglene for redigering.
- `get_platform_info` legger inn OS, shell, språk, dato, git og lint-kommandoer.
- Kilder: https://github.com/Aider-AI/aider/blob/main/aider/coders/editblock_prompts.py og https://github.com/Aider-AI/aider/blob/main/aider/coders/base_coder.py

### Cline
- Identitet først, så `<env>` med plattform, dato og mappe.
- Kilde: https://github.com/cline/cline/blob/main/sdk/packages/shared/src/prompt/system/act.ts. At VS Code-utvidelsen bruker akkurat denne, er **ubekreftet**.

### Hermes
- Identiteten er en kort atferdsbeskrivelse: direkte, uten fyllord.
- Rekkefølgen er sjel (SOUL.md), så verktøyveiledning, minne, skills, kontekstfiler og til slutt tid og plattform.
- Kilder: https://github.com/NousResearch/hermes-agent/blob/main/agent/prompt_builder.py og https://hermes-agent.nousresearch.com/docs/user-guide/features/personality

**Felles:** alle fem starter med hvem agenten er og hva den kan. Miljøet settes inn av appen, ikke av brukeren, og har alltid med mappe, OS og dato. Codex og OpenCode har også med git, og flere har med verktøyene.

## 2. Instruksjonsfiler i lag

### Claude Code
- Lagene er administrert, så `~/.claude/CLAUDE.md`, så prosjektet og til slutt `CLAUDE.local.md`. Den nærmeste fila leses sist.
- AGENTS.md brukes bare når CLAUDE.md mangler.
- Ingen standardfil lages ved installasjon. `/init` og `/memory` lager den.
- `/context` viser hvilke filer som er lastet.
- Kilde: https://code.claude.com/docs/en/memory

### Codex
- Den globale fila er `~/.codex/AGENTS.md`, eller `AGENTS.override.md` hvis den finnes.
- Deretter leses én fil per mappe fra roten til cwd, med et samlet tak på 32 KiB.
- Ingen standardfil lages.
- `codex debug prompt-input` viser det modellen faktisk får.
- Kilder: https://learn.chatgpt.com/docs/agent-configuration/agents-md og https://github.com/openai/codex/blob/main/codex-rs/cli/src/main.rs

### OpenCode
- Den globale fila er `~/.config/opencode/AGENTS.md`, med `~/.claude/CLAUDE.md` som reserve.
- I prosjektet leses alle AGENTS.md fra cwd og opp til roten. CLAUDE.md brukes bare når ingen AGENTS.md finnes.
- Kilder: https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/session/instruction.ts og https://opencode.ai/docs/rules/

### Aider
- CONVENTIONS.md leses inn med `--read`.
- `--show-prompts` skriver ut promptene.
- Kilder: https://aider.chat/docs/usage/conventions.html og https://aider.chat/docs/config/aider_conf.html

### Cline
- Reglene ligger i `.clinerules/` i arbeidsområdet og i en global mappe. Arbeidsområdet vinner.
- Hver regel kan slås av og på for seg.
- Kilde: https://docs.cline.bot/customization/cline-rules

### Hermes
- SOUL.md ligger i `~/.hermes`, og **en startfil lages første gang** Hermes kjører.
- Bare én prosjektfil brukes: `.hermes.md`, AGENTS.md, CLAUDE.md og så videre, i den rekkefølgen.
- Filene skannes for prompt-injeksjon før de brukes.
- Kilder: https://hermes-agent.nousresearch.com/docs/user-guide/features/personality og https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files

**Felles:** lagene er innebygd, global og prosjekt, og den nærmeste vinner. Bare Hermes lager en standardfil første gang. Det ønsker brukeren seg, og vi gjør det samme. Codex, Aider og Claude Code har en måte å vise den samlede prompten på.

## 3. Automatisk minne og opprydding

- **Claude Code** lagrer minner uten at brukeren godkjenner hvert ett. MEMORY.md er en indeks. Når den nærmer seg 200 linjer eller 25 KB, får modellen beskjed om å slå sammen eller kutte. Kilde: https://code.claude.com/docs/en/memory
  - En periodisk opprydding kalt «auto dream» er bare omtalt på blogger, så den er **ubekreftet**.
- **Anthropic API, minneverktøyet:** filoperasjoner på `/memories`. Docs anbefaler å sette tak og rydde selv. Kilde: https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
- **Codex Memories** er av som standard og går i to faser.
  - Først trekkes et minne ut per tråd som har blitt liggende, og hemmeligheter fjernes.
  - Så slår en egen agent sammen duplikater mot et diff, og minner som ikke er brukt på lenge, fjernes.
  - Prinsippet er å slå sammen og beholde ordlyden, og å slette bare det som ikke lenger har belegg.
  - Kilder: https://github.com/openai/codex/blob/main/codex-rs/memories/README.md og https://github.com/openai/codex/blob/main/codex-rs/memories/write/templates/memories/consolidation.md
- **Hermes**
  - Like duplikater avvises stille.
  - Når minnet er fullt, får modellen lista og må fjerne og legge til i én operasjon.
  - Valget `write_approval` gir en kø av minner som venter på godkjenning.
  - Minner skal skrives som fakta, ikke som ordre.
  - Kilde: https://hermes-agent.nousresearch.com/docs/user-guide/features/memory
- **Cline** har ikke noe innebygd minne. «Memory bank» er en regelfil som brukeren ber agenten oppdatere. Kilde: https://docs.cline.bot/prompting/cline-memory-bank
- **Aider:** docs nevner ingen minnefunksjon. At den mangler helt, er **ubekreftet**.

**Felles:** oppryddingen slår sammen like minner, fjerner det som er utdatert, og kutter når det blir fullt. Codex gjør det med en egen modell mot et diff som kan ses. Vi gjør det samme, men med en deterministisk standard, så det virker uten nøkkel. Brukeren ser alltid forslaget først.

## 4. «Gjenopprett standard», erstatte eller legge til

- **Claude Code**
  - `--system-prompt` erstatter prompten, og `--append-system-prompt` legger til.
  - En egen output style tar bort kodereglene, med mindre `keep-coding-instructions` er satt. Å velge «default» gir standarden tilbake.
  - Kilder: https://code.claude.com/docs/en/cli-reference og https://code.claude.com/docs/en/output-styles
- **Codex**
  - `model_instructions_file` erstatter, og `developer_instructions` legger til.
  - `personality = "none"` tar bort personligheten.
  - Kilde: https://learn.chatgpt.com/docs/config-file/config-reference
- **OpenCode:** en agentprompt erstatter grunnprompten, men miljøet og instruksjonene legges fortsatt til. Det finnes ingen egen tilbakestilling. Kilde: https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/session/llm/request.ts
- **Cline:** `resetState` tilbakestiller tilstanden. Kilde: https://github.com/cline/cline/blob/main/apps/vscode/src/core/controller/state/resetState.ts
- **Hermes:** `/personality default` tilbakestiller. En tom SOUL.md gir den innebygde identiteten. Kilde: https://hermes-agent.nousresearch.com/docs/user-guide/features/personality

**Felles:** grunnprompten erstattes sjelden helt, og når den gjør det, forsvinner sikkerhetsreglene. Vi lar derfor grunnen ligge fast i koden og lar bare deler av den slås av. Identitet og sikkerhet er låst. Bare filer brukeren selv har endret, gjenopprettes, og ingen av de andre viser en diff først. Det gjør vi.

## 5. Chat-produktene

- **ChatGPT**
  - Egendefinerte instruksjoner kan være 1500 tegn på gratisplanen og 5000 på betalte planer. Kilde: https://help.openai.com/en/articles/8096356-custom-instructions-for-chatgpt
  - Stil og tone er en egen innstilling. Kilde: https://help.openai.com/en/articles/11899719-customizing-your-chatgpt-personality
  - Minnet har to brytere, og minnene kan endres og slettes. Kilde: https://help.openai.com/en/articles/8590148-memory-faq
- **Claude.ai**
  - Instruksjoner gjelder for hele kontoen, og hvert prosjekt kan ha sine egne.
  - Minnet kan pauses eller nullstilles, og noen typer opplysninger lagres aldri.
  - Kilder: https://support.claude.com/en/articles/10185728-understanding-claude-s-personalization-features og https://support.claude.com/en/articles/11817273
  - Tegngrensen er **ubekreftet**.

**Felles:** systeminstruks, «om deg» og tone er egne felt med tak, og minnet er adskilt fra dem. Det kan slås av, endres og slettes.

## 6. Skills

- **Spesifikasjonen**
  - `name` har 1–64 tegn: `a-z0-9-`, uten bindestrek først eller sist og uten dobbel bindestrek, og det er det samme som mappenavnet.
  - `description` har 1–1024 tegn.
  - Valgfrie felt er `license`, `compatibility`, `metadata` og `allowed-tools`.
  - Kilder: https://agentskills.io/specification og https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- **Navnekollisjoner**
  - Claude Code går i rekkefølgen enterprise, personlig og prosjekt. Kilde: https://code.claude.com/docs/en/skills
  - Hos Codex kan begge vises. Kilde: https://learn.chatgpt.com/docs/build-skills.md
  - Hos OpenCode overskriver den sist lastede, med en advarsel i loggen. Kilde: https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/skill/index.ts
  - Ingen av dem spør brukeren. Vi gjør det ved import: erstatt, behold begge eller hopp over.

## Valg for Agentic Desktop

1. **En grunn-harness i koden, versjonert, i deler.** Delene er identitet, arbeidsmåte, verktøy, planlegging, verifisering, spør først, sammendrag og sikkerhet. Identitet og sikkerhet er låst, og resten kan slås av og på. Grunnen sier hva agenten kan og hvordan den presenterer seg, så «hei» får et svar som kjenner seg selv.
2. **Miljøet settes inn av appen:** OS, prosjektmappe, gren (fra `.git/HEAD`, uten å kjøre git), dato, verktøyene som er på, sjekkene og øverste nivå i mappa.
3. **Global `AGENTS.md` med et godt standardinnhold**, lagt i den globale mappen første gang appen starter (som SOUL.md i Hermes). Den overskriver aldri en fil som finnes, og den kommer ikke tilbake hvis du sletter den.
4. **«Gjenopprett standard»** viser en linjediff før du bekrefter og tar sikkerhetskopi av den gamle fila. Det samme gjelder harness-valgene.
5. **Forhåndsvisning:** den samlede systemprompten lag for lag, med tokens per lag. Dette tilsvarer `/context` og `codex debug prompt-input`.
6. **Minneoppgradering** finner like og nesten like minner, minner som er utdaterte fordi et nyere sier noe annet eller en fil er borte, og fyllord som kan kuttes. Den er deterministisk som standard. En ekte modell kan lage forslaget, men forslaget vises alltid før noe lagres. Den kjører av seg selv når det er mange minner, og den kan slås av.
7. **Chat har sin egen personalisering:** systeminstruks, «om deg», tone og egne minner med «Oppdater minnet av seg selv». Chat får verken Kode-harnessen, den globale AGENTS.md eller Kode-minnene.
8. **Skill-import:** strenge regler for navn og beskrivelse etter spesifikasjonen. Ukjente felt beholdes. Ved kollisjon spør appen, og feil vises per fil.

Ikke tatt med:
- dynamisk kontekst i en egen melding for å spare cache (prompten låses allerede per tråd)
- skanning for prompt-injeksjon i AGENTS.md (filene merkes som brukerens egne, og annet innhold er fortsatt «data»)
- `@import` i AGENTS.md
