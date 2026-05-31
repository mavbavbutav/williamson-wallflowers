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
  assert.match(hostJs, /data-approve-capsule/);
  assert.match(hostJs, /Add to Time Capsule when approved/);
  assert.match(hostJs, /shouldAddToCapsuleOnApprove/);
  assert.match(hostJs, /createCapsuleItem/);
  assert.match(hostJs, /Submission approved and added to the Time Capsule/);
  assert.match(hostJs, /Add to Capsule/);
  assert.match(styles, /\.approve-capsule-option/);
  assert.match(hostHtml, /host\.js\?v=20260531-host-fun-1/);
  assert.match(hostHtml, /styles\.css\?v=20260531-host-fun-1/);
});

async function readText(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}
