# Slash-skills i Agentic Desktop

Skriv `/` først i meldingsfeltet for å vise kommandoer og skills. Skriv videre for fuzzy-søk, bruk opp/ned og Enter for å velge, og Esc for å lukke. `/rvw` finner for eksempel `/review`. Du kan også skrive `/review området som skal vurderes` direkte. Valg fra menyen legger skillen som en brikke, så du kan skrive argumentene etterpå.

## Filformat

Legg hver skill i `skills/<navn>/SKILL.md`, enten i appmappen eller i prosjektmappen:

```markdown
---
name: review
description: Gå gjennom kode før den tas i bruk.
args: "[fil eller område]"
---
Gå gjennom dette uten å endre filer: {{args}}
```

`name` og `description` er påkrevd tekst. `args` er valgfri tekst som beskriver argumentene i menyen. Kroppens `{{args}}` erstattes bokstavelig med friteksten etter kommandoen; mellomrom, linjeskift og tegn som `$&` beholdes. Ugyldige metadata gir advarsel i serverloggen og filen hoppes over.

Prosjektets skills vinner over globale skills. Eksisterende `.agentic/skills/`, `.claude/skills/`, `.agents/skills/` og brukerens konfigurasjonsmappe støttes fortsatt. Appens medfølgende skills kan vises, men ikke endres gjennom Innstillinger. Lag en egen variant med samme navn for å overstyre dem.

## Hvordan instruksjonene brukes

Bare kommandoen og argumentene vises i chatloggen. Skill-kroppen legges i systeminstruksen for den aktuelle turen; den kopieres ikke til senere brukermeldinger eller komprimeringssammendrag. Valget tas som et øyeblikksbilde ved innsending, også når meldingen står i kø. En skill gir ingen ekstra verktøy eller tillatelser.

Mapper leses ved oppstart og kontrolleres for filendringer hvert halve sekund. Oppretting, endring, editorens atomiske lagring og sletting oppdaterer åpne kommandomenyer uten omstart.

## Demo og eksisterende gjennomgang

Bare én demo følger med: `skills/review/SKILL.md`. `/review` velger denne når den finnes. Appens tidligere gjennomgang av trådens registrerte filendringer er tilgjengelig som `/review-changes`. Når ingen review-skill finnes, beholdes `/review` som alias for den innebygde funksjonen.
