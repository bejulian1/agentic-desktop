import { createResource, createSignal, For, onCleanup, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { Recurrence, Schedule } from '../../../shared/schedules';
import { api, get } from '../lib/api';
import { app } from '../state/app';

const days = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
const when = (stamp: number | null) => stamp === null ? 'aldri' : new Date(stamp).toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' });
const cadence = (rule: Recurrence) => rule.kind === 'interval' ? `Timeintervall: ${rule.hours}` : `${rule.kind === 'daily' ? 'Daglig' : rule.days.map(day => days[day]).join(', ')} kl. ${rule.time}`;

export function Scheduled() {
  const [list, { refetch }] = createResource(() => get<Schedule[]>('/api/schedules'));
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [editing, setEditing] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal('');
  const timer = setInterval(() => void refetch(), 15_000); onCleanup(() => clearInterval(timer));
  const [draft, setDraft] = createStore({ name: '', prompt: '', projectId: '', modelId: '', kind: 'daily', time: '09:00', days: [1], hours: 1 });
  const edit = (item?: Schedule) => {
    setError(''); setEditing(item?.id ?? '');
    const rule = item?.rule;
    setDraft({ name: item?.name ?? '', prompt: item?.prompt ?? '', projectId: item?.projectId ?? '', modelId: item?.modelId ?? app.settings.defaultModelId ?? app.models[0]?.id ?? '', kind: rule?.kind ?? 'daily', time: rule && rule.kind !== 'interval' ? rule.time : '09:00', days: rule?.kind === 'weekly' ? [...rule.days] : [1], hours: rule?.kind === 'interval' ? rule.hours : 1 });
  };
  const mutate = async (method: string, path: string, body?: unknown, saved = false) => {
    if (busy()) return; setBusy(true); setError('');
    try { await api(method, `/api/schedules${path}`, body); if (saved) setEditing(null); setDeleting(''); await refetch(); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return <div class="schedules"><p>Oppgavene starter nye tråder mens appen kjører. Har appen vært lukket, kjøres hver forfalt oppgave én gang. Klokkeslett følger lokal tid.</p>
    <Show when={error()}><p role="alert">{error()}</p></Show>
    <Show when={editing() !== null} fallback={<button class="btn" onClick={() => edit()}>Ny oppgave</button>}>
      <form class="settings-card" onSubmit={event => { event.preventDefault(); const id = editing(); void mutate(id ? 'PUT' : 'POST', id ? `/${id}` : '', { name: draft.name, prompt: draft.prompt, projectId: draft.projectId || null, modelId: draft.modelId, rule: draft.kind === 'interval' ? { kind: 'interval', hours: draft.hours } : { kind: draft.kind, time: draft.time, ...(draft.kind === 'weekly' ? { days: draft.days } : {}) } }, true); }}>
        <label>Navn<input class="input" required maxLength={100} value={draft.name} onInput={event => setDraft('name', event.currentTarget.value)}/></label>
        <label>Melding<textarea class="input" required maxLength={32000} value={draft.prompt} onInput={event => setDraft('prompt', event.currentTarget.value)}/></label>
        <label>Start tråd i<select class="input" value={draft.projectId} onChange={event => setDraft('projectId', event.currentTarget.value)}><option value="">Chat</option><For each={Object.values(app.projects)}>{project => <option value={project.id} selected={project.id === draft.projectId}>Kode: {project.name}</option>}</For></select></label>
        <label>Modell<select class="input" required value={draft.modelId} onChange={event => setDraft('modelId', event.currentTarget.value)}><For each={app.models}>{model => <option value={model.id} selected={model.id === draft.modelId}>{model.name}</option>}</For></select></label>
        <label>Gjenta<select class="input" value={draft.kind} onChange={event => setDraft('kind', event.currentTarget.value)}><option value="daily">Daglig</option><option value="weekly">Ukentlig</option><option value="interval">Hver N. time</option></select></label>
        <Show when={draft.kind !== 'interval'} fallback={<label>Antall timer<input class="input" type="number" min="1" max="8760" required value={draft.hours} onInput={event => setDraft('hours', event.currentTarget.valueAsNumber)}/></label>}><label>Klokkeslett<input class="input" type="time" required value={draft.time} onInput={event => setDraft('time', event.currentTarget.value)}/></label></Show>
        <Show when={draft.kind === 'weekly'}><fieldset><legend>Ukedager</legend><For each={[1,2,3,4,5,6,0]}>{day => <label><input type="checkbox" checked={draft.days.includes(day)} onChange={event => setDraft('days', event.currentTarget.checked ? [...draft.days, day] : draft.days.filter(value => value !== day))}/>{days[day]} </label>}</For></fieldset></Show>
        <div><button class="btn" disabled={busy()}>Lagre oppgave</button> <button class="btn" type="button" disabled={busy()} onClick={() => setEditing(null)}>Avbryt</button></div>
      </form>
    </Show>
    <Show when={!list.error} fallback={<p role="alert">Kunne ikke hente oppgavene. <button class="btn" onClick={() => void refetch()}>Prøv igjen</button></p>}><For each={list.latest} fallback={<p>{list.loading ? 'Henter oppgaver…' : 'Ingen planlagte oppgaver.'}</p>}>{item => <article class="settings-card">
      <strong>{item.name}</strong><span>{cadence(item.rule)} · {item.projectId ? app.projects[item.projectId]?.name : 'Chat'}</span>
      <span>Sist: {when(item.last)} · Neste: {item.paused ? 'pauset' : when(item.next)}</span><Show when={item.error}><span role="alert">{item.error}</span></Show>
      <div><button class="btn btn-small" disabled={busy()} onClick={() => edit(item)}>Rediger</button> <button class="btn btn-small" disabled={busy()} onClick={() => mutate('PATCH', `/${item.id}`, { paused: !item.paused })}>{item.paused ? 'Gjenoppta' : 'Pause'}</button> <button class="btn btn-small" disabled={busy()} onClick={() => mutate('POST', `/${item.id}/run`)}>Kjør nå</button> <button class="btn btn-small" disabled={busy()} onClick={() => deleting() === item.id ? mutate('DELETE', `/${item.id}`) : setDeleting(item.id)}>{deleting() === item.id ? 'Bekreft sletting' : 'Slett'}</button></div>
    </article>}</For></Show></div>;
}
