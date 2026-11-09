# Agent-harness: hva de andre gjør (runde 6, 4. november 2026)

Kort oversikt over hvordan Claude Code, OpenAI Codex CLI, OpenCode, Aider, Cline og Hermes Agent (Nous Research) bygger systemprompt, verktøy og agentløkke. Sortert etter hva som gir mest for svakere API-modeller. Kildene er primærkilder (dokumentasjon eller kildekode på en fast tag) der det står en lenke. Det som ikke kunne bekreftes fra en primærkilde, er merket **ubekreftet**.

Forkortelser: OC = OpenCode v1.0.0 (`raw.githubusercontent.com/anomalyco/opencode/v1.0.0/packages/opencode/src/...`), CX = Codex sin prompt (`codex-rs/core/gpt_5_1_prompt.md`, https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/gpt_5_1_prompt.md).

## Størst effekt for svakere modeller

1. **Redigering som tåler små avvik, og feil som sier hva som er galt.**
   - Claude Code: eksakt `old_string`/`new_string`, må være unik ellers `replace_all`, og filen må være lest først (https://code.claude.com/docs/en/tools-reference).
   - OpenCode prøver ni «replacers» etter hverandre: eksakt, linjer uten innrykk, blokk-ankre, normalisert mellomrom, fleksibelt innrykk og så videre. Feilene er «oldString not found in content» og «Found multiple matches … Provide more surrounding lines» (OC `tool/edit.ts`).
   - Aider: å slå av fleksibel patching ga 9 ganger flere redigeringsfeil (https://aider.chat/2023/12/21/unified-diffs.html). Når en SEARCH-blokk ikke passer, svarer Aider med de mest like linjene i filen, «Did you mean to match some of these actual lines» (https://raw.githubusercontent.com/Aider-AI/aider/main/aider/coders/editblock_coder.py).
   - Svake modeller på Aiders polyglot-liste bruker `whole` (hele filen), mellomsterke bruker `diff` (https://aider.chat/docs/leaderboards/).
2. **Feil går tilbake til modellen i stedet for å stoppe turen.**
   - OpenCode retter store/små bokstaver i verktøynavnet og sender resten til et `invalid`-verktøy: «The arguments provided to the tool are invalid: …» (OC `session/prompt.ts`, `tool/invalid.ts`).
   - Cline sier «Missing value for required parameter '…'. Please retry with complete response.» og stopper etter 3 feil på rad (https://raw.githubusercontent.com/cline/cline/v3.17.0/src/core/prompts/responses.ts).
   - Anthropic: «prompt-engineer your error responses», altså feilmeldinger som sier hvordan det rettes (https://www.anthropic.com/engineering/writing-tools-for-agents).
   - JSON-reparasjon (som `jsonrepair`): **ubekreftet** at noen av disse bruker det. Vanlige feil fra OpenAI-kompatible modeller er likevel kjent: kodegjerder rundt JSON, komma til slutt, Python-verdier og dobbelt kodet JSON.
3. **En sjekk med bestått/feilet etter endringer.**
   - Aider kjører lint og tester etter hver endring og sender feilene tilbake, maks 3 ganger (https://aider.chat/docs/usage/lint-test.html, `base_coder.py`).
   - OpenCode legger LSP-feil rett i svaret fra edit (OC `tool/edit.ts`).
   - Codex: test det du endret først, så bredere (CX).
   - Claude Code: «Give Claude something it can run that comes back pass or fail» (https://code.claude.com/docs/en/best-practices).
4. **Grenser for verktøyutdata, med et hint om hva modellen kan gjøre.**
   - Claude Code: maks 25 000 tokens per verktøysvar (https://www.anthropic.com/engineering/writing-tools-for-agents). Bash rundt 30 000 tegn (tools-reference).
   - OpenCode: bash 30 000 tegn, og på `dev` 2000 linjer / 50 KiB med «[showing lines 1-N of M …]».
   - Codex: hode og hale med «[... omitted N of M lines ...]», ifølge en PR som ikke er slått sammen (https://github.com/openai/codex/pull/6476), så **ubekreftet** for dagens kode.
5. **Gamle verktøyresultater fjernes før en LLM-oppsummering.**
   - OpenCode beskytter de nyeste 40 000 tokens med verktøyutdata og oppsummerer «what we did, what we're doing, which files …, what we're going to do next» (OC `session/compaction.ts`).
   - Hermes fjerner gamle verktøyresultater uten LLM-kall og oppsummerer i seksjonene Goal / Constraints / Progress / Decisions / Files / Next Steps (https://hermes-agent.nousresearch.com/docs/developer-guide/context-compression-and-caching).
   - Anthropic kaller fjerning av verktøyresultater «safest lightest touch» (https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

## Middels

6. **AGENTS.md med grense.** Codex leser fra git-roten og ned til cwd, maks 32 KiB (https://learn.chatgpt.com/docs/agent-configuration/agents-md). Claude Code leser CLAUDE.md, og AGENTS.md bare hvis CLAUDE.md mangler (https://code.claude.com/docs/en/memory). Hermes kutter ved 20 000 tegn og beholder 70 % fra starten og 20 % fra slutten.
7. **Oversikt over repoet.**
   - Aider bygger et repo-kart (1k tokens som standard) (https://aider.chat/docs/repomap.html).
   - OpenCode legger `<env>` og et filtre på maks 200 i prompten (OC `session/system.ts`). Cline lister opp til 200 filer.
   - Claude Code legger ikke inn noe tre, men henter «just in time» med glob og grep.
8. **Lesing med linjenumre og utsnitt.** OpenCode leser 2000 linjer som standard, kutter linjer over 2000 tegn og sier «Use 'offset' parameter to read beyond line N». Claude Code har `offset`/`limit` og avviser hele filer over 256 KB.
9. **grep og glob med tak.** Claude Code: glob sortert etter endringstid, maks 100. grep med tre modi og `head_limit`. OpenCode: grep maks 100 treff med «Results are truncated. Consider using a more specific path or pattern.».
10. **Planverktøy.** Codex `update_plan`: «exactly one item in_progress», ingen plan med ett steg, og hopp over det for enkle oppgaver (CX). OpenCode gir ukjente modeller en prompt uten todo-verktøyet (OC `session/system.ts`).
11. **Løkkebrems.** OpenCode spør brukeren etter tre like kall på rad. Denne appen har allerede det samme (SPEC 5).

## Pynt, eller mindre effekt

12. **Parallelle kall.** Cline 3.17 tillater bare ett verktøy per melding. Bare lesende verktøy bør gå parallelt.
13. **Varige minner.**
    - Claude Code laster de første 200 linjene eller 25 KB av MEMORY.md (https://code.claude.com/docs/en/memory).
    - Hermes har MEMORY.md på 2200 tegn og USER.md på 1375 tegn. De legges inn som et fast øyeblikksbilde ved start, og blir det fullt, svarer verktøyet med en feil så agenten må rydde (https://hermes-agent.nousresearch.com/docs/user-guide/features/memory).
14. **Skills og selvforbedring.**
    - Agent Skills: `name` maks 64 tegn (små bokstaver og bindestrek) og `description` maks 1024 tegn, som sier hva og når. Bare metadata ligger i prompten (https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview).
    - Hermes lager skills etter en ikke-triviell arbeidsflyt, etter at den har kommet seg ut av en feil, eller etter en rettelse fra brukeren (https://hermes-agent.nousresearch.com/docs/user-guide/features/skills). Regelen om «5+ verktøykall» som ofte siteres, er fjernet fra kildekoden.
15. Prompt-cache og egne prompter per modell.

## Valg for Agentic Desktop

Tatt med, i denne rekkefølgen:
1. `edit_file` med eksakt treff først, så reserver (linjenumre limt inn fra `read_file`, CRLF, mellomrom til slutt i linjen, innrykk). Treffet må fortsatt være unikt. Feilene viser de mest like linjene med linjenumre.
2. Robust lesing av argumenter: reparasjon av vanlige JSON-feil, typer gjettet fra skjemaet («10» → 10, «true» → true, JSON-tekst → liste), verktøynavn uten store bokstaver eller `functions.`-prefiks, og en feil tilbake til modellen som viser forventede felt.
3. En automatisk påminnelse når kode er endret uten at noe er kjørt etterpå, men bare når prosjektet har en kjent testkommando. Kommandoene står også i systemprompten.
4. Verktøyutdata kortes ned linjevis med hode og hale og «[… N linjer utelatt …]», og `read_file` kutter lange linjer.
5. Komprimering: samme to steg som før, men oppsummeringen har faste seksjoner.
6. `read_file` med linjenumre, `glob`, et bedre `search` (filer eller linjer, store/små bokstaver, kontekst), en kort oversikt over prosjektmappen i prompten og `update_plan`, som skriver planen i det festede sammendraget.
7. Parallelle kall for lesende verktøy.
8. Minner (`remember`/`forget`) som filer, og `propose_skill` med godkjenning.

Ikke tatt med: LSP-diagnostikk, et repo-kart med rangering, egne prompter per modell, lagring av hele utdata til fil, og prompt-cache-brytepunkter.
