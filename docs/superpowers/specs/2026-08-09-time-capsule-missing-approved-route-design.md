# Time Capsule Missing Approved Moments Route Design

## Goal

Make it obvious when approved guest submissions have not been added to a Wallflower Time Capsule, and provide a direct path for the host to review and add those submissions one at a time.

This change addresses the Sean's Promotion Celebration failure mode: submissions were approved, but the optional Time Capsule destination was not selected during approval, leaving a published capsule empty.

## Approved Interaction

The Time Capsule tab will show a contextual notice whenever one or more approved guest submissions are not represented by a Time Capsule item.

The notice will say:

- `1 approved moment isn't in the Time Capsule yet.`
- `<count> approved moments aren't in the Time Capsule yet.`

It will include a `Review and add individually` button. Activating the button will:

1. Switch the host workspace to the existing Review view.
2. Set the submission status filter to Approved.
3. Render the approved submission cards.
4. Move focus to the approved-submissions review area and scroll it into view.

Each eligible card will continue to use the existing `Add to Time Capsule` action. After an item is added, the missing count will update through the existing gallery refresh and render flow.

When no approved submissions are missing, the contextual notice will be hidden.

## Scope

### Included

- Compute approved submissions that are not already represented in `capsuleItems`.
- Track whether the current capsule-item request completed successfully before displaying the derived count.
- Add a contextual notice and one navigation button to the Time Capsule panel.
- Reuse the existing Review status filter and per-card `Add to Time Capsule` action.
- Preserve keyboard focus and smooth scrolling when moving between views.
- Add regression coverage for the notice, count, navigation, and existing individual action.
- Update the host JavaScript cache-buster if the host script changes.

### Excluded

- No bulk-add action.
- No automatic backfill.
- No change to the auto-approval settings.
- No backend endpoint, database, migration, or authorization change.
- No change to Party View routing.
- No change to rejected, pending, deleted, or host-authored submissions.

## Eligibility Rule

A submission is shown in the missing count only when all of the following are true:

- Its status is `approved`.
- It is not deleted.
- Its source is a guest submission rather than a host post.
- No current Time Capsule item has the same `submissionId`.

The frontend already receives both `submissions` and `capsuleItems`, so this calculation requires no new request or backend data.

## UI Placement

Add the contextual notice near the top of `#capsulePanel`, after the Time Capsule settings/status panel and before the private share card. This places the recovery path where a host notices the mismatch, without duplicating the approved-media grid inside the Time Capsule view.

Use existing panel, notice, button, and row-action styling where practical. Add only narrowly scoped CSS if the current utilities cannot provide a clear mobile layout.

## State and Data Flow

1. `loadGallery()` loads event details and submissions.
2. `loadCapsule()` marks capsule contents unavailable, loads Time Capsule items, and marks them available only after a successful response.
3. `renderCapsule()` derives the approved-but-missing submissions only when capsule contents are available.
4. The notice is shown with the derived count or hidden when the count is zero.
5. `Review and add individually` sets `currentView = "submissions"` and `currentStatus = "approved"`, synchronizes the select control, and calls `render()`.
6. The existing approved cards expose `Add to Time Capsule`.
7. The existing add request succeeds, refreshes local state, and removes that submission from the derived missing set.

The capsule-contents availability flag is transient page state. No new persistent state is introduced.

## Error Handling

- Navigation to the Approved review view is local and should not fail independently.
- Existing `addSubmissionToCapsule()` error handling remains authoritative for request failures.
- If capsule loading fails, do not show a potentially incorrect missing count based on unknown capsule contents.
- Duplicate protection remains enforced by the Worker and the current `isInCapsule()` check.

## Accessibility

- The count text will be exposed as normal readable content, not color alone.
- The navigation control will be a native button.
- After switching views, keyboard focus will move to the review filter or approved review heading.
- The current selected filter value will be synchronized before rendering.
- The interaction must remain usable at the existing mobile breakpoint.

## Testing

Extend the focused host approval/capsule UI tests to verify:

- The Time Capsule panel contains the missing-approved notice and navigation button.
- The derived count includes approved guest submissions absent from `capsuleItems`.
- Pending, rejected, host-authored, and already-in-capsule submissions are excluded.
- The notice is hidden for a zero count and uses correct singular/plural copy.
- The notice remains hidden when capsule items could not be loaded.
- The navigation handler switches to Review, selects Approved, renders, and focuses or scrolls to the review area.
- Approved cards still expose `Add to Time Capsule` individually.
- No bulk-add or automatic-routing behavior is introduced.

Run the focused Node test file first, followed by the worker's full `npm run check` validation if the focused test passes.

## Alternatives Considered

### Duplicate an approved-media list inside the Time Capsule tab

This would minimize navigation, but it would duplicate card rendering, media controls, filtering, and error states. It creates two places that must remain consistent and is not justified for this recovery path.

### Add all approved moments in one click

This would be fast, but it conflicts with the requested individual workflow and could expose unintended media in an already-published capsule. It also weakens the host's moderation boundary.

### Recommended: contextual count plus navigation to existing controls

This is the smallest change, makes the missing state visible where it matters, preserves individual review, and reuses the tested submission-card behavior.
