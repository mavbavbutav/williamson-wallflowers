import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('host can choose approval destinations in one step from a guest submission card', async () => {
  const [hostJs, styles, hostHtml] = await Promise.all([
    readText('../../moments/host/host.js'),
    readText('../../moments/styles.css'),
    readText('../../moments/host/index.html')
  ]);

  assert.match(hostHtml, /id="submissionStatusFilter"/);
  assert.doesNotMatch(hostHtml, /aria-label="Submission status"/);
  assert.doesNotMatch(hostHtml, /data-view="share"/);
  assert.doesNotMatch(hostHtml, /id="sharePanel"/);

  assert.match(hostJs, /renderApprovalOptions/);
  assert.match(hostJs, /actionButton\("Approve", "is-success is-featured", \(\) => approveSubmission\(submission, getApprovalOptions\(actions\)\)\)/);
  assert.match(hostJs, /data-approval-option="party"/);
  assert.match(hostJs, /data-approval-option="capsule"/);
  assert.match(hostJs, /approveSubmission\(submission, getApprovalOptions\(actions\)\)/);
  assert.match(hostJs, /showInPartyView = false/);
  assert.match(hostJs, /addToCapsule = false/);
  assert.match(hostJs, /setSubmissionPartyView\(\{ \.\.\.submission, status: "approved" \}, true/);
  assert.match(hostJs, /createCapsuleItem/);
  assert.match(hostJs, /approved and added to \$\{partyLabel\} and the Time Capsule/);
  assert.match(hostJs, /approved and added to \$\{partyLabel\}/);
  assert.match(hostJs, /Submission approved and added to the Time Capsule/);
  assert.match(hostJs, /Add to Time Capsule/);
  assert.match(hostJs, /Already in Time Capsule/);
  assert.match(hostJs, /const focusSubmissionId = getParam\("submission"\)/);
  assert.match(hostJs, /function applySubmissionDeepLink/);
  assert.match(hostJs, /currentStatus = target\.status \|\| "pending"/);
  assert.match(hostJs, /data-submission-id/);
  assert.match(hostJs, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.doesNotMatch(hostJs, /data-approve-capsule/);
  assert.doesNotMatch(hostJs, /shouldAddToCapsuleOnApprove/);
  assert.doesNotMatch(hostJs, /Approved tab/);
  assert.match(styles, /\.host-decision-actions/);
  assert.match(styles, /\.approval-options/);
  assert.match(styles, /\.host-review-filter/);
  assert.match(styles, /\.decision-status/);
  assert.match(styles, /\.host-page \.media-card\.is-focused-submission/);
  assert.match(hostHtml, /<script type="module" src="host\.js\?v=[^"]+"><\/script>/);
  assert.match(hostHtml, /<link rel="stylesheet" href="\.\.\/styles\.css\?v=[^"]+" \/>/);
});

test('host Time Capsule includes adaptive 3D walk review controls', async () => {
  const [hostHtml, hostJs, styles] = await Promise.all([
    readText('../../moments/host/index.html'),
    readText('../../moments/host/host.js'),
    readText('../../moments/styles.css')
  ]);

  assert.match(hostHtml, /id="spatialLayoutPanel"/);
  assert.match(hostHtml, /id="spatialLayoutStatusPill"/);
  assert.match(hostHtml, /id="spatialLayoutHint"/);
  assert.match(hostHtml, /id="generateSpatialLayoutButton"/);
  assert.match(hostHtml, /id="refreshSpatialLayoutButton"/);
  assert.match(hostHtml, /id="publishSpatialLayoutButton"/);
  assert.match(hostHtml, /id="spatialClusterList"/);
  assert.match(hostHtml, /id="spatialLayoutEmpty"/);
  assert.match(hostJs, /let spatialLayout = null/);
  assert.match(hostJs, /let spatialClusters = \[\]/);
  assert.match(hostJs, /let spatialPlacements = \[\]/);
  assert.match(hostJs, /function loadSpatialLayoutDraft/);
  assert.match(hostJs, /function generateSpatialLayout/);
  assert.match(hostJs, /function publishSpatialLayout/);
  assert.match(hostJs, /function renderSpatialLayoutReview/);
  assert.match(hostJs, /function renderSpatialClusterCard/);
  assert.match(hostJs, /function saveSpatialCluster/);
  assert.match(hostJs, /\/host\/events\/\$\{encodeURIComponent\(eventId\)\}\/spatial-layouts\/draft/);
  assert.match(hostJs, /\/host\/events\/\$\{encodeURIComponent\(eventId\)\}\/spatial-layouts\/generate/);
  assert.match(hostJs, /\/host\/spatial-layouts\/\$\{encodeURIComponent\(spatialLayout\.id\)\}\/publish/);
  assert.match(hostJs, /\/host\/spatial-layouts\/\$\{encodeURIComponent\(spatialLayout\.id\)\}\/clusters\/\$\{encodeURIComponent\(clusterId\)\}/);
  assert.match(styles, /\.spatial-layout-panel/);
  assert.match(styles, /\.spatial-layout-actions/);
  assert.match(styles, /\.spatial-cluster-list/);
  assert.match(styles, /\.spatial-cluster-card/);
});

async function readText(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}
