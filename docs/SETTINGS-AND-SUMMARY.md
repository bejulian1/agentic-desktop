# Innstillinger og Kode-sammendrag

De fire tidligere sidene er samlet til to fra v0.15.0:

- **Konfigurasjon:** grunn-harness, modellkontekst, én redigerbar global AGENTS.md med sikkerhetskopiert tilbakestilling, globale/prosjektvise innstillingsfiler og forhåndsvisning av systemprompten. Hoppknappene øverst går direkte til seksjonene.
- **Personalisering og minner:** velg Chat eller Kode inne på siden. Chat har egne instruksjoner, profil, tone, kontekst og minner. Kode har globale og prosjektvise minner. Ulagrede tekstutkast beholdes ved bytte av denne velgeren. Eksisterende innganger til de gamle sidene åpner riktig samleside.

Chat-feltene «Systeminstruks» og «Om deg» har hver sin grense på **10 000 ord**, regnet som tekststykker skilt med mellomrom, tabulator eller linjeskift. Feltet viser ordtelling. Over grensen beholdes utkastet, men Lagre er deaktivert. Serveren håndhever samme grense og avviser uten å endre lagrede verdier. En ekstra størrelsesgrense på 200 000 tegn per felt avgrenser uvanlig lange enkeltord. Tilbakestilling av systeminstruksen beholder profil og minner. Chat-tilpasninger injiseres ikke i Kode.

«Ekstra høy» ligger mellom Høy og Maks i innsatsvelgeren for demo, Anthropic og OpenRouter. Andre OpenAI-kompatible endepunkter beholder den konservative Lav/Middels/Høy-skalaen. OpenRouter får valgt nivå i `reasoning.effort`, slik at Ekstra høy ikke lenger reduseres til Høy. Tilgjengelig effekt avhenger av modellen. Protokollreferanser: [OpenRouter](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), [Anthropic](https://platform.claude.com/docs/en/build-with-claude/effort).

I **Kode** ligger «Festet sammendrag» som en nåleknapp øverst til høyre. Kortet viser prosjekt, registrerte filendringer med linjetall, underagenter i tråden og aktive terminaler i prosjektet. Detaljene inneholder mål, plan, kilder, kapitler og utdrag fra siste lastede svar. Knappen kan vises/skjules i Kode-innstillingene eller via Vis-menyen. Chat har ikke dette kortet.

Endringsmetadata hentes for hele tråden, også når eldre samtalehendelser ikke er lastet inn. Angrede turer telles ikke. Endringer-panelet kan åpne en slik eldre tur og henter bare diffen for valgt tur. Linjetall summerer registrerte filverktøyendringer gjennom tråden; de er ikke en Git-diff av nåværende prosjekt. Anslag og binærfiler merkes. Vilkårlige shellendringer er fortsatt ikke fanget opp.

Underagenter avgrenses til aktive, ikke arkiverte agentbarn av aktuell tråd. Terminaler eies av prosjektet i dagens terminal-API, og kortet merker dette omfanget. Åpning av kortet starter ingen terminal eller modellkall. Escape og lukkeknappen gir fokus tilbake til nåleknappen. Ved trådbytte og åpning av innstillinger lukkes kortet.
