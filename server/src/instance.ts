// Which server uses a data folder right now (SPEC 29.1). The server writes instance.json after it
// listens and removes it when it closes. The Electron app reads it before it starts its own server,
// and a server started by the Electron app (AD_SHELL=electron) refuses a folder another live server
// uses, so two servers never write to the same threads. Two localhost servers behave as before.
import { timingSafeEqual } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { writeAtomic } from "./write-atomic.ts";

export const INSTANCE_FILE = "instance.json";

export type Shell = "electron" | "localhost";

export interface InstanceInfo {
  pid: number;
  port: number;
  shell: Shell;
  startedAt: number;
}

export function currentShell(): Shell {
  return process.env.AD_SHELL === "electron" ? "electron" : "localhost";
}

export function readInstance(dataDir: string): InstanceInfo | null {
  try {
    const data = JSON.parse(readFileSync(path.join(dataDir, INSTANCE_FILE), "utf8"));
    if (!Number.isInteger(data?.pid) || !Number.isInteger(data?.port)) return null;
    return { pid: data.pid, port: data.port, shell: data.shell === "electron" ? "electron" : "localhost", startedAt: Number(data.startedAt) || 0 };
  } catch {
    return null;
  }
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

// Another server that still runs: its PID is alive and its port answers. A file left by a server
// that crashed, or a PID that was reused, does not count.
export async function liveInstance(dataDir: string): Promise<InstanceInfo | null> {
  const info = readInstance(dataDir);
  if (!info || info.pid === process.pid || !pidAlive(info.pid)) return null;
  return (await portOpen(info.port)) ? info : null;
}

// stopKey: only a localhost server has one. Whoever can read this file (mode 0600, in the data folder)
// may ask that server to stop through POST /api/instance/stop, which is how the Electron app ends a
// browser version that holds its data folder (SPEC 29.1). Nothing else ever gets the key.
export function writeInstance(dataDir: string, port: number, stopKey?: string): void {
  const info: InstanceInfo & { stopKey?: string } = { pid: process.pid, port, shell: currentShell(), startedAt: Date.now() };
  if (stopKey) info.stopKey = stopKey;
  writeAtomic(path.join(dataDir, INSTANCE_FILE), `${JSON.stringify(info)}\n`, dataDir, 0o600);
}

// The stop key of the server in instance.json, for the Electron app's main process only.
export function readStopKey(dataDir: string): string | null {
  try {
    const key = JSON.parse(readFileSync(path.join(dataDir, INSTANCE_FILE), "utf8"))?.stopKey;
    return typeof key === "string" && key.length >= 32 ? key : null;
  } catch {
    return null;
  }
}

export function sameKey(given: unknown, expected: string): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Only our own file: a server that started after us has written its own.
export function removeInstance(dataDir: string): void {
  if (readInstance(dataDir)?.pid === process.pid) rmSync(path.join(dataDir, INSTANCE_FILE), { force: true });
}

export class DataDirInUse extends Error {
  readonly code = "EDATAINUSE";
  readonly dataDir: string;
  readonly other: InstanceInfo;
  constructor(dataDir: string, other: InstanceInfo) {
    super(
      other.shell === "electron"
        ? `Agentic Desktop-appen bruker allerede datamappen ${dataDir}. Avslutt appen først, eller sett AD_DATA_DIR til en annen mappe.`
        : `Agentic Desktop kjører allerede i nettleseren (port ${other.port}, PID ${other.pid}) mot datamappen ${dataDir}.`,
    );
    this.dataDir = dataDir;
    this.other = other;
  }
}

// Called before the server opens the database.
export async function claimDataDir(dataDir: string): Promise<void> {
  const other = await liveInstance(dataDir);
  if (other && (other.shell === "electron" || currentShell() === "electron")) throw new DataDirInUse(dataDir, other);
}
