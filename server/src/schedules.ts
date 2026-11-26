import { randomUUID } from 'node:crypto';
import type { Recurrence, Schedule, ScheduleInput } from '../../shared/schedules.ts';
import type { PermissionMode } from '../../shared/protocol.ts';
import { lowerMode } from './agent/permissions.ts';
import type { Store } from './db.ts';
import { HttpError } from './errors.ts';

export function nextTime(rule: Recurrence, now: number, anchor = now) {
  if (rule.kind === 'interval') {
    const step = rule.hours * 3_600_000;
    return anchor + (Math.max(0, Math.floor((now - anchor) / step)) + 1) * step;
  }
  const [hour, minute] = rule.time.split(':').map(Number);
  for (let offset = 0; offset <= 7; offset++) {
    const date = new Date(now);
    date.setDate(date.getDate() + offset);
    date.setHours(hour, minute, 0, 0);
    if (+date > now && (rule.kind === 'daily' || rule.days.includes(date.getDay()))) return +date;
  }
  throw new Error('Fant ikke neste kjøretid.');
}

function ruleFrom(rule: any): Recurrence {
  if (rule?.kind === 'interval' && Number.isInteger(rule.hours) && rule.hours >= 1 && rule.hours <= 8760) return { kind: 'interval', hours: rule.hours };
  if (typeof rule?.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(rule.time)) {
    if (rule.kind === 'daily') return { kind: 'daily', time: rule.time };
    if (rule.kind === 'weekly' && Array.isArray(rule.days) && rule.days.length && rule.days.length <= 7 && rule.days.every((day: number) => Number.isInteger(day) && day >= 0 && day <= 6)) return { kind: 'weekly', time: rule.time, days: [...new Set<number>(rule.days)].sort() };
  }
  throw new HttpError(400, 'Velg gyldig tid, ukedager eller timeintervall.');
}

export class Schedules {
  private store: Store;
  private launch: (item: Schedule) => void;
  private now: () => number;
  private timer?: NodeJS.Timeout;
  constructor(store: Store, launch: (item: Schedule) => void, now = Date.now) { this.store = store; this.launch = launch; this.now = now; }
  close() { clearTimeout(this.timer); }
  list() { return this.store.schedules(); }
  get(id: string) { const item = this.list().find(item => item.id === id); if (!item) throw new HttpError(404, 'Fant ikke den planlagte oppgaven.'); return item; }
  save(input: ScheduleInput, id?: string, options: { enabled?: boolean; permissionCap?: PermissionMode } = {}) {
    const previous = id ? this.get(id) : null;
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100 || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 32000) throw new HttpError(400, 'Skriv et navn og en melding til oppgaven.');
    if (typeof input.modelId !== 'string' || !this.store.model(input.modelId)) throw new HttpError(400, 'Velg en modell.');
    if (input.projectId !== null && (typeof input.projectId !== 'string' || !this.store.project(input.projectId))) throw new HttpError(400, 'Velg Chat eller et eksisterende prosjekt.');
    const rule = ruleFrom(input.rule);
    if (options.enabled !== undefined && typeof options.enabled !== 'boolean') throw new HttpError(400, 'Ugyldig pausevalg.');
    const paused = options.enabled === undefined ? previous?.paused ?? false : !options.enabled;
    const keepNext = previous && (!previous.paused || paused) && JSON.stringify(previous.rule) === JSON.stringify(rule);
    const permissionCap = options.permissionCap && previous?.permissionCap
      ? lowerMode(options.permissionCap, previous.permissionCap) : options.permissionCap ?? previous?.permissionCap;
    const item: Schedule = {
      id: previous?.id ?? randomUUID(), name: input.name.trim(), prompt: input.prompt.trim(), modelId: input.modelId, projectId: input.projectId,
      rule, next: keepNext ? previous.next : nextTime(rule, this.now()), last: previous?.last ?? null, paused, error: null,
      ...(permissionCap ? { permissionCap } : {}),
    };
    this.store.saveSchedule(item); this.arm(); return item;
  }
  pause(id: string, paused: boolean) {
    const item = this.get(id);
    if (typeof paused !== 'boolean') throw new HttpError(400, 'Ugyldig pausevalg.');
    if (item.paused && !paused) item.next = nextTime(item.rule, this.now());
    item.paused = paused; this.store.saveSchedule(item); this.arm(); return item;
  }
  remove(id: string) { this.get(id); this.store.deleteSchedule(id); this.arm(); }
  run(id: string) { return this.dispatch(this.get(id), this.now()); }
  private dispatch(item: Schedule, now: number) {
    item.last = now; item.error = null;
    if (item.next <= now) item.next = nextTime(item.rule, now, item.next);
    this.store.saveSchedule(item);
    try { this.launch(item); } catch (error) { item.error = (error as Error).message; this.store.saveSchedule(item); }
    return item;
  }
  tick() { const now = this.now(); for (const item of this.list()) if (!item.paused && item.next <= now) this.dispatch(item, now); this.arm(); }
  private arm() {
    this.close(); const next = this.list().reduce((min, item) => item.paused ? min : Math.min(min, item.next), Infinity);
    if (Number.isFinite(next)) this.timer = setTimeout(() => this.tick(), Math.min(60_000, Math.max(0, next - this.now()))).unref();
  }
}
