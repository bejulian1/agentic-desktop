// API keys and the GitHub token (SPEC 30.1). They are kept in the system keyring (keyring.ts) and
// in this process's memory, and nowhere else on disk. Keys never leave this module except towards
// the provider, and are never written to logs, events or the environment of child processes.
//
// Before 0.10 the keys were in keys.json (0600) in the data folder. At start each key in it is
// moved into the keyring; the file is deleted only when every key is stored and has been read back
// the same. If anything goes wrong the file stays, its keys are still used, and Innstillinger says
// why. Without a keyring (missing, locked, or the user cancelled the unlock) a new key works until
// the app closes and is never written in plain text; the app tries the keyring again on request.
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import type { KeyringStatus } from "../../shared/protocol.ts";
import { KeyringError, type Keyring, type KeyringFailure } from "./keyring.ts";
import { writeAtomic } from "./write-atomic.ts";

const LEGACY_FILE = "keys.json";

export class Secrets {
  private keys = new Map<string, string>();
  // Keys set or removed while the keyring could not be reached; written to it when it comes back.
  private pending = new Map<string, string | null>();
  private file: string;
  private keyring: Keyring;
  private label: (provider: string) => string;
  private queue: Promise<unknown> = Promise.resolve();
  private state: KeyringStatus;
  onChange: ((status: KeyringStatus) => void) | null = null;

  constructor(dataDir: string, keyring: Keyring, label: (provider: string) => string = (p) => `Agentic Desktop: ${p}`) {
    this.file = path.join(dataDir, LEGACY_FILE);
    this.keyring = keyring;
    this.label = label;
    // Until the keyring has answered, the keys from an old keys.json can already be used.
    const legacy = this.readLegacy();
    for (const [provider, key] of Object.entries(legacy.keys)) this.keys.set(provider, key);
    this.state = { store: "pending", legacy: legacy.exists ? { reason: "pending" } : null };
  }

  get(providerId: string): string | undefined {
    return this.keys.get(providerId);
  }

  values(): string[] {
    return [...this.keys.values()];
  }

  status(): KeyringStatus {
    return structuredClone(this.state);
  }

  // Reads the keyring and moves keys.json into it. Called at start, and again from Innstillinger
  // (Prøv igjen) after the keyring was locked or missing.
  load(): Promise<KeyringStatus> {
    return this.enqueue(() => this.sync());
  }

  // The key is in use at once; the keyring is written in the background, in order.
  set(providerId: string, key: string | null): Promise<void> {
    if (key) this.keys.set(providerId, key);
    else this.keys.delete(providerId);
    this.forgetLegacy(providerId);
    return this.enqueue(async () => {
      if (this.state.store !== "keyring") {
        this.pending.set(providerId, key);
        return;
      }
      try {
        if (key) await this.keyring.store(providerId, this.label(providerId), key);
        else await this.keyring.clear(providerId);
      } catch (err) {
        this.pending.set(providerId, key);
        this.update({ store: "session", reason: reasonOf(err), legacy: this.state.legacy });
      }
    });
  }

  // Waits for writes that are under way, so a key set just before the app closes is not lost.
  idle(): Promise<void> {
    return this.queue.then(() => undefined, () => undefined);
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private update(next: KeyringStatus): void {
    const changed = JSON.stringify(next) !== JSON.stringify(this.state);
    this.state = next;
    if (changed) this.onChange?.(this.status());
  }

  private readLegacy(): { exists: boolean; keys: Record<string, string>; unreadable?: boolean } {
    if (!existsSync(this.file)) return { exists: false, keys: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { exists: true, keys: {}, unreadable: true };
      const keys: Record<string, string> = {};
      for (const [provider, key] of Object.entries(parsed)) if (typeof key === "string" && key) keys[provider] = key;
      return { exists: true, keys };
    } catch {
      return { exists: true, keys: {}, unreadable: true };
    }
  }

  // A key changed or removed while keys.json is still there: its old value goes from the file, so
  // the file never brings it back. Nothing new is ever written to it.
  private forgetLegacy(providerId: string): void {
    const legacy = this.readLegacy();
    if (!legacy.exists || legacy.unreadable || !(providerId in legacy.keys)) return;
    delete legacy.keys[providerId];
    try {
      if (Object.keys(legacy.keys).length) writeAtomic(this.file, JSON.stringify(legacy.keys), path.dirname(this.file), 0o600);
      else rmSync(this.file, { force: true });
    } catch (err) {
      console.error("Kunne ikke rydde i keys.json:", (err as Error).message);
    }
  }

  private async sync(): Promise<KeyringStatus> {
    const legacy = this.readLegacy();
    let stored: Record<string, string>;
    try {
      stored = await this.keyring.load();
    } catch (err) {
      const reason = reasonOf(err);
      // Keys set during the session stay as they are; the rest come from keys.json, if any.
      for (const [provider, key] of Object.entries(legacy.keys)) if (!this.pending.has(provider)) this.keys.set(provider, key);
      this.update({ store: "session", reason, legacy: legacy.exists ? { reason: legacy.unreadable ? "unreadable" : reason } : null });
      return this.status();
    }

    // What the keyring should hold: what it has, the keys from keys.json, and changes made while it
    // could not be reached.
    const wanted: Record<string, string> = { ...stored, ...legacy.keys };
    for (const [provider, key] of this.pending) {
      if (key) wanted[provider] = key;
      else delete wanted[provider];
    }
    try {
      for (const [provider, key] of Object.entries(wanted)) if (stored[provider] !== key) await this.keyring.store(provider, this.label(provider), key);
      for (const provider of Object.keys(stored)) if (!(provider in wanted)) await this.keyring.clear(provider);
      const back = Object.keys(wanted).length || Object.keys(stored).length ? await this.keyring.load() : stored;
      const same = Object.entries(wanted).every(([provider, key]) => back[provider] === key);
      if (!same) throw new KeyringError("error", "readback");
      this.keys = new Map(Object.entries(back));
    } catch (err) {
      this.keys = new Map(Object.entries(wanted));
      const reason = reasonOf(err);
      const readback = err instanceof KeyringError && err.message === "readback";
      this.update({ store: "session", reason, legacy: legacy.exists ? { reason: legacy.unreadable ? "unreadable" : readback ? "readback" : reason } : null });
      return this.status();
    }
    this.pending.clear();

    // Everything is in the keyring and reads back the same: keys.json can go. A file that could not
    // be read is left alone, so nothing is lost that was not understood.
    let left: KeyringStatus["legacy"] = null;
    if (legacy.exists && legacy.unreadable) left = { reason: "unreadable" };
    else if (legacy.exists) {
      try {
        rmSync(this.file);
      } catch {
        left = { reason: "delete" };
      }
    }
    this.update({ store: "keyring", legacy: left });
    return this.status();
  }
}

function reasonOf(err: unknown): KeyringFailure {
  return err instanceof KeyringError ? err.code : "error";
}
