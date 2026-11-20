import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { Store, MOCK_MODEL_ID } from '../src/db.ts';
import { nextTime, Schedules } from '../src/schedules.ts';
import { startHarness, tempDir, until } from './helpers.ts';

test('dictation forwards only to the confirmed endpoint, without redirect or fallback', async t => {
  const harness = await startHarness(t);
  const requests: string[] = [];
  let redirect = false;
  const fake = createServer(async (req, res) => {
    requests.push(req.url!);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': String(req.headers['content-type']) } }).formData();
    assert.equal(req.headers.authorization, 'Bearer fake-test'); assert.equal(form.get('model'), 'whisper-test');
    assert.equal(await (form.get('file') as File).text(), 'fake-audio');
    if (redirect) res.writeHead(307, { location: '/do-not-follow' });
    res.end(JSON.stringify({ text: ' Hei! ' }));
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise<void>(resolve => fake.close(() => resolve())));
  const baseUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`;
  const provider = await harness.api('POST', '/api/providers', { name: 'Lokal tale', kind: 'openai-compatible', baseUrl, apiKey: 'fake-test' });
  const choice = { providerId: provider.id, model: 'whisper-test' };
  const body = { ...choice, baseUrl, mime: 'audio/webm', audio: Buffer.from('fake-audio').toString('base64') };
  await assert.rejects(harness.api('POST', '/api/dictation', body), /409/);
  await harness.api('PATCH', '/api/settings', { dictation: choice });
  assert.deepEqual(await harness.api('POST', '/api/dictation', body), { text: 'Hei!' });
  redirect = true;
  await assert.rejects(harness.api('POST', '/api/dictation', body), /502/);
  await assert.rejects(harness.api('POST', '/api/dictation', { ...body, baseUrl: baseUrl + '/other' }), /409/);
  await assert.rejects(harness.api('POST', '/api/dictation', { ...body, audio: '' }), /400/);
  assert.deepEqual(requests, ['/v1/audio/transcriptions', '/v1/audio/transcriptions']);
});

test('local calendar recurrence and one catch-up after multiple missed intervals', t => {
  const monday = +new Date(2026, 10, 16, 8, 30);
  assert.equal(nextTime({ kind: 'weekly', days: [1, 3], time: '08:30' }, monday), +new Date(2026, 10, 18, 8, 30));
  assert.equal(nextTime({ kind: 'daily', time: '08:30' }, monday), +new Date(2026, 10, 17, 8, 30));
  const dir = tempDir(t); let now = monday; let runs = 0;
  const initial = new Store(dir);
  const previous = new Schedules(initial, () => runs++, () => now);
  const item = previous.save({ name: 'Test', prompt: 'Hei', projectId: null, modelId: MOCK_MODEL_ID, rule: { kind: 'interval', hours: 2 } });
  previous.close(); initial.close(); now += 11 * 3_600_000;
  const store = new Store(dir); const service = new Schedules(store, () => runs++, () => now);
  try { service.tick(); service.tick(); assert.equal(runs, 1); assert.equal(service.list()[0].next, monday + 12 * 3_600_000);
    service.pause(item.id, true); now += 2 * 3_600_000; service.tick(); assert.equal(runs, 1);
    service.pause(item.id, false); assert.equal(service.list()[0].next, now + 2 * 3_600_000);
  } finally { service.close(); store.close(); }
});

test('schedule API edits, pauses, runs in Chat or Kode with approvals, and removes', async t => {
  const harness = await startHarness(t); const { api } = harness;
  const input = { name: 'Oppgave', prompt: 'Hei', rule: { kind: 'daily', time: '08:15' }, modelId: MOCK_MODEL_ID, projectId: null };
  await assert.rejects(api('POST', '/api/schedules', { ...input, rule: { kind: 'weekly', days: [], time: '08:15' } }), /400/);
  const item = await api('POST', '/api/schedules', input); const path = `/api/schedules/${item.id}`;
  await api('PATCH', path, { paused: true }); assert.equal((await api('POST', path + '/run')).paused, true);
  const chat = (await api('GET', '/api/bootstrap')).threads[0]; assert.equal(chat.mode, 'chat'); await harness.finished(chat.id);
  assert.equal(harness.app.store.thread(chat.id)?.scheduleNotice, true); await api('POST', `/api/threads/${chat.id}/schedule-seen`); assert.ok(!harness.app.store.thread(chat.id)?.scheduleNotice);
  const project = await harness.project(); await api('PUT', path, { ...input, projectId: project.id, prompt: 'lag en side' });
  await api('POST', path + '/run'); const thread = harness.app.store.projectThreads(project.id)[0];
  await until(() => harness.app.store.thread(thread.id)?.pendingApprovals === 1, 'project approval');
  await api('DELETE', path); assert.deepEqual(await api('GET', '/api/schedules'), []);
});
