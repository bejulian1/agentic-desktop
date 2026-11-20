import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { apiCall, closeAll, launch, sandbox, waitFor, type Running } from './helpers.ts';

test('only the app records fake audio; transcription replaces the composer selection', async () => {
  const box = sandbox(); let running: Running | undefined;
  let received = 0;
  const fake = createServer(async (req, res) => {
    if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>Test</title>'); return; }
    for await (const chunk of req) received += chunk.length;
    res.end(JSON.stringify({ text: 'diktert' }));
  });
  try {
    await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
    running = await launch(box, { args: ['--use-fake-device-for-media-stream'] });
    const { page } = running;
    const provider = await apiCall(page, 'POST', '/api/providers', { kind: 'openai-compatible', name: 'Lokal tale', baseUrl: `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1` });
    await apiCall(page, 'PATCH', '/api/settings', { dictation: { providerId: provider.id, model: 'test' } });
    const field = page.getByRole('textbox', { name: 'Melding', exact: true });
    await field.fill('før gammel etter'); await field.evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(4, 10));
    await page.getByRole('button', { name: 'Diktering', exact: true }).click();
    await page.getByRole('button', { name: 'Ta opp til Lokal tale' }).click();
    const stop = page.getByRole('button', { name: /Tar opp · stopp/ }); await stop.waitFor();
    await page.waitForTimeout(1150); await stop.click();
    await waitFor(async () => await field.inputValue() === 'før diktert etter', 'tekst ved markøren');
    assert.ok(received > 300); assert.equal((await apiCall(page, 'GET', '/api/bootstrap')).threads.length, 0);
    assert.equal(await page.evaluate(() => navigator.mediaDevices.getUserMedia({ video: true }).then(stream => { stream.getTracks().forEach(track => track.stop()); return 'allowed'; }, error => error.name)), 'NotAllowedError');
    const foreign = await running.app.evaluate(async ({ BrowserWindow }, port) => {
      const other = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
      try {
        await other.loadURL(`http://127.0.0.1:${port}/`);
        return await other.webContents.executeJavaScript("navigator.mediaDevices.getUserMedia({audio:true}).then(stream => { stream.getTracks().forEach(track => track.stop()); return 'allowed'; }, error => error.name)", true);
      } finally { other.destroy(); }
    }, (fake.address() as AddressInfo).port);
    assert.equal(foreign, 'NotAllowedError');
  } finally { await closeAll(running); box.cleanup(); await new Promise(resolve => fake.close(resolve)); }
});
