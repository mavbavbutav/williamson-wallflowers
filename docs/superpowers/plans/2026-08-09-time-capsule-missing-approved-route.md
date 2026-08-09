# Time Capsule Missing Approved Moments Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show hosts when approved guest submissions are absent from the Time Capsule and route them directly to the existing per-submission add controls.

**Architecture:** Keep the feature entirely in the static host frontend. Derive the missing set from the already-loaded `submissions` and `capsuleItems`, guard the result with a transient capsule-load-success flag, and navigate to the existing Review view filtered to Approved. No Worker, D1, R2, endpoint, or persistent-state change is required.

**Tech Stack:** Static HTML, vanilla JavaScript ES modules, Node.js built-in test runner, existing Wallflower Moments host demo.

## Global Constraints

- Preserve the existing individual `Add to Time Capsule` action; do not add a bulk action.
- Do not alter automatic approval, Party View routing, backend APIs, database schema, authorization, or production data.
- Exclude pending, rejected, deleted, host-authored, and already-in-capsule submissions from the missing count.
- Hide the recovery route until capsule contents have loaded successfully, and hide it when the count is zero.
- Use the approved singular/plural copy and button label exactly.
- Preserve unrelated dirty files, especially `moments/admin/admin.js` and `moments/admin/index.html`.
- Do not deploy, push, or run remote migrations without separate explicit approval.

## File Map

- Modify `worker/tests/host-approve-capsule-workflow.test.js`: add the focused static UI contract test.
- Modify `moments/host/index.html`: add the contextual recovery panel and update the host-script cache-buster.
- Modify `moments/host/host.js`: track successful capsule loading, derive missing approved submissions, render the notice, and navigate to Approved review.
- No CSS file is expected to change; reuse `panel`, `panel-heading`, `status-pill`, `muted`, `row-actions`, and `small-button`.

---

### Task 1: Add the contextual individual-review route

**Files:**
- Modify: `worker/tests/host-approve-capsule-workflow.test.js`
- Modify: `moments/host/index.html:289-330`
- Modify: `moments/host/host.js:14-18, 38-70, 115-155, 595-617`

**Interfaces:**
- Consumes: existing `submissions`, `capsuleItems`, `currentView`, `currentStatus`, `isInCapsule(submissionId)`, `render()`, `qs(selector)`, and the `#submissionStatusFilter` control.
- Produces: `capsuleContentsLoaded: boolean`, `getApprovedSubmissionsMissingFromCapsule(): Array<object>`, `renderMissingApprovedCapsuleRoute(): void`, and `reviewApprovedCapsuleCandidates(): void`.

- [ ] **Step 1: Add the failing UI contract test**

Append this test before `readText()` in `worker/tests/host-approve-capsule-workflow.test.js`:

```js
test('Time Capsule points hosts to approved guest moments that are still missing', async () => {
  const [hostHtml, hostJs] = await Promise.all([
    readText('../../moments/host/index.html'),
    readText('../../moments/host/host.js')
  ]);

  assert.match(hostHtml, /id="capsuleMissingApproved"/);
  assert.match(hostHtml, /id="capsuleMissingApprovedCount"/);
  assert.match(hostHtml, /id="capsuleMissingApprovedMessage"/);
  assert.match(hostHtml, /id="reviewMissingCapsuleButton"/);
  assert.match(hostHtml, /Review and add individually/);

  assert.match(hostJs, /let capsuleContentsLoaded = false/);
  assert.match(hostJs, /function getApprovedSubmissionsMissingFromCapsule\(\)/);
  assert.match(hostJs, /submission\.status === "approved"/);
  assert.match(hostJs, /submission\.source !== "host"/);
  assert.match(hostJs, /!submission\.deletedAt/);
  assert.match(hostJs, /!isInCapsule\(submission\.id\)/);
  assert.match(hostJs, /capsuleContentsLoaded = true/);
  assert.match(hostJs, /function renderMissingApprovedCapsuleRoute\(\)/);
  assert.match(hostJs, /panel\.hidden = !capsuleContentsLoaded \|\| count === 0/);
  assert.match(hostJs, /1 approved moment isn't in the Time Capsule yet\./);
  assert.match(hostJs, /approved moments aren't in the Time Capsule yet\./);
  assert.match(hostJs, /function reviewApprovedCapsuleCandidates\(\)/);
  assert.match(hostJs, /currentView = "submissions";[\s\S]*currentStatus = "approved";[\s\S]*render\(\)/);
  assert.match(hostJs, /#submissionStatusFilter/);
  assert.match(hostJs, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.doesNotMatch(`${hostHtml}\n${hostJs}`, /Add all approved/i);
});
```

- [ ] **Step 2: Run the focused test and confirm the intended failure**

Run from the repository root:

```powershell
node --test worker/tests/host-approve-capsule-workflow.test.js
```

Expected: FAIL in `Time Capsule points hosts to approved guest moments that are still missing` because `capsuleMissingApproved` is absent.

- [ ] **Step 3: Add the contextual panel to the Time Capsule view**

In `moments/host/index.html`, place this block after `#capsuleNotice` and before `#shareCard`:

```html
<section class="panel" id="capsuleMissingApproved" hidden>
  <div class="panel-heading">
    <div>
      <span class="status-pill" id="capsuleMissingApprovedCount">0</span>
      <h3>Approved moments ready to add</h3>
      <p class="muted" id="capsuleMissingApprovedMessage"></p>
    </div>
  </div>
  <div class="row-actions">
    <button class="small-button is-primary" type="button" id="reviewMissingCapsuleButton">Review and add individually</button>
  </div>
</section>
```

Change the host module cache-buster to:

```html
<script type="module" src="host.js?v=20260809-capsule-review-route-1"></script>
```

- [ ] **Step 4: Track whether capsule contents are safe to compare**

Add transient state beside `capsuleItems` in `moments/host/host.js`:

```js
let capsuleItems = [];
let capsuleContentsLoaded = false;
```

Replace `loadCapsule()` with this version so the availability flag is reset before every request and set only after the capsule payload is assigned:

```js
async function loadCapsule({ silent = false } = {}) {
  if (!eventRecord?.timeCapsule?.enabled) return;

  capsuleContentsLoaded = false;
  try {
    const payload = await hostRequest(`/host/events/${encodeURIComponent(eventId)}/time-capsule`);
    timeCapsule = payload.timeCapsule || null;
    capsuleItems = payload.items || [];
    capsuleContentsLoaded = true;
    await loadSpatialLayoutReview({ silent: true });
    if (!silent) setNotice(qs("#capsuleNotice"), "Time Capsule refreshed.", "success");
  } catch (error) {
    if (!silent) setNotice(qs("#capsuleNotice"), error.message || "Could not load the Time Capsule.", "error");
  }
}
```

In the `loadGallery()` branch for an event without a Time Capsule, reset it with the other capsule state:

```js
capsuleContentsLoaded = false;
```

- [ ] **Step 5: Derive and render the missing-approved state**

Call `renderMissingApprovedCapsuleRoute()` from `renderCapsule()` after the title/status state is rendered and before capsule cards are appended.

Add these functions near `renderCapsule()`:

```js
function getApprovedSubmissionsMissingFromCapsule() {
  if (!capsuleContentsLoaded) return [];

  return submissions.filter((submission) => (
    submission.status === "approved"
    && submission.source !== "host"
    && !submission.deletedAt
    && !isInCapsule(submission.id)
  ));
}

function renderMissingApprovedCapsuleRoute() {
  const panel = qs("#capsuleMissingApproved");
  const missing = getApprovedSubmissionsMissingFromCapsule();
  const count = missing.length;

  panel.hidden = !capsuleContentsLoaded || count === 0;
  qs("#capsuleMissingApprovedCount").textContent = String(count);
  qs("#capsuleMissingApprovedMessage").textContent = count === 1
    ? "1 approved moment isn't in the Time Capsule yet."
    : `${count} approved moments aren't in the Time Capsule yet.`;
}
```

This intentionally calculates from existing frontend state and makes no request.

- [ ] **Step 6: Navigate to the existing Approved review controls**

Bind the new button in `init()`:

```js
qs("#reviewMissingCapsuleButton").addEventListener("click", reviewApprovedCapsuleCandidates);
```

Add the navigation function near the other view helpers:

```js
function reviewApprovedCapsuleCandidates() {
  currentView = "submissions";
  currentStatus = "approved";
  render();

  const reviewPanel = qs("#submissionsPanel");
  const filter = qs("#submissionStatusFilter");
  window.requestAnimationFrame(() => {
    filter.focus({ preventScroll: true });
    reviewPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
```

`renderSubmissions()` already calls `updateSubmissionFilter()`, which synchronizes the select value before focus moves to it.

- [ ] **Step 7: Run the focused test and confirm it passes**

Run:

```powershell
node --test worker/tests/host-approve-capsule-workflow.test.js
```

Expected: all tests in the file PASS.

- [ ] **Step 8: Run syntax and full regression validation**

Run:

```powershell
Set-Location worker
npm run check
npm test
```

Expected: Worker syntax check passes and the complete Node test suite reports zero failures.

- [ ] **Step 9: Verify the flow in the local demo on desktop and mobile**

Serve the repository root:

```powershell
python -m http.server 8765
```

Open:

```text
http://localhost:8765/moments/host/?event=demo-live#token=demo-host
```

Verify at desktop width and a 390-pixel mobile viewport:

1. Open the Time Capsule tab.
2. Confirm the panel says `1 approved moment isn't in the Time Capsule yet.`
3. Activate `Review and add individually`.
4. Confirm Review becomes active, Approved is selected, the filter receives focus, and the approved card is visible.
5. Confirm the card offers the existing `Add to Time Capsule` action.
6. Add the demo item, return to Time Capsule, and confirm the missing panel is hidden.
7. Confirm no bulk-add control appears and the layout remains readable without horizontal overflow.

- [ ] **Step 10: Review the scoped diff and commit the feature**

Run:

```powershell
git diff --check
git status --short
git diff -- moments/host/index.html moments/host/host.js worker/tests/host-approve-capsule-workflow.test.js
```

Confirm only the three planned files are part of the feature diff and all pre-existing unrelated changes remain untouched. Then commit only the planned files:

```powershell
git add moments/host/index.html moments/host/host.js worker/tests/host-approve-capsule-workflow.test.js
git commit -m "feat: surface approved moments missing from capsules"
```
