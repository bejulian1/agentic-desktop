# Innstillinger i agentiske kodeapper (runde 5)

Undersøkt 4. november 2026 fra appenes egen dokumentasjon. Ingen API-er er kalt. Det som ikke kunne bekreftes på en side, er merket *ubekreftet*.

## 1. Hva de andre har

**Codex (CLI `config.toml` og skrivebordsappen).** Kilder: <https://learn.chatgpt.com/docs/config-file/config-reference>, <https://learn.chatgpt.com/docs/reference/settings.md>
- Modell: `model`, `model_reasoning_effort`, `model_reasoning_summary` (auto, concise, detailed, none), `review_model`.
- Tillatelser: `approval_policy`, `sandbox_mode` (read-only, workspace-write, danger-full-access) og `sandbox_workspace_write.writable_roots`.
- Kontekst: `model_auto_compact_token_limit` og `tool_output_token_limit`.
- Personvern: `history.persistence` (save-all, none) og `analytics.enabled`.
- Varsler: `tui.notifications` med `notification_condition` (unfocused, always).
- Visning: `hide_agent_reasoning` og `tui.animations`.
- Appen: Enter eller Cmd/Ctrl+Enter for å sende, hindre dvale mens noe kjører, varsel når en tur er ferdig, tema, aksent- og bakgrunnsfarge, UI- og kodeskrift, hurtigtaster, AGENTS.md og minner, og arkiverte chatter.

**Claude Code (`settings.json` og skrivebordsappen).** Kilder: <https://code.claude.com/docs/en/settings-reference>, <https://code.claude.com/docs/en/desktop>
- Modell: `model`, `effortLevel` og `showThinkingSummaries`.
- Visning: `theme`, `viewMode` og `prefersReducedMotion`.
- Samtale: `autoScrollEnabled`, `showTurnDuration` og `language`.
- Tillatelser: `permissions.allow`, `ask` og `deny`, `defaultMode` og `additionalDirectories`.
- Sandkasse: `sandbox.*`.
- Kontekst: `autoCompactEnabled` og `fileCheckpointingEnabled`.
- Personvern: `cleanupPeriodDays`.
- Annet: `hooks` og `env`.
- Varsler: `inputNeededNotifEnabled`. Det finnes ingen nøkkel for lyd.

**Cursor.** Kilder: <https://cursor.com/docs/agent/security/run-modes>, <https://cursor.com/docs/cli/reference/configuration>, <https://cursor.com/help/security-and-privacy/privacy>
- Kjøremoduser: Auto-review, Allowlist og Run Everything.
- Lister: `permissions.allow` og `deny`.
- Visning: `display.showThinkingBlocks`.
- Personvern: Privacy Mode under General.
- Lyd når en tur er ferdig: *ubekreftet* hvor den ligger i dag.

**OpenCode (`opencode.json`, `tui.json`, skrivebordsappen, bilde 20 og 22–23).** Kilder: <https://opencode.ai/docs/config/>, <https://opencode.ai/docs/tui/>
- Modeller: `model`, og `small_model` for titler.
- Agent: `permission`, `compaction` (auto) og `snapshot` (angre).
- Annet: `shell`, `theme` og `attention.sound`.
- Skrivebordsappen: språk, godta tillatelser automatisk, terminalskall, vis resonneringssammendrag, og utvid shell- og edit-verktøy. I tillegg Leverandører (tilkoblet og populære, med «Koble til») og Modeller.

**Zed (agentpanelet).** Kilde: <https://zed.dev/docs/ai/agent-settings>
- Modeller: `agent.default_model` og `thread_summary_model`.
- Kontekst: `agent.auto_compact` med terskel 90 %.
- Varsler: `play_sound_when_agent_done` og `notify_when_agent_waiting`.
- Tillatelser: `tool_permissions` med lister per verktøy.
- Visning: `agent_ui_font_size`.

**Windsurf (nå Devin Desktop).** Kilde: <https://docs.devin.ai/desktop/terminal>
- Moduser: Code, Smart og Bypass Permissions.
- Kommandoregler: Allow, Ask og Deny.

**Cline.** Kilde: <https://docs.cline.bot/features/auto-approve>
- Automatisk godkjenning per type: lese, redigere, kommandoer, nettleser og MCP.
- I tillegg varsler, YOLO-modus og automatisk komprimering.

**Roo Code.** Kilder: <https://roocodeinc.github.io/Roo-Code/features/auto-approving-actions>, <https://roocodeinc.github.io/Roo-Code/features/intelligent-context-condensing>
- Godkjenning: automatisk godkjenning, `allowedCommands` og `deniedCommands`.
- Kontekst: komprimering med terskel. Grense for antall forespørsler per oppgave (*ubekreftet*, sett i søkeresultater).

## 2. Hva som er vanlig, sortert

Rekkefølgen er etter hvor mange av appene som har det.

1. Tillatelsesmodus og lister over tillatte og avslåtte kommandoer. Alle har det.
2. MCP-servere.
3. Standardmodell, ofte med en egen liten modell for titler og sammendrag.
4. Automatisk komprimering av konteksten, med en terskel.
5. Varsel eller lyd når en tur er ferdig eller trenger svar.
6. Instruksjonsfiler (AGENTS.md og lignende) og sjekkpunkter eller angre.
7. Sandkasse med mapper agenten får skrive i.
8. Innsats, og om tenkningen vises.
9. Tema, aksentfarge og skrift. Redusert bevegelse har bare Claude Code og Codex.
10. Hooks.
11. Hvor lenge historikk lagres, og telemetri.
12. Enter eller Ctrl+Enter for å sende, og å hindre dvale.

## 3. Hva vi tok med, og hvor

Vi tok bare med det som virker lokalt nå. Det som hører til kontoer og skytjenester, er hoppet over: Remote Control, skymiljøer, abonnement og fakturering, team, innlogging, deling, synk og integrasjoner.

| Innstilling | Side | Status |
|---|---|---|
| Åpne appen i (Sist brukte, Chat, Kode) | Generelt | Virker |
| Lyd når en tur er ferdig | Generelt | Virker (Web Audio, ingen lydfil) |
| Systemvarsel (Av, Når appen ikke er i fokus, Alltid) | Generelt | Virker (nettleserens Notification) |
| Spør før fanen lukkes mens en tråd kjører | Generelt | Virker |
| Vis tenkesammendrag og Skallutdata utvidet | Generelt | Lagres. Samtalen (agent A) leser dem |
| Tema, aksentfarge, tekststørrelse, tetthet og redusert bevegelse | Utseende | Virker |
| Sidefane (Standard eller Smart) | Utseende | Lagres. Sidefanen er agent B sin |
| Kodeskrift, skriftstørrelse for kode, tabulatorbredde og linjebryting | Utseende | Virker for kode i tråden |
| Standardmodell | Modeller | Virker |
| Komprimering ved 80 % og maks 50 steg per tur | Modeller | Vises som faste verdier |
| Leverandører med nøkkel (OpenRouter, abliteration.ai, Anthropic og OpenAI) | Leverandører | Virker mot lokale testservere. Beta: ikke prøvd med ekte nøkkel |
| Telemetri (ingen), hvor data ligger, slett arkiverte tråder | Personvern og data | Virker |

**Hoppet over i denne runden.**
- *Språk:* appen finnes bare på norsk.
- *Enter eller Ctrl+Enter, auto-scroll, tidsstempler og standard innsats:* de hører til meldingsfeltet og samtalen. Innsats velges per tråd i meldingsfeltet.
- *Egen modell for titler:* titler lages fra første melding, uten modellkall.
- *Lister for tillatte og avslåtte kommandoer, og mapper agenten får skrive i:* krever endringer i tillatelsesmotoren. En liste som ser ekte ut, men ikke håndheves, er verre enn ingen.
- *Terminalskall og terminalskrift:* hører til terminalpanelet.
- *Ekstern editor:* appen åpner bare VS Code.
- *Hvor lenge historikk lagres:* sletting i bakgrunnen er ikke laget.
- *Justerbar kontekstgrense og maks antall verktøykall:* de er faste i agentmotoren.
- *Eksperimentelle funksjoner:* det finnes ingen ennå.

## 4. abliteration.ai

Kilde: <https://docs.abliteration.ai/api/introduction>, lest 4. november 2026.

- **Adresse:** `https://api.abliteration.ai/v1`
- **Nøkkel:** sendes som `Authorization: Bearer <nøkkel>`.
- **Format:** OpenAI-kompatibelt, med `/v1/chat/completions` og `/v1/models`. Det finnes også en Anthropic-kompatibel `/v1/messages`.
- **Uklart:** siden sier ikke hvilke felt `/v1/models` gir, så kontekststørrelsen hentes fra tabellen vår eller standardverdien.
- **Samme adresse i tredjepartskilder:** LiteLLM (<https://docs.litellm.ai/docs/providers/abliteration>), OpenClaw (<https://docs.openclaw.ai/providers/abliteration>) og promptfoo (<https://www.promptfoo.dev/docs/providers/abliteration/>).
- **Miljøvariabel:** `ABLITERATION_API_KEY`, som LiteLLM bruker. Den offisielle siden bruker `$ABLIT_KEY` bare som eksempel.
