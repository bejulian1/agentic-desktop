import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startHarness } from './helpers.ts';
test('Oppstart og faneoppsett lagres, gjenopprettes og valideres', async t => {
  const h=await startHarness(t);
  const saved=await h.api('PATCH','/api/settings',{startConversation:'resume',panelTabLayout:'grouped'});
  assert.equal(saved.startConversation,'resume');assert.equal(saved.panelTabLayout,'grouped');
  const boot=await h.api('GET','/api/bootstrap');
  assert.equal(boot.settings.startConversation,'resume');assert.equal(boot.settings.panelTabLayout,'grouped');
  for(const patch of [{startConversation:'all'},{startConversation:null},{panelTabLayout:'none'},{panelTabLayout:[] }]) {
    assert.equal((await h.raw('PATCH','/api/settings',{headers:{'content-type':'application/json'},body:JSON.stringify(patch)})).status,400);
  }
  const next=await h.api('PATCH','/api/settings',{startConversation:'new',panelTabLayout:'unified'});
  assert.equal(next.startConversation,'new');assert.equal(next.panelTabLayout,'unified');
});
