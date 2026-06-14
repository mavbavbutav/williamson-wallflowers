# Wallflower Moments WebGL Spatial Time Capsule Design

Date: 2026-06-14
Status: Approved design, awaiting implementation plan

## Summary

Add an optional WebGL "3D Walk" experience to private Wallflower Moments Time Capsules. The feature generates an adaptive spatial layout from approved capsule media, lets the host or admin review the generated layout, and publishes a polished guest-facing scroll experience.

The layout must adapt to whatever evidence is available. It must not assume a traditional venue, fixed room names, or a complete floorplan. When spatial evidence is weak, the experience should still look intentional as a cinematic 3D timeline.

## Product Principles

- No fixed zone taxonomy. Generated groups are adaptive spatial clusters, not hard-coded rooms.
- Always produce a polished result. Strong evidence creates a spatial walk; weak evidence creates a beautiful memory path.
- Admin review improves quality without creating a heavy editing workflow.
- Guests see only the finished experience, not raw metadata, uncertainty, or internal AI evidence.
- Existing Time Capsule timeline, swipe feed, and TV/slideshow views remain available as fallbacks.

## Existing Context

The current Time Capsule stack already has:

- Private capsule links at `/moments/capsule/?event=<eventId>#token=<shareToken>`.
- Published capsule API at `GET /moments-api/capsules/:eventId`.
- Host/admin approval and Time Capsule item management.
- Media token handling for private media delivery.
- Media audit fields for EXIF/GPS, capture time, dimensions, dominant colors, scene tags, lighting tags, composition tags, background cues, visible text, summaries, and quality scores.
- Existing capsule views in `moments/capsule/index.html` and `moments/capsule/capsule.js`.

The new feature should build on these surfaces instead of replacing them.

## User Experience

### Admin Review

The admin or host can generate a draft 3D layout for a published or draft Time Capsule. The review screen should show:

- Generated adaptive clusters with editable labels.
- Short evidence summaries, such as repeated background texture, similar lighting, close capture times, GPS agreement, or low-confidence timeline grouping.
- Thumbnail groups for each cluster.
- Confidence indicators that guide review but do not appear to guests.
- Controls to rename clusters, merge clusters, split clusters, drag moments between clusters, reorder the route, preview fallback mode, regenerate, and publish.

The generated labels are suggestions only. They should be derived from event media, such as "soft gold backdrop", "window-lit candids", or "late sequence", and remain fully editable.

### Guest WebGL Walk

The guest capsule gains a `3D Walk` view when a published spatial layout exists. The view should:

- Render a full-screen or near-full-screen Three.js scene.
- Move the camera through the published route as the guest scrolls.
- Display capsule photos and video thumbnails as framed planes in 3D space.
- Display audio-only moments as premium audio cards placed by timestamp and nearby cluster context.
- Preserve timestamp order within clusters.
- Use depth, scale, soft lighting, and restrained labels to make the path feel premium.
- Avoid visible uncertainty indicators.
- Offer a direct way back to the standard timeline or feed.

The guest copy should describe the experience as a spatial memory or walk through the moments, not as a guaranteed reconstructed floorplan.

## Fallback Ladder

The generator must choose the strongest valid layout it can support:

1. Spatial walk: GPS/EXIF, timestamps, and visual analysis agree well enough to create spatially distinct clusters.
2. Visual cluster walk: GPS is absent or weak, but visual background, lighting, color, and timestamp patterns create convincing clusters.
3. Cinematic timeline path: media evidence is sparse or mixed, so moments are arranged in a polished chronological 3D route.
4. Standard capsule fallback: no published layout, too few visible items, WebGL unsupported, or runtime error.

Every state should be deliberate and visually complete.

## Data Model

Keep normal Time Capsule items as the source of truth. Add a separate spatial layout layer.

### `time_capsule_spatial_layouts`

- `id`
- `event_id`
- `status`: `draft`, `published`, `failed`, or `archived`
- `version`
- `generation_status`: `queued`, `running`, `ready`, or `failed`
- `layout_mode`: `spatial`, `visual_cluster`, or `timeline_path`
- `confidence_score`
- `input_fingerprint`
- `generator_version`
- `error_message`
- `published_at`
- `created_at`
- `updated_at`

### `time_capsule_spatial_clusters`

- `id`
- `layout_id`
- `label`
- `summary`
- `route_order`
- `anchor_x`
- `anchor_y`
- `anchor_z`
- `confidence_score`
- `evidence_json`
- `created_at`
- `updated_at`

### `time_capsule_spatial_placements`

- `id`
- `layout_id`
- `cluster_id`
- `time_capsule_item_id`
- `route_order`
- `position_x`
- `position_y`
- `position_z`
- `rotation_x`
- `rotation_y`
- `rotation_z`
- `scale`
- `confidence_score`
- `evidence_json`
- `created_at`
- `updated_at`

Store raw evidence for admin/debug use only. Guest API responses should return display-ready cluster labels, summaries, route order, and placement coordinates, not raw EXIF/GPS or private analysis details.

## API Design

### Host/Admin APIs

- `POST /moments-api/host/events/:eventId/spatial-layouts/generate`
  - Creates or replaces a draft layout from current visible capsule items.
- `GET /moments-api/host/events/:eventId/spatial-layouts/draft`
  - Returns the draft layout, clusters, placements, confidence, and admin evidence.
- `PATCH /moments-api/host/spatial-layouts/:layoutId`
  - Updates draft-level settings and route order.
- `PATCH /moments-api/host/spatial-layouts/:layoutId/clusters/:clusterId`
  - Renames, reorders, merges, or updates a cluster.
- `PATCH /moments-api/host/spatial-layouts/:layoutId/placements/:placementId`
  - Moves an item between clusters or updates placement/order.
- `POST /moments-api/host/spatial-layouts/:layoutId/publish`
  - Publishes the draft and archives any previous published layout.

Equivalent admin-token endpoints may be added if the admin dashboard needs global access without host tokens.

### Guest API

Extend `GET /moments-api/capsules/:eventId` to include:

- `spatialLayout`: published layout metadata, mode, and route summary.
- `spatialClusters`: published display clusters.
- `spatialPlacements`: published item placement data keyed by Time Capsule item id.

Only include this payload when a published layout exists and the share token is valid.

## Generation Logic

The first implementation should be deterministic and explainable, using existing metadata before adding more expensive AI orchestration.

Inputs:

- Capsule item order and captured time.
- Submission created time when capture time is absent.
- EXIF capture time and GPS when available.
- Media dimensions and orientation.
- Dominant colors.
- Scene, lighting, composition, and background cues.
- Visible text and summary.
- Quality score and media type.
- Audio-only item metadata, captions, guest notes, and capture/submission time.

Process:

1. Build a normalized feature vector for each visual item.
2. Group items by strong GPS proximity when available.
3. Group remaining items by visual similarity and capture-time proximity.
4. Create fallback chronological clusters when similarity confidence is low.
5. Assign stable 3D anchor positions to clusters along a route.
6. Place items within each cluster using timestamp order, aspect ratio, and media count.
7. Place audio-only and other non-visual moments by timestamp, capsule order, and nearby cluster context.
8. Save confidence and evidence for admin review.

The generator should produce stable results for the same input fingerprint so repeated page loads do not shift the guest experience.

## Frontend Design

### Admin

Add a focused review section to the existing host/admin Time Capsule management flow. The UI should avoid a complex 3D editor in v1. It should use list and board interactions that are easy to review on desktop and workable on mobile:

- Draft status card.
- Generate/regenerate/publish controls.
- Cluster cards with thumbnails.
- Inline rename.
- Merge and split actions.
- Drag or select-to-move moments between clusters.
- Preview button that opens the guest WebGL route using the draft layout.

### Guest

Add a `3D Walk` tab or button to the capsule viewer when `spatialLayout` is present. The scene can be implemented with Three.js using:

- `Scene`
- `PerspectiveCamera`
- `WebGLRenderer`
- Plane meshes for images/video thumbnails and card meshes for audio-only moments.
- Texture loading with existing private media URLs.
- Scroll-driven camera movement.
- Resize handling and mobile performance caps.

The existing timeline/feed should remain the default fallback. If `prefers-reduced-motion` is enabled, start with a static spatial overview and offer manual next/previous controls.

## Privacy And Security

- Do not expose raw GPS, camera model, uploader IP, or internal AI evidence in guest responses.
- Keep guest access on the existing private share-token model.
- Keep media delivery on short-lived media URLs.
- Avoid logging private captions, exact coordinates, or guest-uploaded content in errors.
- Treat admin evidence as private host/admin data.
- If a layout is regenerated after items are deleted or rejected, deleted/rejected items must not remain in published placements.

## Validation

Backend tests:

- Layout generation creates a draft from approved visible capsule items.
- Generator falls back to `timeline_path` when spatial evidence is weak.
- Published guest API excludes private evidence and raw EXIF/GPS.
- Deleted, rejected, or hidden items are excluded.
- Publishing a layout archives previous published layout versions.

Frontend tests:

- Capsule viewer shows `3D Walk` only when a published spatial layout exists.
- Viewer falls back cleanly when WebGL is unavailable.
- Admin review UI can rename clusters and move items.
- Existing timeline, swipe feed, and slideshow behavior still work.

Manual/browser QA:

- Desktop and mobile rendering of the WebGL route.
- Canvas is nonblank and photos load through private URLs.
- Scroll movement is smooth enough on mobile.
- Reduced-motion mode avoids forced camera movement.
- Fallback path works with no layout, no WebGL, and sparse media.

## Rollout Plan

1. Data/API foundation with draft and published layouts.
2. Deterministic generator using current metadata.
3. Admin review and publish UI.
4. Guest `3D Walk` view with fallback to existing capsule views.
5. Browser QA and performance tuning.
6. Later enhancement: stronger AI clustering and optional venue-aware reasoning.

## Out Of Scope For V1

- Guaranteeing a physically accurate venue floorplan.
- Requiring hosts to draw a map.
- Requiring GPS data.
- Replacing the existing timeline, swipe feed, or TV slideshow.
- Exposing raw model analysis to guests.
- Supporting arbitrary public sharing beyond the existing private capsule token.
