# Status

## v0.20.0 – bygg 60

Oppdatert 14. november 2026. Endringer siden v0.11.0 er samlet i [versjonsloggen](PATCHLOG.md).

- Separate Chat- og Kode-modus med egne instrukser og minner, valgfri modellkontekst og ryddigere innstillinger.
- Skills-arbeidsområde, slash-kommandoer, TAB-forslag fra samtalehistorikk, redigerbar meldingskø og rullbare vedlegg.
- Felles topprad i sidepanelet med nettleser-/terminaløkter, flere startfaner og manuell fil-/nettleserbruk uten prosjekt.
- Elementannotering med kommentarer og skjermbilde til samtaleutkastet.
- Lokale Git-grener og arbeidstrær som egne prosjekter, med sperrer ved lokale endringer og pågående modellarbeid.
- Sammendrag, underagenter, synlige arbeidssteg, filverktøyenes endringskort og grønne/røde differanser.
- Kodepaletter, skrifter og samtalevisning kan tilpasses. Profilmenyen har full, søkbar versjonslogg.

## Kontrollert

Utviklingsutgaven er kontrollert med 413 servertester, 28 berørte UI-forløp, ni Electron-/pakkekontroller og typekontroll av server, web og Electron. Kontrollene bruker demo-modell, lokale prøveservere og midlertidige data. Testpakker og interne målerapporter er ikke med i dette repoet. Kildekoden i repoet kontrolleres med `npm run typecheck`; bygg og installasjon er beskrevet i [README](../README.md).

OpenRouter er bekreftet med ekte tilkobling og modellhenting. Andre integrasjoner som er merket Beta, er ikke erklært testet mot sine ekte API-er.

## Kjente avgrensninger

- Endringskort og Angre følger filverktøyenes registrerte endringer. Vilkårlige endringer fra shellkommandoer er ikke en komplett Git-diff eller automatisk sporbar historikk.
- Kommandoer kjører med lokal brukers OS-tilgang. Godkjenningsvalg og prosjektgrenser er ikke full filsystemisolasjon.
- Git krever et eksisterende repo med første commit. Ingen automatisk stash, commit, push eller sletting. Eksterne Git-/terminalprosesser låses ikke av appen.
- Elementannotering er et frossent snapshot av hoveddokumentet; iframe-/shadow-DOM-inspeksjon er ikke innført.
- Vanlige usendte utkast er minnelagret og overlever ikke full prosessavslutning.
- MCP-servere, hooks og andre uttrykkelig merkede Demo-funksjoner er ikke ferdige.

Se [Git og verktøy](GIT-AND-TOOLS.md), [sidepanelet](SIDEPANEL-WORKSPACE.md), [skills](SLASH-SKILLS.md) og [modellkontekst](MODEL-CONTEXT.md) for bruk og detaljer.
