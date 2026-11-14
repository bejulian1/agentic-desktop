# Kontekst til modellen

Innstillinger → Kode-harness og → Chat-personalisering har hver sin gruppe «Kontekst til modellen», med tre brytere. Valgene gjelder fra neste tur og lagres uavhengig for Chat og Kode.

- **Lokal dato og tid** deler ukedag, dato, klokkeslett og tidssone fra maskinen som kjører appserveren. Standard: på.
- **Modell og leverandør** deler den konfigurerte modellens navn/ID, leverandørnavn/-type og endepunkt. Endepunktets innlogging, sti og query utelates. Konfigurerte navn er etiketter; de beviser ikke hvor inferens fysisk kjøres. Standard: på.
- **Omtrentlig posisjon** deler lagret by eller land. Standard: av. Du kan skrive inn et sted selv, eller trykke «Hent fra IP».

IP-oppslaget bruker `https://ipapi.co/json/`, dokumentert på https://ipapi.co/api/. Det er appmaskinen som gjør forespørselen. En fjern nettleserklient, VPN eller proxy kan derfor gi et annet sted enn brukeren faktisk befinner seg. Bare by/land og tidspunkt brukes som kontekst; rå IP og koordinater lagres ikke som posisjon. Ingen oppslag skjer ved oppstart, åpning av innstillinger, en ny melding eller bare ved å slå på bryteren. Ved nettverksfeil kan stedet oppgis manuelt.

Å slå av et valg stopper den automatiske injeksjonen fra denne funksjonen. Det fjerner ikke opplysninger brukeren selv har skrevet i meldinger, minner eller egne instruksjoner. Appens faktiske modus, verktøy, bildebegrensninger og tillatelsesnivå beskrives fortsatt, slik at modellen har riktige rammer.

Kode-harness sin forhåndsvisning følger de lagrede valgene for valgt modus. Midlertidige eller ulagrede endringer legges ikke i prompten. Posisjon er ikke en kontinuerlig skjerm-/sensorfeed og må behandles som omtrentlige kontekstdata.
