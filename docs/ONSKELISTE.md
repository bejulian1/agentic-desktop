# Tidlig ønskeliste for kommandoer

Dette er en historisk plan, ikke en liste over tilgjengelige kommandoer. Se [kommandoguiden](SLASH-SKILLS.md) for det som virker i appen.

|                |                                                                                         |
| -------------- | --------------------------------------------------------------------------------------- |
| `/approve`     | Approve one retry of a recent automatic-review denial, when automatic review is active. |
| `/compact`     | Compact the current chat’s context.                                                     |
| `/fork`        | Copy a local chat into a new local chat or worktree.                                    |
| `/goal`        | Set a persistent goal; use /plan first when the outcome needs shaping.                  |
| `/ide-context` | Turn shared IDE context on or off.                                                      |
| `/init`        | Generate an AGENTS.md scaffold for the current project.                                 |
| `/local`       | Run the chat in the selected local project.                                             |
| `/mcp`         | Open MCP status to view connected servers.                                              |
| `/memories`    | Configure memory behavior, when available.                                              |
| `/model`       | Choose the model for the current chat.                                                  |
| `/personality` | Choose a response personality, when supported.                                          |
| `/plan`        | Toggle plan mode for multi-step planning.                                               |
| `/project`     | Choose a project for new chats.                                                         |
| `/reasoning`   | Choose the reasoning effort for the current chat.                                       |
| `/review`      | Start code review mode.                                                                 |
| `/side`        | Start a temporary side chat without interrupting the main chat.                         |
| `/status`      | Show chat ID, context usage, and rate limits.                                           |
| `/task`        | Start a chat without a project.                                                         |
| `/worktree`    | Run the chat in a new Git worktree.                                                     |

Mulighet til å bruke @ tegn for filer og $ for skills

Hva sidepanelet i kan gjøre med en (+) knapp øvert, knapp til å slå av og på festet sammendrag 
øvert til venstre to piler fram og tilbake knapper, lukke og åpne side panel til chatter og 4 text knapper til: Fil Rediger Vis Hjelp

- **Filer og endringer:** Se gjennom prosjektfiler, spor endringer og foreta kodegjennomgåinger direkte i grensesnittet.

- **Innebygd nettleser og terminal:** Kjør terminalkommandoer og gjør research i et integrert nettleserpanel uten å bytte vindu. 

- **Sesjonshåndtering:** Organiser lokale Codex-sesjoner og fortsett dem direkte i verktøyet eller via utvidelser som

- **Tilpasning:** Juster bredden på nettleser- og sidepanelet etter behov.
--
Mulighet til å gjøre dette:**Metoder for å kjøre flere instanser parallelt:**

- **Flere terminalvinduer eller faner:** Du åpner flere faner i terminalen, navigerer til prosjektet (eller ulike Git-grener) og skriver `Modeller` i hver fane.
- **Git Worktrees:** For å unngå at instansene krasjer med hverandre i samme kodebase, bruker utviklere ofte `git worktree` slik at hver instans jobber på sin egen fysiske gren og mappe.
- **Terminalverktøy som tmux eller screen:** Lar deg dele opp én terminalskjerm i flere ruter eller paneler samtidig.
- **Bakgrunnsinstanser  Du kan starte en sesjon i bakgrunnen med , som gjør at den jobber uten å låse opp terminalvinduet ditt.
- **Eksperimentelle Agent Teams:** Mulighet for en funksjon der en "teamleder"-instans koordinerer flere underliggende agenter via delte oppgavelister. 
Mulighet for dette i applikasjonen: **bruker to hovedmapper** for å organisere prosjekter, innstillinger og minne: ==den **globale konfigurasjonsmappen** i din brukermappe, og en **prosjektspesifikk mappe** i roten av hvert enkelt kodeprosjekt==

Kan liksom velge en mappe på PC-en så skal den komme opp i sidepanelet høyere side, med de valige customize instillinger, der trykker på (+) i den prosjeket og lager instans i prosjeket. kan også endre prosjekt mappe sendre, instanser kan snakke sammen eller lage nye sub instanser medkobling til hovedinstansen 

Instillinger i applikasjonen kan inneholde: Main Desktop Settings Categories

- **General & Appearance:** Customize app preferences, theme/skin boundaries, and window behavior (such as keeping a chat window _Always on top_). 
  
**Desktop App Settings:** Open the Codex desktop app, click **Settings**, and go to **Profile** to review your token activity, lifetime tokens, peak tokens, and usage streaks.

 
- **Personalization & Memories:** Edit machine-level instructions in `AGENTS.md` and toggle cross-chat **Memories**. 

- **Profile & Keyboard Shortcuts:** View token usage insights, update your profile card, or inspect and rebind keyboard shortcuts. 
---

  * Builtin browser mulighet til testing av applikasjoner/ playwrite. 
  * Mulighet for headless chrome / headless application spill testing f.eks headless sodium Minecraft.

*  mulig het for å laste ned ==**bruker verktøyet `cua-driver` for å styre  Linux-skrivebord i bakgrunnen uten å kapre den fysiske musepekeren din**==**.** Dette gjør at du kan fortsette å bruke PC-en uforstyrret mens kunstig intelligens utfører oppgaver for deg.
