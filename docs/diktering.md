# Diktering i meldingsfeltet

Åpne **Innstillinger → Modeller og leverandører → Diktering**. Velg en tilkoblet leverandør som støtter `POST /audio/transcriptions`, oppgi talemodellens ID og lagre. For en lokal Whisper-server bruker du en egendefinert OpenAI-kompatibel leverandør med serverens API-basisadresse. Chatmodellen trenger ikke å være fra samme leverandør. Å ha et kompatibelt chat-API betyr ikke i seg selv at tjenesten kan transkribere.

Hvis du ikke har gjort et valg, foreslår appen en konfigurert OpenAI- eller Groq-adresse med henholdsvis `whisper-1` eller `whisper-large-v3-turbo`. Velg **Av** og lagre for å deaktivere diktering.

Trykk mikrofonen, kontroller leverandørnavnet og velg **Ta opp**. Gi mikrofontillatelse hvis nettleseren spør. **Stopp** avslutter opptaket og sender det til den viste leverandøren via den lokale appserveren. Teksten settes inn ved markøren og sendes ikke som melding før du selv trykker Send. Opptaket stopper senest etter fem minutter. Appen lagrer ikke lydfiler, følger ikke videresendinger og prøver aldri en annen leverandør ved feil. Leverandørens egne lagringsvilkår gjelder når du sender lyd dit.
