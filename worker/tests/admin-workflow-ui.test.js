import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('admin page prioritizes event operations and setup workflow', async () => {
  const [adminHtml, adminJs, styles] = await Promise.all([
    readText('../../moments/admin/index.html'),
    readText('../../moments/admin/admin.js'),
    readText('../../moments/styles.css')
  ]);

  assert.match(adminHtml, /id="attentionPanel"/);
  assert.match(adminHtml, /id="assignTagForm"/);
  assert.match(adminHtml, /id="maintenancePanel"/);
  assert.doesNotMatch(adminHtml, /id="cleanupButton">Run cleanup<\/button>[\s\S]*id="signOutButton"/);
  assert.ok(adminHtml.indexOf('id="eventsPanel"') < adminHtml.indexOf('id="tagsPanel"'));
  assert.match(adminHtml, /admin\.js\?v=20260531-admin-ux-1/);
  assert.match(adminHtml, /styles\.css\?v=20260531-admin-ux-1/);

  assert.match(adminJs, /function renderAttention/);
  assert.match(adminJs, /function renderAssignTagForm/);
  assert.match(adminJs, /data-open/);
  assert.match(adminJs, /Copy guest link/);
  assert.match(adminJs, /Open host/);
  assert.match(adminJs, /Open capsule/);
  assert.match(adminJs, /More actions/);
  assert.match(adminJs, /setup-guide"\)\.classList\.toggle\("is-collapsed"/);
  assert.doesNotMatch(adminJs, /<span class="muted link-preview">\$\{escapeHtml\(hostUrl\)\}<\/span>/);

  assert.match(styles, /\.attention-panel/);
  assert.match(styles, /\.event-card-list/);
  assert.match(styles, /\.link-action-group/);
  assert.match(styles, /\.maintenance-panel/);
  assert.match(styles, /\.setup-guide\.is-collapsed/);
});

async function readText(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}
