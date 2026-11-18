# Instanser, underagenter og lesestatus

I Kode med et prosjekt kan modellen starte underinstanser med egne oppgaver. De deler prosjektmappen, får sin egen samtale og kan bruke `thread_list`, `thread_create`, `thread_send`, `thread_read` og `thread_wait`. Underinstansen arver modell, tenkeinnsats ved samme modellvalg og den effektive tillatelsesgrensen. Velger agenten en annen modell, brukes den modellens standardinnsats. Ingen underinstans får høyere tilgang enn den som laget den.

Sidefeltet viser underinstansen under forelderen med en forbindelsesstrek. Når listen forkortes, beholdes foreldrekjeden til aktive, kjørende og ventende instanser. Flyttes en instans til Festet eller en egen seksjon, vises den i den gruppen; foreldre dupliseres ikke mellom gruppene. Team-panelet viser prosjektets instanser og meldinger.

## Meldinger begge veier

Instanser i samme Kode-prosjekt kan sende meldinger til hverandre, også tilbake til forelderen. Modellkonteksten viser avsenderens navn og tråd-ID, og instanslisten oppgir foreldre-ID. Hver ny underagent trenger en selvstendig oppgavebeskrivelse; den får ikke automatisk hovedsamtalens historikk.

Meldinger til en opptatt sidestilt instans ligger i kø. Et svar fra et barn til en aktiv forelder eller annen aktiv forfar tas inn ved neste steg. En pågående `thread_wait` slipper fram den innkommende meldingen, uten å hevde at barnet er ferdig. Et verktøy som allerede kjører, avbrytes ikke. Allerede startet parallell lesing fullføres; ustartede kall fra det gamle modellsvaret legges til side før den nye instruksjonen vurderes.

Opptil fire agentstartede kjøringer eller reserverte mottakere arbeider samtidig per prosjekt, og underagenter kan opprettes i høyst to nivåer. Barn kan svare en aktiv forelder selv når fire hjelpere jobber. Hvis forelderen feiler før svaret blir behandlet, beholdes meldingen i kø til det finnes kapasitet. Stopp, Stopp alle og arkivering hindrer at ventende meldinger starter en ny kjøring; meldingen beholdes synlig. Grensen på 20 meldinger mellom instanser per brukerinitiert meldingskjede krever godkjenning for mer arbeid. Prosjektgrenser og vanlige verktøygodkjenninger gjelder fortsatt.

## Ikonet under sendte meldinger

Nye meldinger i Kode viser «Ikke bekreftet lest» fram til modellen begynner å svare med meldingen i konteksten. Da vises et øyeikon og «Lest av modellen». Dette er et praktisk mottakssignal fra modellresponsen, ikke bevis for at modellen har forstått alle detaljer. Et etablert nettverkskall eller en melding i kø er ikke nok til å utløse ikonet.

Kvitteringen bevares ved gjenåpning. Meldinger blokkert av en hook eller avbrutt før kontrollen er ferdig, får egen status. Eldre historikk uten kvitteringshendelser får ingen oppdiktet bekreftelse. En melding som ikke fikk modellrespons før feil eller stopp, kan forbli uten bekreftelse. Brukerens `!`-kommandoer får ingen lesekvittering.

## Nye kommandosnarveier

| Kommando | Virkning |
|---|---|
| `/agents` eller `/agenter` | Åpner Team-panelet med prosjektets instanser. |
| `/diff` eller `/endringer` | Åpner panelet for filendringer. |
| `/context` eller `/kontekst` | Viser tokenfordeling mellom samtale, system, verktøy, reserve og ledig plass; anslag merkes. |
| `/stop` eller `/stopp` | Stopper bare denne samtalens kjøring eller ventende arbeid. |

`/agents` og `/diff` krever et Kode-prosjekt. `/context` krever en eksisterende samtale og fungerer også i Chat. Snarveiene utføres i appen uten en ny modelltur. `/btw`, `/background`, `/queue` og `/steer` er beskrevet i [Sidespørsmål og bakgrunnsøkter](SIDE-QUESTIONS.md).

## Videre kommandovalg

Gjennomgått 16. november 2026 mot [Claude Codes kommandoreferanse](https://code.claude.com/docs/en/commands), [interaktiv modus](https://code.claude.com/docs/en/interactive-mode) og [Aiders kommandoer](https://aider.chat/docs/usage/commands.html). Dette er inspirasjon til Agentic Desktops egne funksjoner; kommandoer med samme navn kan ha ulik virkning i andre apper.

De fire snarveiene over prioriteres fordi funksjonene allerede finnes og er nyttige mens agenten jobber. `/model`, `/reasoning`, `/plan`, `/compact`, `/review-changes`, `/worktree`, `/mcp` og `/status` finnes fra før.

Nyttige kandidater for en senere runde er `/test` med prosjektets validerte testkommando, `/permissions` som åpner eksisterende tillatelsesvalg, og `/export` for samtaleeksport. Disse er forslag, ikke tilgjengelige kommandoer i denne versjonen. `/test` må vise hva som skal kjøres og beholde vanlige godkjenninger. En egen kommandosnarvei for spørsmål til brukeren bør bygges på et faktisk spørsmål/svar-verktøy med svaralternativer og fritekst.
