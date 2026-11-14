# Status

## 0.22.0

**v0.22.0 (bygg 64):** Chat har egne verktøy for ekte nedlastbare Word-, Excel-, PowerPoint-, Markdown-, tekst-, CSV- og JSON-filer. Filkort vises etter verktøysteget. Valgfri Python-analyse kjører isolert uten nettverk, hjemmemappe, API-nøkler eller Kode-prosjektfiler. Standardbiblioteket er tilgjengelig; variabler nullstilles mellom kjøringer, arbeidsfiler beholdes i chat-konteksten. Python er av som standard og krever Python 3/bubblewrap med fungerende isolering. Ingen usikret reservekjøring.

Profilens tokenkalender viser umiddelbart dag og full dato over eksakt tokenantall ved musepekeren. Dag-/ukevisning og aktivitetskart støtter tastatur. Fargenivåer beregnes én gang per datasett.

**Kontroll:** 439 servertester, 12 ulike berørte UI-forløp og typekontroll av server/web/Electron består. Native dokumentnedlasting og Python gjennom utility-prosessen er kontrollert under virtuell skjerm, sammen med oppstart/gjenåpning. Dokumenter er åpnet og visuelt kontrollert via LibreOffice/PDF. Produksjonsavhengighetene har ingen kjente npm-varsler etter kompatible rettinger av underavhengigheter. Ingen ekte nøkler eller betalte modellkall brukes i kontrollene.

Se [Filer og Python i Chat](CHAT-FILES.md) for grenser og avgrensninger. Opplasting/tolkning av eksisterende Office-filer er ikke innført. Dette er ikke en full ytelsessammenligning med forrige produksjonsversjon.

Se [full versjonslogg](PATCHLOG.md) for tidligere versjoner.
