# Git, versjonslogg og verktøy i v0.20

Velg et prosjekt i Kode. Tannhjulet til høyre for prosjektbrikken ved meldingsfeltet har **Gren** og **Nytt arbeidstre**. Samme funksjoner finnes under Innstillinger → Git. `/worktree` åpner oppretting. Git må være installert, og repoet må ha en første commit; en vanlig mappe får forklaring uten å bli initialisert automatisk.

Grenlisten viser lokale grener og hvilket arbeidstre de brukes i. Oppretting kan starte fra HEAD eller en lokal gren. Eksisterende grener kan byttes til når arbeidsmappen er ren. En gren som allerede brukes i et annet arbeidstre kan åpnes der. Arbeidstrær får som standard ny mappe ved siden av repoet, under `.agentic-worktrees`; du kan velge en annen ny absolutt sti. Et arbeidstre inneholder lagrede commits, ikke ucommittede endringer fra originalmappen. Et prosjekt som peker på en undermappe beholder denne relative undermappen når den finnes i det nye arbeidstreet.

Et nytt arbeidstre registreres som et eget prosjekt, med «Be om godkjenning» som standard. Opprinnelige tråder og filer blir i originalprosjektet. Eksisterende arbeidstrær kan også åpnes fra listen. Ingen automatisk stash, commit, push, remote-henting, tvunget grenbytte eller sletting er innført. Skitne arbeidsmapper sperrer grenbytte. Pågående modellarbeid i samme Git-repo, også i andre arbeidstrær, sperrer Git-endringer. En lås hindrer samtidige apphandlinger og ny modellstart mens en Git-handling pågår. Uavhengige eksterne Git-prosesser/terminaler er ikke låst av appen.

Git startes med argumentliste uten skall, uten hooks/fsmonitor og uten interaktiv innlogging. Resultater og kjøretid begrenses. Det er lokale handlinger uten nettverk; dette er ingen OS-sandkasse. Filvisning og greninformasjon oppfriskes etter appens grenbytte. Historiske endringskort fra en samtale forblir den samtalens filverktøyhistorikk, ikke en ny Git-diff av hele arbeidstreet.

Profilmenyen nederst har **Versjonslogg** med alle oppføringer fra den medfølgende PATCHLOG.md. Søk finner både versjonsnavn og endringstekst, og oppføringer kan foldes ut. «Hva er nytt» under Hjelp viser fortsatt de tre siste. Historikken leses lokalt, trenger ingen API-modell og inneholder bare endringer som er dokumentert i pakken.

## Verktøy og annotering

Pluss i felles topprad kan lage flere startfaner. Et verktøyvalg bruker den valgte startsiden; andre startfaner og økter beholdes. Filer og Endringer er fortsatt én visning per verktøy, mens nettlesersider og terminaler har egne økter. Innstillingen Utseende → Pluss i sidepanelet velger verktøystartside eller direkte nettleserfane. Startfanene er minnelagret; serverøktene har sin eksisterende levetid.

Annoter fryser nettsiden og bruker standardverktøyet Element. Hold over et element for tagg, dimensjoner, farge og skrift, og klikk for å kommentere. Ferdig legger bildet og kommentarene i riktig samtaleutkast uten sending. Klikk, penn, rektangel og tekst finnes fortsatt. Navigasjon/lukking hindrer sen levering til feil utkast.

DOM-metadata hentes bare fra synlige elementer i hoveddokumentet. Skjemaverdier, redigerbare felt, skript og skjult tekst utelates fra metadataene. Selve skjermbildet kan fortsatt vise det brukeren ser; gjennomgå det før sending. Inspector følger ikke underdokumenter eller shadow DOM og er et øyeblikksbilde. Dersom DOM-inspeksjon ikke kan hentes, brukes bildeannotering med en forklaring.

Meldingsvedlegg kan rulles horisontalt med hjul, pekeplate eller tastatur når raden har fokus. Pilene/Home/End flytter raden; vedleggsknappene beholder sine egne handlinger.

## Kodeutseende og nøkkellagring

Kode-innstillingene samler lyse/mørke kodepaletter, installert monospace-skrift, størrelse, tabulatorbredde, linjebryting og standard samtalevisning. Forhåndsvisning viser både kode og grønne/røde endringer. Tenkning åpner tenkerader som standard; Detaljert åpner også verktøyinformasjon. Brukeren kan fortsatt folde enkeltrader manuelt. Innstillingen er ikke en instruks om å endre modellens resonneringsnivå. Chat beholder sin egen visning.

Leverandørsiden viser systemnøkkelring, øktminne eller eldre migreringsfil. Nye nøkler skrives ikke til en klartekstreserve dersom nøkkelringen mangler eller er låst. En eventuell eldre keys.json beholdes ved mislykket verifisert migrering og varsles. Kontrollene bruker midlertidig privat GNOME-nøkkelring og lokale prøveservere. Ingen ekte modellkall er gjort. Brukerens vellykkede OpenRouter-test med 436 modeller er grunnlaget for å fjerne Beta der; andre leverandører er ikke erklært ekte API-testet.
