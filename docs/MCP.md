# MCP-servere

MCP (Model Context Protocol) lar modellen bruke verktøy fra andre programmer, for eksempel GitHub eller en nettleser som styres av Playwright. Du legger dem til i **Innstillinger → MCP-servere**. Skriv **/mcp** i meldingsfeltet for å komme dit.

Appen kobler til serverne som er slått på når den starter. Det skjer i bakgrunnen, så en treg eller ødelagt server holder aldri igjen oppstarten. Verktøyene får modellen i **Kode**, og i **Chat** hvis du slår det på for serveren. Hvert verktøy heter `mcp__<server>__<verktøy>` hos modellen, for eksempel `mcp__github__get_me`.

`<server>` er serverens **kortnavn**. Appen lager det av navnet når du legger til serveren, for eksempel `github`, eller `github2` hvis `github` er tatt. Kortnavnet endres bare når du gir serveren nytt navn. Det endres ikke når andre servere legges til, fjernes eller flyttes. Kortnavnet står på serveren i listen. Bruk det i hooks, for eksempel med verktøyfilteret `mcp__github__*`.

## Legg til GitHub

1. Lag et personlig tilgangstoken (PAT) på GitHub med de tilgangene du vil gi modellen. Et finkornet token med bare lesetilgang til noen få repoer er tryggest.
2. Velg **GitHub** under **Legg til server**. Adressen blir `https://api.githubcopilot.com/mcp/`, og det står en tom hemmelig `Authorization`-header klar.
3. Lim inn tokenet i `Authorization`. Skriver du bare tokenet, legger appen til `Bearer ` foran.
4. Trykk **Lagre og koble til**.

Vil du bare lese, bytter du adressen til `https://api.githubcopilot.com/mcp/readonly`. GitHub har også egne adresser for ett verktøysett, for eksempel `https://api.githubcopilot.com/mcp/x/issues`. Se GitHubs dokumentasjon for github-mcp-server.

GitHub-serveren har mange verktøy. Slå av dem du ikke trenger under **Verktøy** på serveren (se **Grenser** under).

## Legg til Playwright

1. Velg **Playwright**. Kommandoen blir `npx`, med argumentene `-y`, `@playwright/mcp@latest`, `--headless` og `--isolated`.
2. Trykk **Lagre og koble til**.

Første gang laster `npx` ned pakken. Det kan ta et par minutter, og kanskje må Playwright også laste ned en nettleser. `--headless` gjør at det ikke åpnes noe vindu på skjermen. `--isolated` holder nettleserprofilen i minnet, så ingen innlogginger lagres. Fjern `--headless` hvis du vil se nettleseren.

## Egen server

**Egen server** gir et tomt skjema med to typer tilkobling:

- **Kommando (stdio):** appen starter programmet og snakker med det over stdin og stdout. Skriv kommandoen, ett argument per linje og eventuelle miljøvariabler. Serveren får appens vanlige miljø uten API-nøkler, pluss sine egne variabler. Den starter i hjemmemappen din.
- **Adresse (HTTP):** en server med Streamable HTTP. Adressen må bruke `https`. Bare adresser på denne maskinen (`localhost` og `127.0.0.1`) kan bruke `http`. Du kan legge til egne HTTP-headere.

**Legg hemmeligheter i en hemmelig header, ikke i adressen. Adressen lagres og vises i klartekst.** Det gjelder for eksempel en nøkkel i `?api_key=` eller i selve stien.

## Godkjenning

MCP-verktøy regnes som kommandoer. I Kode følger de prosjektets tillatelser:

- **Spør** og **Godta redigeringer**: appen spør før hvert kall. **Tillat alltid** gjelder det ene verktøyet i det ene prosjektet.
- **Full tilgang**: verktøyene kjører uten å spørre.

I Chat spør appen før hvert kall. **Tillat alltid** gjelder resten av samtalen og glemmes når appen lukkes.

Setter du **Godkjenning** til **Automatisk** på serveren, kjører verktøyene uten å spørre, også i Chat og i modusen Spør. Gjør det bare for servere du stoler på. Appen hopper aldri over godkjenning fordi en server sier at et verktøy bare leser (`readOnlyHint`). Det er serveren som sier det, og det kan være feil.

I planmodus får modellen ingen MCP-verktøy, og et kall til et MCP-verktøy blir avvist.

Godkjenningene hører til serveren. Hvis du sletter en server eller gir den nytt navn, slettes «Tillat alltid» for verktøyene dens i alle prosjekter. Det samme gjelder tillatelser i Chat. En ny server med samme kortnavn starter derfor uten tillatelser. Hooks som du har laget selv, endres ikke. Et filter som `mcp__github__*` gjelder den serveren som har kortnavnet `github` nå.

## Hemmeligheter

Kryss av **Hemmelig** for verdier som tokener og passord. Hemmelige verdier lagres i systemets nøkkelring, slik som API-nøklene. De lagres aldri i klartekst på disk, og appen sender dem aldri tilbake til grensesnittet. Et tomt hemmelig felt betyr «behold verdien som er lagret». Variabler og headere med navn som `TOKEN`, `SECRET`, `API_KEY` eller `Authorization` blir alltid hemmelige.

Appen sender hemmeligheten bare til serveren den hører til: som miljøvariabel til en stdio-server, eller som header til en HTTP-server. Den kommer aldri i logger, tråder, prompter eller i miljøet til andre programmer appen starter. Hvis serveren gjentar hemmeligheten i et svar, en feilmelding eller i stderr, viser appen `[skjult]` i stedet. Sletter du serveren, slettes hemmelighetene fra nøkkelringen.

Appen følger ikke videresendinger fra en HTTP-server. Da kan ikke en header med token havne hos en annen adresse.

## Svar fra serverne

Tekst blir resultatet av verktøykallet. Lange svar kuttes som for appens egne verktøy. Det første bildet i et svar legges ved hvis det er PNG, JPEG, GIF eller WebP og under omtrent 1,5 MB. Andre bilder, lyd og ukjente innholdstyper blir en kort merknad. Modellen får beskjed om at svar og beskrivelser fra MCP-servere er data fra en ekstern kilde, ikke instruksjoner.

## Status og feil

Hver server har en statusprikk: grå er av, gul kobler til, grønn er tilkoblet og rød er feil. Under står en kort forklaring. For stdio-servere viser **Utdata fra serveren** de siste linjene serveren skrev til stderr. **Koble til på nytt** starter tilkoblingen på nytt.

Hvis en stdio-server krasjer etter at den var tilkoblet, starter appen den igjen etter 1, 5 og 20 sekunder. Etter tre forsøk må du trykke **Koble til på nytt**. Hvis en HTTP-økt utløper, kobler appen til på nytt én gang og prøver kallet én gang til. Flere kall som merker det samtidig, venter på den samme nye tilkoblingen.

Over HTTP kan en server avslutte svaret før resultatet er kommet. Hvis hendelsene hadde id, henter appen resten med `Last-Event-ID`. Den venter så lenge serveren ber om (`retry`), men høyst 10 sekunder, og prøver opptil tre ganger. Ellers feiler kallet med en gang med en forklaring, så du slipper å vente til tidsgrensen.

Appen åpner også strømmen serveren kan sende varsler på, for eksempel at verktøylisten er endret. Hvis serveren eller en mellomtjener stenger den, åpner appen den igjen etter 1, 5, 15, 30 og 60 sekunder, og så gir den opp. En ny tilkobling henter verktøylisten på nytt uansett. Hvert kall har en tidsgrense, normalt 120 sekunder, som du kan endre per server. Når tiden går ut eller du trykker Stopp, får serveren beskjed om at kallet er avbrutt.

Når du slår av eller sletter en server, eller lukker appen, stopper appen serveren og alt den har startet, for eksempel nettleseren til Playwright.

Hvis innstillingene for en server i databasen ikke kan leses, for eksempel etter en eldre versjon, slettes den ikke. Den vises som en server med feil og en forklaring. Rediger og lagre den for å rette den, eller slett den. Hemmelighetene i nøkkelringen blir liggende til da.

## Grenser

- Én tur får høyst **60 MCP-verktøy** til sammen, fra alle serverne. Dette er fordi verktøybeskrivelsene tar plass i modellens kontekstvindu. Får serverne flere verktøy enn det, sier siden fra, og verktøyene over grensen merkes **Over grensen**. Slå av verktøy du ikke trenger, så får modellen dem som gjenstår. Rekkefølgen følger serverlisten.
- Beskrivelsene kuttes til 600 tegn.
- Opptil 30 servere og 50 miljøvariabler eller headere per server.

## Dette støttes ikke ennå

- Ressurser, prompter, sampling, roots og elicitation fra MCP. Appen bruker bare verktøy.
- Den gamle HTTP+SSE-transporten fra 2024-11-05. Bruk stdio eller Streamable HTTP.
- Servere som bare kan MCP-versjonen 2026-07-28 (uten `initialize`). Appen bruker 2025-11-25 og godtar 2025-06-18, 2025-03-26 og 2024-11-05. En slik server gir en tydelig feilmelding.
- OAuth-innlogging. Bruk et token i en header.
- MCP-verktøy i Kode uten prosjekt (Denne datamaskinen).
