import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('host can opt into adding a submission to Time Capsule while approving it', async () => {
  const [hostJs, styles, hostHtml] = await Promise.all([
    readText('../../moments/host/host.js'),
    readText('../../moments/styles.css'),
    readText('../../moments/host/index.html')
  ]);

  assert.match(hostJs, /approveSubmission\(submission\)/);
  assert.match(hostJs, /Approve \+ Time Capsule/);
  assert.match(hostJs, /approveSubmission\(submission, \{ addToCapsule: true \}\)/);
  assert.match(hostJs, /createCapsuleItem/);
  assert.match(hostJs, /Submission approved and added to the Time Capsule/);
  assert.match(hostJs, /Add to Time Capsule/);
  assert.match(hostJs, /Already in Time Capsule/);
  assert.doesNotMatch(hostJs, /data-approve-capsule/);
  assert.doesNotMatch(hostJs, /shouldAddToCapsuleOnApprove/);
  assert.match(styles, /\.host-decision-actions/);
  assert.match(styles, /\.decision-status/);
  assert.match(hostHtml, /<script type="module" src="host\.js\?v=[^"]+"><\/script>/);
  assert.match(hostHtml, /<link rel="stylesheet" href="\.\.\/styles\.css\?v=[^"]+" \/>/);
});

async function readText(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}
