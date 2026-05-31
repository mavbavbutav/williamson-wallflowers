# Williamson Wallflowers Worker

This Cloudflare Worker receives the Williamson Wallflowers inquiry form and powers the hidden Wallflower Moments and Wallflower Time Capsule add-on.

The public flower wall site stays static on GitHub Pages. The Moments frontend is intentionally hidden under `/moments/`, `/moments/host/`, `/moments/capsule/`, and `/moments/admin/`; do not link hidden host/admin flows from the public homepage.

## Setup

1. Verify `jjentertainmentsolutions.com` in Resend.
2. Create a Resend API key with sending permission.
3. Create the Moments storage:

   ```bash
   cd worker
   npx wrangler d1 create williamson-wallflowers-moments
   npx wrangler r2 bucket create williamson-wallflowers-moments
   ```

4. Copy the D1 `database_id` into `wrangler.toml`.
5. Add secrets:

   ```bash
   npx wrangler secret put resend
   npx wrangler secret put MOMENTS_ADMIN_TOKEN
   ```

6. Apply the D1 migration and deploy:

   ```bash
   npm install
   npm run migrate:remote
npx wrangler deploy
```

7. Optional later: configure a branded Worker custom domain after `williamsonwallflowers.com` is added as a Cloudflare zone:

   ```text
   api.williamsonwallflowers.com
   ```

The existing inquiry form can keep posting to the current `workers.dev` URL or move to `https://api.williamsonwallflowers.com/`. The Moments app expects the branded API domain by default.

For the current live test setup, Moments uses:

```text
https://williamson-wallflowers-inquiry.johnmartinferguson.workers.dev/moments-api
```

The Worker sends with the display name `Williamson Wallflowers` from the verified JJE sender domain:

```text
Williamson Wallflowers <noreply@jjentertainmentsolutions.com>
```

## Wallflower Moments URLs

Guest scan URL:

```text
https://williamsonwallflowers.com/moments/?t=<tagCode>
```

Host gallery URL:

```text
https://williamsonwallflowers.com/moments/host/?event=<eventId>#token=<hostToken>
```

Private Wallflower Time Capsule URL:

```text
https://williamsonwallflowers.com/moments/capsule/?event=<eventId>#token=<shareToken>
```

Admin URL:

```text
https://williamsonwallflowers.com/moments/admin/
```

Admin access uses the `MOMENTS_ADMIN_TOKEN` secret. Hosts use event-specific magic links; guests do not need an account.

## API Overview

- `GET /moments-api/tags/:tagCode`
- `POST /moments-api/events/:eventId/submissions`
- `GET /moments-api/host/events/:eventId/submissions` with host token in `Authorization: Bearer ...`
- `PATCH /moments-api/host/submissions/:submissionId` with host token in `Authorization: Bearer ...`
- `DELETE /moments-api/host/submissions/:submissionId` with host token in `Authorization: Bearer ...`
- `GET /moments-api/host/events/:eventId/time-capsule` with host token in `Authorization: Bearer ...`
- `PATCH /moments-api/host/events/:eventId/time-capsule` with host token in `Authorization: Bearer ...`
- `POST /moments-api/host/events/:eventId/time-capsule/items` with host token in `Authorization: Bearer ...`
- `PATCH /moments-api/host/time-capsule/items/:itemId` with host token in `Authorization: Bearer ...`
- `DELETE /moments-api/host/time-capsule/items/:itemId` with host token in `Authorization: Bearer ...`
- `GET /moments-api/capsules/:eventId` with share token in `Authorization: Bearer ...`
- `GET /moments-api/media/:submissionId?mediaToken=...`
- `GET /moments-api/admin/overview`
- `POST /moments-api/admin/events`
- `PATCH /moments-api/admin/events/:eventId`
- `POST /moments-api/admin/tags`
- `PATCH /moments-api/admin/tags/:tagId`
- `GET /moments-api/admin/retention-candidates`
- `POST /moments-api/admin/retention-cleanup`

Photo uploads are capped at 8 MB. Video uploads are capped at 50 MB and 30 seconds. The browser checks video duration before upload; the Worker also rejects submissions whose provided duration is over the limit. Guests must first resolve an active tag and submit the short-lived upload token returned by `GET /moments-api/tags/:tagCode`.

Host media URLs use short-lived media tokens so the long-lived host gallery token is not embedded in every video/photo request.

Wallflower Time Capsule events use the same guest QR/tag capture and host approval flow. Only approved, non-deleted submissions can be added to a capsule. Published capsules are private-link only and use separate share tokens; media still streams through short-lived media URLs.

## Retention

Standard Moments events default to 90 days of retention from the event date. Time Capsule-enabled events default to 365 days. `GET /moments-api/admin/retention-candidates` lists media records whose event retention has expired. `POST /moments-api/admin/retention-cleanup` deletes expired R2 objects and marks those submissions deleted. The Worker also has a daily scheduled cleanup trigger.
