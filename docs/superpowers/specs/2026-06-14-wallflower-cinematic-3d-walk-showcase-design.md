# Wallflower Moments Cinematic 3D Walk Showcase Design

Date: 2026-06-14
Status: Approved design direction, awaiting implementation plan

## Summary

Improve the Time Capsule `3D Walk` from a dense spatial cluster into a high-end cinematic showcase. The experience should feel like moving through premium photo stations: each image gets enough physical space to stand alone, the camera frames the full photo clearly, and guests can tap or click a station to open that moment full-screen.

The generated spatial layout remains useful, but it should not be rendered literally when coordinates are too tight. Spatial data should guide route order, grouping, and atmosphere. The guest renderer should normalize that data into a polished station-to-station presentation.

## Approved Direction

Use a blend of:

- Cinematic Stations as the primary interaction.
- Zone Pods as supporting context.

This means one moment owns the viewer's attention at a time, while nearby related moments and adaptive zones can appear as subtle context. The result should feel like a fancy high-end tech 3D showcase, not a free-roam pile of photos.

## Current Problem

The current WebGL view has three presentation issues:

- Photos are too close together, so they visually merge into a blob.
- The camera travels too close to each image, so the photo fills the viewport without room to read it as a distinct object.
- The image planes are not strong interaction targets, so guests cannot naturally select a photo and view it full-screen from the 3D walk.

These are viewer and staging issues. They should be fixed in the guest renderer even when the generated coordinates remain imperfect.

## Product Principles

- Every photo deserves a hero moment.
- The walk should feel cinematic first and analytically spatial second.
- The generated route may influence layout, but the renderer must enforce minimum spacing and camera-safe framing.
- Guests should never need to understand zones, confidence, metadata, or generation logic.
- Tapping or clicking a photo station should open the existing full-screen moment viewer.
- Mobile should feel intentional, not like a scaled-down desktop canvas.

## Guest Experience

### Cinematic Stations

The `3D Walk` should be organized as a sequence of stations. Each station represents one Time Capsule item.

At any scroll position:

- One station is the active hero.
- The active photo is large, fully visible, and framed with enough negative space.
- Previous and next stations may appear in the distance as soft context.
- Related zone/pod information can influence lighting, route bend, or background positioning, but should not compete with the active photo.

The user experience should feel closer to a 3D slideshow than a reconstructed floorplan.

### Full Photo Visibility

The active station should preserve the complete photo or video thumbnail. The renderer should not crop or over-zoom the active image.

Rules:

- The active image plane should face the camera.
- The camera should stay far enough away to show the whole framed image plus surrounding stage.
- Image aspect ratio should be preserved.
- Portrait and landscape photos should use different plane dimensions instead of forcing one shape.
- The photo should be readable as an object in space, not a texture pressed against the camera.

### Full-Screen Interaction

Every station needs a clear interaction target.

Desktop:

- Hovering an active or near-active station can show a subtle focus outline or "View" affordance.
- Clicking the station opens the existing full-screen moment modal using the same item index as the timeline.

Mobile:

- Tapping the active station opens the moment full-screen.
- A small fixed `View photo` / `View moment` button can appear when the station is active if direct mesh tapping is hard to discover.

Keyboard:

- Left/right or up/down can move between stations.
- Enter or Space can open the active station full-screen.
- Escape closes the full-screen modal through the existing modal behavior.

### Scroll Behavior

Scroll should map to station focus, not raw camera drift.

The route should be divided into station segments:

- Scroll progress determines the active station index and interpolation between stations.
- The camera eases between predefined station camera poses.
- Near each station, the motion should slow enough for the image to be viewed.
- Optional snap behavior can settle the scroll near station centers without feeling jerky.

## Renderer Architecture

Add a `spatial station view model` layer in the capsule frontend.

Inputs:

- `items`
- `spatialLayout`
- `spatialClusters`
- `spatialPlacements`
- fallback chronological placements when no layout exists

Output:

- ordered station objects with item, cluster, focus point, camera pose, display size, route distance, and interaction metadata.

The station view model should normalize all source layouts into showcase-safe positions.

## Station Layout Rules

### Minimum Spacing

Coordinates from the generator should be treated as hints. The guest renderer should enforce minimum spacing.

Recommended initial values:

- Minimum forward distance between stations: 8 to 12 world units.
- Active photo camera distance: 6 to 9 world units depending on aspect ratio and viewport.
- Side context offset: 4 to 7 world units from the main route.
- Vertical variation should be subtle, usually less than 1 world unit for active stations.

The exact values can be tuned in browser QA, but the important rule is that no two active stations should overlap visually.

### Zone Pods

When clusters exist, they should become zone-aware staging hints:

- Stations in the same cluster can share lighting tint, route curvature, or subtle background rails.
- Cluster labels can appear only as small, premium context when useful.
- Cluster membership should not create dense piles of photos.

Each station still gets its own hero pose even if several moments belong to the same cluster.

### Route Shape

The route should be a smooth cinematic rail:

- Main path advances forward by station index.
- X offsets and gentle curves can keep depth and parallax.
- Previous and next station planes can be visible at lower opacity, smaller scale, or farther depth.
- Far stations should fade or simplify to avoid visual clutter.

## Camera Model

The camera should use station poses instead of directly following raw placement positions.

Each station gets:

- `focus`: the point the camera looks at.
- `cameraPosition`: a pullback position that sees the full image.
- `lookAhead`: a small offset toward the next station during transitions.
- `framingScale`: derived from aspect ratio and viewport.

The active photo plane should generally face the camera. During transitions, the active station can subtly rotate toward the camera while inactive stations can angle away for depth.

## Interaction Model

Use Three.js raycasting for photo planes:

- Store the Time Capsule item index on each station mesh.
- On pointer move, highlight the station under the pointer.
- On click/tap, call the existing `openSlide(index, { autoPlay: false })`.
- If the hit target is not reliable on mobile, keep the active station index and expose a DOM `View moment` button over the canvas.

Do not create a separate full-screen viewer. Reuse the existing modal so slideshow, videos, audio, captions, and escape/close behavior stay consistent.

## Visual Design

The scene should feel premium and restrained:

- Dark, quiet background.
- Soft route ribbon or floor glow.
- Subtle frame around the active station.
- Previous/next stations visible enough to suggest depth but not enough to distract.
- No decorative clutter.
- Labels should be small and elegant.

The active station can include:

- Station number.
- Moment title or short caption.
- Small `View moment` affordance.

The UI should avoid visible technical language such as coordinates, confidence, raw zones, or generation details.

## Fallbacks

If WebGL fails or reduced motion is enabled:

- Show the existing static path, but update it to match the station concept.
- Cards should be generously spaced and individually selectable.
- Each static card should open the full-screen moment viewer.

If there are too few items:

- One item: present a single 3D hero station.
- Two items: present two large stations with a short transition.
- Many items: preserve the station model and preload only nearby textures.

## Performance

The station model should improve performance by limiting visual clutter.

Rules:

- Render full textures for the active, previous, and next few stations.
- Use fallback canvas textures or reduced opacity for far stations.
- Dispose textures and geometries when rebuilding the scene.
- Keep mobile pixel ratio capped.
- Avoid unbounded animation loops; render on scroll, resize, texture load, and active transitions.

## Testing

Automated tests:

- The capsule viewer builds a fallback station route when no spatial layout exists.
- The station route enforces a minimum distance between stations.
- The active station can map back to the correct Time Capsule item index.
- The WebGL code includes pointer/raycast handlers for station selection.
- The capsule asset cache-buster changes when the viewer code changes.

Browser QA:

- Desktop: `3D Walk` opens, one station is visually dominant, click opens full-screen modal.
- Mobile: station target or `View moment` button opens the modal, no horizontal overflow.
- Dense event: photos no longer overlap into a blob.
- Sparse event: one or two moments still look intentional.
- Reduced motion: static station path remains usable.
- Console: no relevant errors or warnings.

## Out Of Scope

- Requiring hosts to manually position every image in 3D.
- Building a free-roam first-person navigation mode.
- Guaranteeing a real venue floorplan.
- Replacing the existing timeline, feed, or TV slideshow.
- Adding guest social interactions.

## Implementation Notes

The likely implementation path is:

1. Add a station view-model builder in `moments/capsule/capsule.js`.
2. Normalize published spatial placements and fallback placements into station positions with enforced spacing.
3. Change scene rendering to show station planes instead of raw placement planes.
4. Change camera movement to focus on station poses.
5. Add raycasting and/or a DOM active-station `View moment` button.
6. Update reduced-motion/static fallback cards to open the existing modal.
7. Bump capsule asset cache-busters.
8. Validate with desktop and mobile browser runs against at least one dense real event.
