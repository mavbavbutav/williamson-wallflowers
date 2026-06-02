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
  assert.match(adminHtml, /id="lightingPanel"/);
  assert.match(adminHtml, /id="wallDeviceForm"/);
  assert.match(adminHtml, /id="maintenancePanel"/);
  assert.doesNotMatch(adminHtml, /id="cleanupButton">Run cleanup<\/button>[\s\S]*id="signOutButton"/);
  assert.ok(adminHtml.indexOf('id="eventsPanel"') < adminHtml.indexOf('id="tagsPanel"'));
  assert.match(adminHtml, /admin\.js\?v=20260602-lighting-1/);
  assert.match(adminHtml, /styles\.css\?v=20260602-lighting-1/);

  assert.match(adminJs, /function renderAttention/);
  assert.match(adminJs, /function renderAssignTagForm/);
  assert.match(adminJs, /data-open/);
  assert.match(adminJs, /Copy guest link/);
  assert.match(adminJs, /Open host/);
  assert.match(adminJs, /Open capsule/);
  assert.match(adminJs, /More actions/);
  assert.match(adminJs, /data-delete-tag/);
  assert.match(adminJs, /function deleteTag/);
  assert.match(adminJs, /Delete reusable tag/);
  assert.match(adminJs, /data-delete-event/);
  assert.match(adminJs, /function deleteEvent/);
  assert.match(adminJs, /Permanently delete/);
  assert.match(adminJs, /function renderWallDevices/);
  assert.match(adminJs, /function showBridgeConfig/);
  assert.match(adminJs, /data-test-trigger/);
  assert.match(adminJs, /setup-guide"\)\.classList\.toggle\("is-collapsed"/);
  assert.doesNotMatch(adminJs, /<span class="muted link-preview">\$\{escapeHtml\(hostUrl\)\}<\/span>/);

  assert.match(styles, /\.attention-panel/);
  assert.match(styles, /\.event-card-list/);
  assert.match(styles, /\.link-action-group/);
  assert.match(styles, /\.maintenance-panel/);
  assert.match(styles, /\.setup-guide\.is-collapsed/);
  assert.match(styles, /\.admin-page \.panel/);
  assert.match(styles, /\.admin-page \.button/);
  assert.match(styles, /\.admin-page \.status-pill/);
  assert.match(styles, /\.admin-page \.data-panel/);
  assert.match(styles, /\.admin-page \.attention-item/);
  assert.match(styles, /\.admin-page \.admin-mobile-card/);
  assert.match(styles, /\.lighting-form/);
  assert.match(styles, /\.preset-grid/);
  assert.match(styles, /\.bridge-config/);
});

async function readText(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}
