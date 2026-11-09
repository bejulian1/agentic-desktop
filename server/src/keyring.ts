// The system keyring (SPEC 30.1): API keys and the GitHub token live in the Secret Service, which on
// GNOME is the GNOME keyring, encrypted with the login password. Node has no Secret Service client
// and no new packages are allowed, so a small Python program talks to it through libsecret
// (gi.repository.Secret), which Ubuntu ships with GNOME. The program text is passed with -c and
// the request goes in on stdin, so a key is never in an argument list (visible in ps) and never in
// a file. The answer comes back on stdout as JSON.
//
// Backends:
//   SecretServiceKeyring  the real one, used by the app and `npm start`
//   MemoryKeyring         for the tests: works like a keyring, keeps nothing after the process
//   no keyring            AD_KEYRING=none, or what the app falls back to when the Secret Service
//                         is missing or locked: the keys then live in memory for the session only
import { spawn } from "node:child_process";

export type KeyringFailure = "no-service" | "locked" | "error";

export class KeyringError extends Error {
  code: KeyringFailure;
  constructor(code: KeyringFailure, message: string) {
    super(message);
    this.code = code;
  }
}

export interface Keyring {
  readonly kind: "secret-service" | "memory" | "none";
  // Every key this app has stored, by provider id. Throws KeyringError when the keyring is missing,
  // locked (and the user did not unlock it) or fails.
  load(): Promise<Record<string, string>>;
  store(provider: string, label: string, secret: string): Promise<void>;
  clear(provider: string): Promise<void>;
}

// The schema the items are stored under. Seahorse (Passord og nøkler) shows them with the label.
export const SCHEMA = "io.github.AgenticDesktop.ApiKey";
const APPLICATION = "io.github.AgenticDesktop";

// Kept short and boring on purpose: it is the only code that sees the keys outside the server.
// Errors are reported by kind and GLib's message, never with the request in them.
const HELPER = String.raw`
import json, sys
def answer(value):
    sys.stdout.write(json.dumps(value))
    sys.stdout.flush()
    sys.exit(0)
try:
    import gi
    gi.require_version("Secret", "1")
    from gi.repository import GLib, Secret
except Exception as err:
    answer({"ok": False, "code": "no-service", "message": "libsecret mangler: " + type(err).__name__})
SCHEMA = Secret.Schema.new("${SCHEMA}", Secret.SchemaFlags.NONE, {"provider": Secret.SchemaAttributeType.STRING, "application": Secret.SchemaAttributeType.STRING})
# Found by this attribute, not by the schema: gnome-keyring does not match xdg:schema in a locked
# collection, so a search by schema would miss the keys until the keyring is unlocked.
MINE = {"application": "${APPLICATION}"}
def remote_name(err):
    try:
        from gi.repository import Gio
        return Gio.DBusError.get_remote_error(err) or ""
    except Exception:
        return ""
def failed(err):
    name = remote_name(err)
    text = (err.message or "").lower()
    try:
        if err.matches(Secret.error_get_quark(), Secret.Error.IS_LOCKED):
            return {"ok": False, "code": "locked", "message": err.message}
    except Exception:
        pass
    if any(part in name for part in ("ServiceUnknown", "NoServer", "Spawn", "Disconnected", "NameHasNoOwner")) or "not provided by any .service" in text or "autolaunch" in text or "no such file" in text:
        return {"ok": False, "code": "no-service", "message": err.message}
    if "Cancel" in name or "dismiss" in text or "cancel" in text:
        return {"ok": False, "code": "locked", "message": err.message}
    return {"ok": False, "code": "error", "message": err.message}
try:
    request = json.loads(sys.stdin.read() or "{}")
    op = request.get("op")
    if op == "load":
        service = Secret.Service.get_sync(Secret.ServiceFlags.OPEN_SESSION, None)
        found = service.search_sync(None, MINE, Secret.SearchFlags.ALL, None)
        locked = [item for item in found if item.get_locked()]
        if locked:
            # Asks the user to unlock (GNOME's own dialog). Cancelled, the items stay locked.
            service.unlock_sync(locked, None)
            found = service.search_sync(None, MINE, Secret.SearchFlags.ALL, None)
            if any(item.get_locked() for item in found):
                answer({"ok": False, "code": "locked", "message": "Nøkkelringen er låst"})
        keys = {}
        for item in found:
            item.load_secret_sync(None)
            value = item.get_secret()
            attributes = item.get_attributes()
            provider = attributes.get("provider")
            if provider and value is not None and attributes.get("xdg:schema", SCHEMA.name) == SCHEMA.name:
                keys[provider] = value.get_text()
        answer({"ok": True, "keys": keys})
    elif op == "store":
        stored = Secret.password_store_sync(SCHEMA, dict(MINE, provider=request["provider"]), Secret.COLLECTION_DEFAULT, request["label"], request["secret"], None)
        answer({"ok": True} if stored else {"ok": False, "code": "locked", "message": "Nøkkelringen ble ikke låst opp"})
    elif op == "clear":
        Secret.password_clear_sync(SCHEMA, dict(MINE, provider=request["provider"]), None)
        answer({"ok": True})
    else:
        answer({"ok": False, "code": "error", "message": "Ukjent forespørsel"})
except GLib.Error as err:
    answer(failed(err))
except Exception as err:
    answer({"ok": False, "code": "error", "message": type(err).__name__})
`;

// What the helper gets from the environment: enough to find the session bus and nothing else, so
// no API key from the user's own variables reaches it either.
function helperEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  // No DISPLAY: without a session bus GLib would otherwise try to start one through X11.
  for (const name of ["PATH", "HOME", "LANG", "LC_ALL", "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"]) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  return env;
}

interface HelperAnswer {
  ok: boolean;
  code?: KeyringFailure;
  message?: string;
  keys?: Record<string, string>;
}

export class SecretServiceKeyring implements Keyring {
  readonly kind = "secret-service" as const;
  private python: string;
  private timeoutMs: number;

  // timeoutMs: an unlock waits for the user's password, so it is generous. A helper that runs over
  // is stopped by its own PID.
  constructor(options: { python?: string; timeoutMs?: number } = {}) {
    this.python = options.python ?? "python3";
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  private run(request: Record<string, string>): Promise<HelperAnswer> {
    return new Promise((resolve, reject) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(this.python, ["-I", "-c", HELPER], { env: helperEnv(), stdio: ["pipe", "pipe", "pipe"] });
      } catch {
        return reject(new KeyringError("no-service", "python3 mangler"));
      }
      let out = "";
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        done(() => reject(new KeyringError("locked", "Nøkkelringen svarte ikke i tide")));
        if (child.exitCode === null && child.pid) child.kill("SIGKILL");
      }, this.timeoutMs);
      child.stdout!.setEncoding("utf8");
      child.stdout!.on("data", (chunk: string) => (out += chunk));
      child.stderr!.resume(); // GLib's warnings; never logged, since nothing here should need them
      child.on("error", (err) => done(() => reject(new KeyringError("no-service", (err as NodeJS.ErrnoException).code === "ENOENT" ? "python3 mangler" : err.message))));
      child.on("close", () => {
        done(() => {
          try {
            resolve(JSON.parse(out) as HelperAnswer);
          } catch {
            reject(new KeyringError("error", "Uventet svar fra nøkkelringen"));
          }
        });
      });
      child.stdin!.on("error", () => undefined); // the helper may stop before reading
      child.stdin!.end(JSON.stringify(request));
    });
  }

  private async call(request: Record<string, string>): Promise<HelperAnswer> {
    const answer = await this.run(request);
    if (!answer.ok) throw new KeyringError(answer.code ?? "error", answer.message ?? "Nøkkelringen svarte med en feil");
    return answer;
  }

  async load(): Promise<Record<string, string>> {
    return (await this.call({ op: "load" })).keys ?? {};
  }

  async store(provider: string, label: string, secret: string): Promise<void> {
    await this.call({ op: "store", provider, label, secret });
  }

  async clear(provider: string): Promise<void> {
    await this.call({ op: "clear", provider });
  }
}

// For the tests: a keyring in this process. `failure` makes it act like a missing or locked one.
export class MemoryKeyring implements Keyring {
  readonly kind = "memory" as const;
  readonly items = new Map<string, { label: string; secret: string }>();
  failure: KeyringFailure | null = null;
  // Stored values that read back wrong, to test that keys.json stays when a check fails.
  corrupt = false;

  private check(): void {
    if (this.failure) throw new KeyringError(this.failure, this.failure === "locked" ? "Nøkkelringen er låst" : "Fant ingen nøkkelring");
  }

  async load(): Promise<Record<string, string>> {
    this.check();
    return Object.fromEntries([...this.items].map(([provider, item]) => [provider, this.corrupt ? `${item.secret}x` : item.secret]));
  }

  async store(provider: string, label: string, secret: string): Promise<void> {
    this.check();
    this.items.set(provider, { label, secret });
  }

  async clear(provider: string): Promise<void> {
    this.check();
    this.items.delete(provider);
  }
}

class NoKeyring implements Keyring {
  readonly kind = "none" as const;
  private fail(): never {
    throw new KeyringError("no-service", "Nøkkelringen er slått av");
  }
  async load(): Promise<Record<string, string>> {
    this.fail();
  }
  async store(): Promise<void> {
    this.fail();
  }
  async clear(): Promise<void> {
    this.fail();
  }
}

// AD_KEYRING picks the backend: secret-service (the default), memory or none. Under `node --test`
// (NODE_TEST_CONTEXT) the default is memory, so no test can reach the user's real keyring by
// accident; a test that wants the real thing sets AD_KEYRING=secret-service on a private bus.
export function defaultKeyring(env: NodeJS.ProcessEnv = process.env): Keyring {
  const chosen = env.AD_KEYRING ?? (env.NODE_TEST_CONTEXT ? "memory" : "secret-service");
  if (chosen === "memory") return new MemoryKeyring();
  if (chosen === "none") return new NoKeyring();
  return new SecretServiceKeyring();
}
