# Status

## 0.23.0

**v0.23.0 (bygg 65):** visuelle mods og temaer per samtale. Modellen kan lage, endre, aktivere, nullstille og fjerne mods i Chat og Kode, også uten prosjekt. Endringer venter til turen er ferdig. Samtykke spørres per samtale; Full tilgang i Kode godtar visuelle endringer automatisk. Et manuelt bibliotekvalg gjelder straks.

Nordlys, Stjernehimmel og Hav følger med. Egne scener har figurer og pikselrader, og små informasjonsfelt kan vise klokke, notat, arbeidsområde eller tokenbruk for siste tur. Farger, kodefarger, tekstbredde og hjørner kan tilpasses. Mørke temaer endrer modus midlertidig; det vanlige lys-/mørkvalget beholdes. Ny samtale følger vanlig utseende når ingen standardmod er valgt.

Palettknappen og Utseende åpner bibliotek/editor. Filer lastes ved endring; ugyldig JSON eller kontrast beholder sist fungerende variant. Deklarative moddata kan ikke kjøre kode eller erstatte appens godkjenninger. Animasjon mellomlagrer pikselfigurer, begrenses til 24 bilder/sekund, følger redusert bevegelse og stopper når bakgrunnen er skjult.

**Kontroll:** 443 servertester, fem berørte UI-forløp og typekontroll består. Samtykke, pixelart, gjenåpning av samme samtale og ny tom oppstart er kontrollert i Electron, sammen med dokumentnedlasting og Python. Testene bruker lokale modellservere, demo og midlertidige data.

Se [Tema og visuelle mods](UI-MODS.md), [versjonslogg](PATCHLOG.md) og README for bruk og format. Inspirasjon er hentet fra Anthropic-dokumentasjonen og brukerens Nordlys-eksempel; Agentic Desktop har sin egen implementasjon.

Se [full versjonslogg](PATCHLOG.md) for tidligere versjoner.
