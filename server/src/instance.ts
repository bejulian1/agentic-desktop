// Exclusive reservation and live-instance metadata for a data folder (SPEC 29.1).
import { timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { writeAtomic } from "./write-atomic.ts";

export const INSTANCE_FILE = "instance.json";
export const INSTANCE_LOCK_FILE = "instance-lock.sqlite";
const SQLITE_BUSY = 5;

export type Shell = "electron" | "localhost";

export interface InstanceInfo {
  pid: number;
  port: number;
  shell: Shell;
  startedAt: number;
}

export interface DataDirClaim {
  release(): void;
}

type InstanceRecord = InstanceInfo & { locked?: true; stopKey?: string };

export function currentShell(): Shell {
  return process.env.AD_SHELL === "electron" ? "electron" : "localhost";
}

function readInstanceRecord(dataDir: string): InstanceRecord | null {
  try {
    const data = JSON.parse(readFileSync(path.join(dataDir, INSTANCE_FILE), "utf8"));
    if (!Number.isInteger(data?.pid) || data.pid <= 0 || !Number.isInteger(data?.port) || data.port < 0 || data.port > 65535) return null;
    return {
      pid: data.pid, port: data.port, shell: data.shell === "electron" ? "electron" : "localhost", startedAt: Number(data.startedAt) || 0,
      locked: data.locked === true ? true : undefined,
      stopKey: typeof data.stopKey === "string" && data.stopKey.length >= 32 ? data.stopKey : undefined,
    };
  } catch {
    return null;
  }
}

function instanceInfo({ pid, port, shell, startedAt }: InstanceRecord): InstanceInfo {
  return { pid, port, shell, startedAt };
}

export function readInstance(dataDir: string): InstanceInfo | null {
  const record = readInstanceRecord(dataDir);
  return record && instanceInfo(record);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function portOpen(port: number): Promise<boolean> {
  if (port === 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(1000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function legacyInstanceIsLive(record: InstanceRecord): Promise<boolean> {
  return !record.locked && record.pid !== process.pid && pidAlive(record.pid) && await portOpen(record.port);
}

function tryLock(dataDir: string): DatabaseSync | null {
  const file = path.join(dataDir, INSTANCE_LOCK_FILE);
  if (!existsSync(file)) {
    try {
      writeFileSync(file, "", { flag: "wx", mode: 0o600 });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  const lock = new DatabaseSync(file);
  try {
    lock.exec("BEGIN EXCLUSIVE");
    return lock;
  } catch (err) {
    lock.close();
    if ((err as { errcode?: number }).errcode === SQLITE_BUSY) return null;
    throw err;
  }
}

export async function liveInstance(dataDir: string): Promise<InstanceInfo | null> {
  const record = readInstanceRecord(dataDir);
  if (!record || record.pid === process.pid) return null;
  if (!record.locked) return await legacyInstanceIsLive(record) ? instanceInfo(record) : null;
  const file = path.join(dataDir, INSTANCE_LOCK_FILE);
  if (!existsSync(file)) return null;
  const probe = new DatabaseSync(file, { readOnly: true });
  try {
    probe.prepare("PRAGMA user_version").get();
    return null;
  } catch (err) {
    if ((err as { errcode?: number }).errcode !== SQLITE_BUSY) throw err;
    const owner = readInstanceRecord(dataDir);
    return owner?.locked ? instanceInfo(owner) : null;
  } finally {
    probe.close();
  }
}

// Only the Electron main process uses the localhost server's stop key (SPEC 29.1).
export function writeInstance(dataDir: string, port: number, stopKey?: string): void {
  const info: InstanceRecord = { pid: process.pid, port, shell: currentShell(), startedAt: Date.now(), locked: true, stopKey };
  writeAtomic(path.join(dataDir, INSTANCE_FILE), `${JSON.stringify(info)}\n`, dataDir, 0o600);
}

export function readStopKey(dataDir: string): string | null {
  return readInstanceRecord(dataDir)?.stopKey ?? null;
}

export function sameKey(given: unknown, expected: string): boolean {
  if (typeof given !== "string") return false;
  const provided = Buffer.from(given);
  const required = Buffer.from(expected);
  return provided.length === required.length && timingSafeEqual(provided, required);
}

export class DataDirInUse extends Error {
  readonly code = "EDATAINUSE";
  readonly dataDir: string;
  readonly other: InstanceInfo;
  constructor(dataDir: string, other: InstanceInfo) {
    super(
      other.shell === "electron"
        ? `Agentic Desktop-appen bruker allerede datamappen ${dataDir}. Avslutt appen først, eller sett AD_DATA_DIR til en annen mappe.`
        : other.port > 0
          ? `Agentic Desktop kjører allerede i nettleseren (port ${other.port}, PID ${other.pid}) mot datamappen ${dataDir}.`
          : `Agentic Desktop bruker allerede datamappen ${dataDir}.`,
    );
    this.dataDir = dataDir;
    this.other = other;
  }
}

export async function claimDataDir(dataDir: string): Promise<DataDirClaim> {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const lock = tryLock(dataDir);
  const other = readInstanceRecord(dataDir);
  if (!lock) throw new DataDirInUse(dataDir, other ? instanceInfo(other) : { pid: 0, port: 0, shell: "localhost", startedAt: 0 });
  try {
    if (other && await legacyInstanceIsLive(other)) throw new DataDirInUse(dataDir, instanceInfo(other));
    writeInstance(dataDir, 0);
  } catch (err) {
    lock.close();
    throw err;
  }

  let released = false;
  return {
    release() {
      if (released) return;
      try {
        rmSync(path.join(dataDir, INSTANCE_FILE), { force: true });
      } finally {
        lock.close();
        released = true;
      }
    },
  };
}
