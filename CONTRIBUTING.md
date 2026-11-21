# Contributing to Agentic Desktop

Thank you for your interest in contributing to Agentic Desktop.

## Getting Started

### Prerequisites

- **Linux** (developed and tested on Ubuntu 26.04 with GNOME)
- **Node.js 26+** and npm
- Native build tools for `node-pty`: `g++`, `make`, and `python3` (`sudo apt install build-essential python3`)
- Server and UI integration tests need `ripgrep`, `bubblewrap` with working user namespaces, and Google Chrome. The Electron test runner also needs `xvfb-run` and `xauth` (`sudo apt install xvfb xauth`).

### Setup and Run

The repository is private. You need GitHub access to clone it.

```bash
git clone https://github.com/bejulian1/agentic-desktop.git
cd agentic-desktop
npm ci
```

`npm start` builds the UI if needed and uses port `4317` by default. For development alongside the installed app, use temporary data and config, an in-memory keyring, and a free port:

```bash
dev_root=$(mktemp -d)
HOME="$dev_root" XDG_CONFIG_HOME="$dev_root/config" XDG_DATA_HOME="$dev_root/data" \
  AD_DATA_DIR="$dev_root/app" AD_KEYRING=memory AD_PORT=0 npm start -- --no-open
```

Open the local URL printed by the server. Press Ctrl+C to stop it before removing the temporary directory. A production UI build increments the build number; do not include that generated change in a contribution.

### Running Checks and Tests

The harnesses use temporary data and local fake models. Under `node --test` the keyring defaults to memory; the Secret Service integration test uses a dedicated temporary D-Bus session when its dependencies are available. **Never use real API keys, real user data, or paid model calls in tests.**

| Command | What it runs |
| --- | --- |
| `npm run typecheck` | Type-checks `server/`, `web/`, and `desktop/` with `tsc` |
| `npm run test:server` | Server unit and integration tests (`server/test/*.test.ts`) |
| `npm run test:ui` | End-to-end UI tests (`web/test/*.test.ts`) |
| `npm run test:desktop` | Electron desktop tests (`desktop/test/*.test.ts`) |
| `npm test` | Runs `npm run typecheck` and `npm run test:server` |

Run `npm run build` before the UI suite so `web/dist/` includes build metadata. The desktop runner builds the UI separately, removes `WAYLAND_DISPLAY`, and runs under Xvfb; do not launch Electron directly on a shared display. If npm did not download the Electron binary, run `node node_modules/electron/install.js` first. Tests of the packaged app need `npm run dist` before running the full desktop suite.

You can also run a single test file directly with Node:

```bash
node --test server/test/commands.test.ts
node --test web/test/66-browser-open-external.test.ts
node scripts/test-desktop.ts desktop/test/27-nettleser-standardnettleser.test.ts
```

## Project Layout

- `server/` — Local Node.js server (HTTP/WebSocket API, SQLite storage, agent runner, tools, providers, MCP client, hooks)
- `web/` — SolidJS + Vite frontend (CodeMirror 6, xterm.js, artifact preview)
- `shared/` — Shared TypeScript protocol types and data schemas (`protocol.ts`, `mcp.ts`, `hooks.ts`, `ui-mods.ts`)
- `desktop/` — Electron main/preload process, native browser views, tray icon, and AppArmor profile
- `skills/` — Built-in slash-skills (`skills/<name>/SKILL.md`)
- `docs/` — Specifications, feature guides, status notes, and screenshots
- `scripts/` — Build, packaging, local install, and test scripts

## Coding Conventions

- **Direct TypeScript on Node:** Server code and scripts use ESM TypeScript executed directly by Node 26+. Use explicit `.ts` extensions in imports handled directly by Node; follow the existing frontend import conventions in `web/`.
- **Frontend:** SolidJS components in `web/src/`, built with Vite.
- **Language:**
  - **Code comments and identifiers:** Write comments in English. Favor readable, direct code with concise comments explaining *why* non-obvious decisions, invariants, or security boundaries exist.
  - **UI text:** Use Norwegian Bokmål, matching the existing UI.
- **Dependencies:** Keep external dependencies minimal and justified.

## Writing a Skill

Built-in skills live in `skills/<name>/SKILL.md`. Custom skills use the same layout under a Code project's `.agentic/skills/` or under `~/.config/agentic-desktop/skills/` (or the corresponding `XDG_CONFIG_HOME`). Chat projects only offer built-in skills that support Chat. Each skill is one Markdown file with frontmatter:

```markdown
---
name: my-skill
description: Short description shown in the slash-command menu.
args: "[optional argument hint]"
mode: code
---
Instructions the model follows when this skill is invoked.
User arguments are substituted verbatim into {{args}}.
```

- `name` and `description` are required.
- `args` is optional and shown as a hint in the `/` menu.
- `mode` is optional (`code` or `chat`); omit it to make the skill available in both modes.
- Built-in skills currently use Norwegian descriptions (for the UI menu) and English instructions (for the model).
- See [docs/SLASH-SKILLS.md](docs/SLASH-SKILLS.md) for the full specification.

## UI translations

Write whole Bokmål phrases, then add their translations to all 11 catalogs in extractor order. Remove replaced keys and run `npm run i18n:check -- --strict`. Ask in a draft PR for help with languages you do not know; all catalogs must be complete before merge. See [the translation guide](docs/I18N.md).

## Branch and Pull Request Flow

1. Create a feature or fix branch from `main` (for example `feat/my-feature`, `fix/bug-name`, or `docs/topic`). Fork first if you have private fork access and are not working directly in the repository.
2. Keep pull requests focused on one change. Avoid unrelated formatting or refactoring.
3. Run `npm run typecheck` and `npm run test:server` before opening a PR. For frontend or desktop changes, also run the relevant UI or Electron tests.
4. Do not modify `version.json`, package versions, or release artifacts in regular feature/fix PRs—releases are handled separately.
5. Open a pull request against `main` and fill out the PR template.

## Commit Messages

Use clear, concise commit messages that describe *what* changed and *why*. Short prefixes such as `feat:`, `fix:`, `docs:`, `test:`, or `chore:` are encouraged.

## AI-Assisted Contributions

AI-assisted contributions are welcome. However, **you are responsible for every line you submit**:

- Review and understand all generated code before opening a PR.
- Test your changes locally and verify that all relevant tests pass.
- Do not submit unverified or low-effort AI-generated PRs.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
