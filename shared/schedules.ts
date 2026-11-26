import type { PermissionMode } from './protocol.ts';

export type Recurrence = { kind: 'interval'; hours: number } | { kind: 'daily'; time: string } | { kind: 'weekly'; time: string; days: number[] };
export interface ScheduleInput { name: string; prompt: string; modelId: string; projectId: string | null; rule: Recurrence }
export interface Schedule extends ScheduleInput { id: string; paused: boolean; next: number; last: number | null; error: string | null; permissionCap?: PermissionMode }
