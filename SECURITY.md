# Security Policy

## Supported Versions

Security fixes land on `main`. Install the latest release for packaged fixes; older releases are not maintained separately.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Older releases | No |

## Reporting a Vulnerability

Please do **not** report security vulnerabilities through public GitHub issues.

If GitHub offers [private vulnerability reporting](https://github.com/bejulian1/agentic-desktop/security/advisories/new) for your account, use that form. Otherwise contact the maintainer privately through an existing channel. If you have no private contact channel, open an issue asking the maintainer to arrange one; do not include vulnerability details, credentials, or logs in that issue.

Once you have a private channel, include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce or a proof of concept.
- Affected version and Linux environment details.

The maintainer will review the report, confirm the issue, and coordinate a fix before public disclosure.

## Security Model Summary

Agentic Desktop is a local-first Linux application. Its security boundaries are designed around the following principles:

- **Local execution boundary:** The local Node server binds to loopback (`127.0.0.1`) and requires per-session authentication for API and WebSocket access.
- **Secrets in the system keyring:** Provider API keys, GitHub tokens, and secret MCP headers/environment variables are stored in the system keyring (Secret Service / GNOME Keyring via `libsecret`) when available, or kept in session memory only. Secrets are never sent back to the frontend, excluded from spawned command/hook environments, and redacted if echoed in MCP output.
- **Approvals and protected paths:** Agent file writes, edits, shell commands, and MCP tool calls follow the thread's permission mode (`Ask`, `Accept edits`, or `Full access`). Sensitive paths—such as `.env*`, `.git/hooks`, `.git/config`, the app's own data/config directories, and sensitive home directories (`.ssh`, `.gnupg`, `.aws`, browser profiles, keyrings, etc.)—always require explicit approval and cannot be permanently auto-approved.
- **Command guardrails vs. OS sandboxing:** Shell commands run by the coding agent execute as the current user. The protection against commands referencing sensitive paths or the app's data directory is a best-effort text check, not an OS sandbox. Use `Ask` or `Accept edits` in untrusted repositories.
- **Isolated execution where supported:** Optional Chat Python analysis runs inside `bubblewrap` without network access, home directory access, or host secrets. HTML and React artifacts render in an isolated local sandbox.
- **External MCP servers and hooks:** MCP HTTP connections require `https://` (except loopback) and do not follow HTTP redirects so authorization headers cannot leak to another host. Hooks are configured only by the user in Settings, never loaded from cloned repositories, and run with the user's own permissions.
