# Kode-steg: skrivestil for verktøysteg (runde 13, SPEC 27.1)

Dette er den interne lista over hvordan et verktøysteg i en Kode-tråd skal leses. Nye verktøy følger samme mønster. Koden som gjør det, er `web/src/ui/step-words.ts` (ord og typer) og `web/src/ui/steps.tsx` (visning). Hold de tre i takt.

## Mønsteret

Én linje per steg:

```
[ikon]  Verb  hva  ·  resultat  varighet  ›
```

- **Ikon:** ett per type, se tabellen. Ikonet er dempet. Bare tre tilstander får farge: kjører (aksent), venter på deg (rav) og feilet (rød).
- **Verb:** kort, norsk, i preteritum når steget er ferdig («Leste») og i presens mens det kjører («Leser»). Stor forbokstav, ingen punktum.
- **Hva:** fila, mønsteret, kommandoen, adressen eller navnet.
  - Stier og kommandoer står i kodefont. En sti åpner mini-editoren.
  - Søkeord og navn står i «».
  - Adresser vises som vert og sti, uten `https://`.
- **Resultat:** ett eller to ord, dempet: «42 linjer», «3 treff», «exit 0», «+12 −3», «3 kilder». Står tomt heller enn å gjette.
- **Varighet:** bare fra ett sekund og oppover.
- **›** folder ut detaljene: utdata, resultatet slik modellen fikk det, eller inndataene.

## Typer, ikoner og verb

| Type | Verktøy | Ikon | Ferdig | Kjører | Resultat |
|---|---|---|---|---|---|
| Les | `read_file`, `list_dir` | øye | Leste *fil* / Så i *mappe* | Leser / Ser i | «42 linjer», «12 oppføringer» |
| Søk | `search`, `glob` | lupe | Søkte etter *mønster* / Fant filer *mønster* | Søker etter / Finner filer | «3 treff», «12 filer» |
| Nett | `web_search`, `web_fetch`, `browser_*` | globus | Søkte på nettet etter «…» / Leste nettsiden / Åpnet / Klikket på | Søker på nettet etter / Leser nettsiden / Åpner | «3 kilder» |
| Kommando | `run_command` | terminal | Kjørte *kommando* | Kjører | «exit 0», «avbrutt», «tidsavbrudd» |
| Opprett | `write_file` på en ny fil | fil med + | Opprettet *fil* | Oppretter | «+26» |
| Rediger | `edit_file`, `write_file` på en fil som finnes | blyant | Endret *fil* / Skrev om *fil* | Endrer / Skriver | «+12 −3» |
| Slett | `delete_file` | søppelbøtte | Slettet *fil* | Sletter | «−40» |
| Team | `thread_*`, `task_*` | agent | Startet underagenten «…» / Ventet på underagenten / La til oppgaven «…» | Starter / Venter på | «ferdig» |
| Minne | `remember`, `forget` | bokmerke | Lagret et minne «…» / Glemte et minne | Lagrer / Glemmer | |
| Plan | `update_plan` | liste | Oppdaterte planen | Oppdaterer | «4 steg» |
| Skill | `use_skill`, `propose_skill` | gnist | Brukte skillen / Foreslo skillen | Bruker / Foreslår | |
| Tenking | (tenkeblokk) | snakkeboble med tre prikker | første linje av sammendraget, ellers «Tenkte» | «Tenker…» | varighet |
| Godkjenning | et steg som venter | hånd | (verbet til steget) | | merket «Venter på deg» |

`write_file` skiller ny fil fra eksisterende: serveren skriver « (ny)» i sammendraget og « (ny fil)» i resultatet når fila ikke fantes.

## Like steg i rad

Steg av samme type etter hverandre i samme gruppe blir én linje som kan foldes ut. Tenking mellom dem bryter ikke rekka, den foldes inn.

| Type | Linje |
|---|---|
| Les | «Leste 6 filer», «Leste 2 filer og 1 mappe», resultat «120 linjer» |
| Søk | «Søkte 3 ganger» |
| Nett | «Søkte på nettet 2 ganger», «Leste 2 nettsider», ellers «Brukte nettleseren i 3 steg» |
| Kommando | «Kjørte 3 kommandoer», resultat «alle exit 0» eller «1 feilet» |
| Opprett, Rediger, Slett | «Opprettet 3 filer», «Endret 2 filer», «Slettet 2 filer», resultat summen av linjene |
| Team | «Jobbet med teamet i 4 steg» |

Mens noe i rekka kjører, står verbet i presens: «Leser 4 filer».

## Status

- **Kjører:** en liten snurre til høyre. Steget selv glimter ikke i Kode; det gjør bare nå-linjen.
- **Venter på deg:** hånd-ikon og merket «Venter på deg» i rav. En rekke som har et steg som venter, foldes ut av seg selv.
- **Feilet:** rødt ikon og merket «Feilet». Første linje av feilen står dempet under steget, så du ser hvorfor uten å folde ut.
- **Avslått, Avbrutt:** grått merke, og verbet er strøket over.

## Nå-linjen og oppsummeringen

- **Nå-linjen** står under turen så lenge den kjører, med glimt-tekst og tiden: «Leser demo/app.js… 4s», «Leser 3 filer…», «Gjør 2 ting samtidig…», «1 underagent jobber…», «Tenker…», «Skriver…», ellers «Jobber…». Venter turen på deg, står det «Venter på deg · Oppretter .env.demo» i rav, uten glimt. Pila viser hva turen har gjort og gjør, med underagentene.
- **Overskriften** «Jobbet i 1m 2s» kommer over turen når den er ferdig, og folder bort stegene.
- **Oppsummeringen** kommer etter en tur som gjorde noe: «Ferdig på 1m 2s · 3 filer endret · 2 kommandoer kjørt +40 −3 Endringer ›». Et klikk åpner Endringer på turens endringer. En stoppet tur sier «Stoppet etter …». En feilet tur har feilkortet i stedet.

## Samme ord overalt

Sidefanen, den smarte sidefanen, hoverkortet, rutens prikk og vindustittelen bruker de samme ordene (`web/src/state/thread-status.ts`):

| Tilstand | Ord |
|---|---|
| kjører | Jobber… |
| venter på godkjenning | Venter på deg |
| feilet sist | Feilet |
| stoppet | Stoppet |
| ferdig, ikke sett | Ferdig, ikke sett |

Vindustittelen er «Jobber… · tittel» eller «Venter på deg · tittel» når tråden i fokus trenger deg, ellers bare tittelen.

## Når du lager et nytt verktøy

1. Velg en type fra tabellen. Lag en ny type bare hvis ingen passer, og gi den et eget ikon.
2. Legg hele fraser inn i `VERBS` i `step-words.ts`, i preteritum og presens. Bruk `{target}` for sti, navn eller annet innhold, slik at oversetterne kan flytte det i setningen.
3. La `summary` i serveren gi det som står etter verbet: en sti, et mønster, en kommando eller et navn. Ikke et helt utsagn.
4. Gi resultatet en kort form i `resultOf` hvis det finnes en naturlig: et antall, en kode eller linjer inn og ut.
5. Sjekk at steget leses greit i én linje på 360 px.
