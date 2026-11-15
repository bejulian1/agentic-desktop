---
name: security-audit
description: Sikkerhetsgjennomgang med konkrete rettinger. Bruk når brukeren ber om en sikkerhetssjekk.
args: "[område eller bekymring]"
mode: code
---
# Security audit

Scope: {{args}}

If nothing is given above, use what the user asked for in the conversation. Only if they named no scope, audit the parts of the project that receive outside input: HTTP routes, forms, file uploads, command-line arguments, webhooks and anything that talks to a database or a shell. Do not change files unless the user asked for fixes.

## 1. Map the entry points
Find where outside data enters with `search` (route definitions, request handlers, `argv`, environment, file reads). For each, follow the data to where it is used.

## 2. Check each area
**Access control**
- Every route checks who the caller is, and that this caller may touch this particular object (not only "is logged in").
- No trust in ids, roles or prices sent by the client.

**Injection**
- Database queries use parameters, never string building.
- No shell commands built from strings with outside data; use argument arrays.
- No `eval`, dynamic `require`/`import` or template code from input.

**Output and browser**
- Outside data is escaped when rendered. Flag `innerHTML`, `dangerouslySetInnerHTML` and unsanitised Markdown.
- Session cookies are `HttpOnly`, `Secure` and have `SameSite`. State-changing requests are protected against CSRF.

**Files and paths**
- Paths from input cannot leave the intended folder (`..`, absolute paths, symlinks).
- Uploads have type and size limits and are not executed or served from a script-capable location.

**Secrets and data**
- No keys, tokens or passwords in code, logs, error messages or the repository (`search` for likely names).
- Passwords are hashed with a slow hash (bcrypt, scrypt, argon2). Sensitive fields are not returned by APIs.

**Configuration and dependencies**
- Debug modes, default credentials and verbose errors are off outside development.
- Run the ecosystem's audit when available: `npm audit`, `pip-audit`, `cargo audit`.

## 3. Confirm
For each suspected problem, trace a concrete input that reaches the dangerous place. Report only what you can show; mark the rest as "needs checking".

## Report
Most serious first. For each: severity, file and line, how it can be exploited in one or two sentences, and the specific fix. End with what was not covered. Prefer practical risks over theoretical ones.
