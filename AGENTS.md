# Agentic Desktop – faste publiseringsinstrukser

## Brukerens instruks

Brukeren ga 14. november 2026 stående tillatelse til å committe og pushe alle nye, ferdigtestede versjoner til det private repoet `bejulian1/agentic-desktop`, med oppdatert versjons-/byggnummer og en tilhørende GitHub Release. Det trengs ikke en ny bekreftelse for hver versjon. Tillatelsen gjelder publisering til dette eksisterende private repoet, ikke endring av synlighet, omskriving av historikk eller andre repoer.

## Ved hver ny appversjon

1. Fullfør endringene og relevante lokale kontroller. Hold tester isolert fra ekte brukerdata og API-nøkler. Følg prosjektets regler for headless Chrome/Electron og prosesshåndtering.
2. Oppdater versjonen i `version.json`, rotens `package.json` og rotoppføringen i `package-lock.json`. Bruk et passende nytt versjonsnummer. Produksjonsbygget øker byggnummeret; ikke øk det en ekstra gang for samme bygg.
3. Oppdater `docs/PATCHLOG.md`, aktuell status/README og skjermbilder når grensesnittet har endret seg. Behold `CHANGELOG.md` som inngang til den fullstendige versjonsloggen og GitHub Releases.
4. Bygg og kontroller installasjonsfilene som faktisk skal utgis. Versjon og bygg i servermetadata, web-metadata og pakken skal samsvare.
5. Gå gjennom publiseringssettet. Ta med appkode, nødvendige byggeskript, brukerdokumentasjon og utvalgte bilder i `docs/bilder/`. Hold testpakker, interne kontrollnotater, brukerdata, nøkler, logger, node_modules og lokale byggeartefakter utenfor Git-commiten. Ikke fjern andre utvikleres arbeid.
6. Commit og push normalt til repoets standardgren etter kontroll av siste fjernstatus. Ikke force-push, omskriv publisert historikk eller flytt eksisterende versjonstagger. Behold privatstatus. Bruk et midlertidig checkout hvis lokal Git-metadata er skrivebeskyttet eller checkoutet har arbeid som ikke skal publiseres.
7. Opprett `v<versjon>` på den kontrollerte kildecommiten. Publiser en GitHub Release med forståelige versjonsnotater, AppImage, deb, SHA256SUMS, full versjonslogg og RELEASEINFO.json. Metadataene skal inneholde riktig versjon, bygg, plattform og kildecommit. Last gjerne opp som utkast først; verifiser filstørrelser og SHA-256 før publisering.
8. Bekreft at fjerncommiten, utgivelsen og vedleggene stemmer. Oppsummer versjon, bygg, kontroll og lenke til Release.

Små dokumentasjonsendringer trenger ikke en ny appversjon eller ny binærutgivelse. Ikke lov at kontroller eller publisering er fullført før de faktisk er det. Installer på brukerens PC bare innenfor tidligere gitt installasjonstillatelse og etter sikkerhetskopi og relevante kontroller.

## GitHub Packages og kreditering

OCI-jobben i `.github/workflows/publish-package.yml` kan publisere samme installasjonsfiler privat i GHCR etter en Release, når GitHub har gitt nødvendige rettigheter. Manglende rettigheter skal forklares konkret; ikke omgå godkjenning, lagre token i repoet eller hevde at en pakke finnes før publiseringen er verifisert. En manglende Packages-rettighet hindrer ikke vanlig commit/push og Releases.

Behold eksisterende Claude-kreditering og CREDITS.md. Bruk en korrekt Co-authored-by-linje på faktisk Codex-assistert arbeid. GitHubs Contributors-graf bestemmes av GitHub; kreditering skal ikke fabrikeres eller få historikken omskrevet for å påvirke grafen.
