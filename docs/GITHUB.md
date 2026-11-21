# GitHub i Agentic Desktop

Åpne **Innstillinger → GitHub** og velg **Bruk GitHub CLI**. Appen bruker den aktive kontoen i GitHub CLI for `github.com`. Hvis du ikke er logget inn, kjør `gh auth login` i en terminal og velg **Sjekk igjen** i innstillingene. Ved frakobling beholder GitHub CLI innloggingen sin.

Du kan også koble til med et personlig tilgangstoken. Gi tokenet lesetilgang til Contents, Issues og Pull requests i repoene du vil åpne. For å se sjekker kan tokenet også trenge lesetilgang til Checks og Commit statuses. For private repoer må kontoen og tokenet ha tilgang. Appen lagrer valget av tilkobling i innstillingene. Et personlig tilgangstoken lagres i appens nøkkelring. GitHub CLI henter sin egen innlogging, og appens server bruker tokenet i minnet når den leser fra GitHub.

## Finn pull requests og issues

Knappene **Pull requests** og **Issues** ligger ved innstillingshjulet i sidefanen. De samme handlingene finnes i den sammenfoldede sidefanen og i kommandopaletten.

Listen viser prosjekter som har en remote på `github.com`. Velg **Alle prosjekter** eller ett prosjekt. Søk etter ord i tittel og beskrivelse, eller skriv et nummer som `#42` for å slå opp det nummeret. Bruk **Sorter** og **Filtre** for å snevre inn listen. Under **Visninger** kan du bytte til en innebygd visning eller lagre søket, filtrene og prosjektvalget med eget navn.

Åpne en rad for å lese beskrivelsen og kommentarene. For pull requests kan du også se grener, gjennomgangsstatus, sjekker og diff for endrede filer. **Start en Kode-tråd** oppretter en tråd i et lokalt prosjekt som peker til repoet og fyller ut meldingsfeltet med tittelen, nummeret og lenken. Du velger selv om og når meldingen sendes. **Åpne på GitHub** åpner saken i nettleseren, der du kan kommentere eller gjøre endringer.

GitHub-lenker til pull requests og issues i Chat og Kode åpnes i appen som standard. Du kan slå av dette under **Innstillinger → GitHub**. GitHub-fanen i panelet til høyre viser fortsatt åpne pull requests og issues for prosjektet du jobber i.
