# Prosjekter, trådmenyer og meldingskø

Prosjektmenyene åpnes med høyreklikk eller ⋯ og kan brukes med piltaster, Enter og Escape. Kode-prosjekter følger mapper på disken. Der finnes blant annet festing, prosjektinnstillinger, **Vis prosjektfiler**, **Kopier prosjektsti**, arkivering av samtaler og fjerning av prosjektet fra appen. Fjerning av prosjektoppføringen sletter ikke prosjektmappen. «Vis prosjektfiler» åpner appens eget filpanel.

Chat-prosjekter samler samtaler og har egne menyer og informasjonskort. De har ingen mappe på disken. Chat-samtaler kan flyttes mellom Chat-prosjekter; Kode-tråder beholder prosjektmappen som tilhører filhistorikken deres.

Informasjonskortene viser riktig navn, modus, antall samtaler og eventuell mappe. De lukkes ved navigasjon, rulling og åpning av Innstillinger. Trådmenyen tilbyr nytt navn, festing, seksjoner, forgreninger, kopiering, lokal Markdown-eksport, nye ruter/vinduer og arkivering/sletting. Eksporten laster ned en fil brukeren kan dele selv.

**Merk som ulest / Merk som lest** finnes i trådmenyen og med Ctrl+Shift+U. Manuelle markeringer lagres i den lokale nettleserprofilen, og blir stående selv om tråden var aktiv da den ble merket. Eksplisitt gjenåpning merker tråden lest igjen.

## Meldinger mens modellen jobber

I **Innstillinger → Generelt → Samtale → Meldinger mens agenten jobber** velges standard for både Chat og Kode:

- **Kø:** vent til den aktive turen er ferdig.
- **Send med en gang:** gi meldingen til den aktive turen ved neste steg, mellom modell-/verktøykall. Et svar som allerede strømmer avbrytes ikke midt i teksten.

Komponistens Kø/Straks-valg endrer også egne ventende vanlige meldinger i den aktuelle tråden. Meldinger fra underagenter og skallkommandoer gjøres ikke om til styringsmeldinger.

Hver egen kømelding har fjerning og en ⋯-meny. Vanlig meldingstekst kan redigeres uten at køplass eller vedleggsnapshot endres. Skills, gjennomganger og skallkommandoer kan flyttes til en sidesamtale for videre redigering; tekstredigering i køen tolker ikke nye slash- eller skallkommandoer.

**Flytt til sidesamtale** tar meldingen ut av køen og lager en ny, usendt sidechat i samme prosjekt/modus. Hovedsamtalens utkast beholdes. Tekst og vedlegg lagres som et gjenopprettbart sideutkast i samme databasetransaksjon som køuttaket. Ingen modell startes av flyttingen. Den opprinnelig flyttede meldingen kan hentes ved åpning også hvis HTTP-svaret mistes; gjenopprettingskopien ryddes først når en egen melding aksepteres. Sen gjenoppretting skal ikke overskrive nyere arbeid.

Køen hentes fra lagret køtilstand, uavhengig av hvor mye samtalehistorikk som er lastet. Hendelsesgrenser og synkroniserte køendringer gjør at et gammelt svar ikke gjenoppliver fjernede eller allerede behandlede meldinger. Redigering og fjerning av meldinger som allerede har forlatt køen avvises, slik at ingen ny modellforespørsel blir laget ved et uhell.
