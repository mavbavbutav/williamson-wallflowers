const FIELD_LABELS = [
  ['name', 'Name'],
  ['email', 'Email'],
  ['event-date', 'Event Date'],
  ['event-type', 'Event Type'],
  ['venue', 'Venue / Location'],
  ['preferred-wall', 'Preferred Wall'],
  ['ask-time-capsule', 'Wallflower Time Capsule'],
  ['details', 'Event Details']
];

const REQUIRED_FIELDS = ['name', 'email'];
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const AUDIO_MAX_BYTES = 20 * 1024 * 1024;
const THUMBNAIL_MAX_BYTES = 768 * 1024;
const AI_REFERENCE_MAX_BYTES = 5 * 1024 * 1024;
const AI_REFERENCE_MIME_TYPE = 'image/jpeg';
const AI_REFERENCE_EXTENSION = 'jpg';
const AI_REFERENCE_WIDTH = 1536;
const AI_REFERENCE_QUALITY = 92;
const VIDEO_MAX_SECONDS = 30;
const AUDIO_MAX_SECONDS = 60;
const UPLOAD_TOKEN_TTL_SECONDS = 12 * 60 * 60;
const MEDIA_TOKEN_TTL_SECONDS = 6 * 60 * 60;
const THUMBNAIL_TOKEN_TTL_SECONDS = 6 * 60 * 60;
const EMAIL_PREVIEW_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const STREAM_TOKEN_TTL_SECONDS = 6 * 60 * 60;
const UPLOAD_RATE_LIMIT = 12;
const UPLOAD_RATE_WINDOW_SECONDS = 60 * 60;
const TAG_RATE_LIMIT = 120;
const TAG_RATE_WINDOW_SECONDS = 60 * 60;
const BRIDGE_TRIGGER_LIMIT = 5;
const BRIDGE_MAX_ATTEMPTS = 3;
const DEFAULT_SCAN_PRESET_ID = 2;
const DEFAULT_SUBMISSION_PRESET_ID = 3;
const DEFAULT_MANUAL_PRESET_ID = 4;
const DEFAULT_LIGHT_BRIGHTNESS = 180;
const DEFAULT_EVENT_MAX_SUBMISSIONS = 500;
const DEFAULT_EVENT_MAX_BYTES = 10 * 1024 * 1024 * 1024;
const RETENTION_CLEANUP_LIMIT = 100;
const STREAM_BACKFILL_DEFAULT_LIMIT = 10;
const STREAM_BACKFILL_MAX_LIMIT = 25;
const GROUP_HERO_MAX_INPUTS = 16;
const GROUP_HERO_SOURCE_LOOKBACK_LIMIT = GROUP_HERO_MAX_INPUTS * 4;
const GROUP_HERO_TOKEN_TTL_SECONDS = 6 * 60 * 60;
const GROUP_HERO_FORCE_RATE_LIMIT = 6;
const GROUP_HERO_FORCE_RATE_WINDOW_SECONDS = 60 * 60;
const GROUP_HERO_DEFAULT_MODEL = 'gpt-image-1.5';
const GROUP_HERO_PROMPT = buildGroupHeroPrompt('the event');
const STANDARD_RETENTION_DAYS = 90;
const TIME_CAPSULE_RETENTION_DAYS = 365;
const UPLOAD_NOTIFICATION_RECIPIENT = 'contact@jjentertainmentsolutions.com';
const INTERACTION_REACTIONS = ['like', 'dislike', 'laugh', 'cry', 'surprised'];
const INTERACTION_RATE_LIMIT = 12;
const INTERACTION_RATE_WINDOW_SECONDS = 60;
const LIKE_INTERACTION_RATE_LIMIT = 1;
const LIKE_INTERACTION_RATE_WINDOW_SECONDS = 60 * 60 * 24 * 365;
const MAX_COMMENT_LENGTH = 320;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const GROUP_HERO_INPUT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const THUMBNAIL_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VIDEO_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
  'video/m4v',
  'video/3gpp',
  'video/3gpp2',
  'video/hevc',
  'video/h264'
]);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm', '3gp', '3gpp', '3g2']);
const AUDIO_TYPES = new Set([
  'audio/aac',
  'audio/flac',
  'audio/m4a',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/opus',
  'audio/wav',
  'audio/webm',
  'audio/x-m4a',
  'audio/x-wav'
]);
const AUDIO_EXTENSIONS = new Set(['aac', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'weba', 'webm']);
const PUBLIC_SITE_URL = 'https://williamsonwallflowers.com';
const STREAM_API_BASE_URL = 'https://api.cloudflare.com/client/v4';
const STREAM_DELIVERY_BASE_URL = 'https://videodelivery.net';
const streamPlaybackTokenCache = new Map();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = getCorsHeaders(origin, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!isAllowedOrigin(origin, env)) {
      return json({ ok: false, message: 'This request cannot be submitted from that origin.' }, 403, corsHeaders);
    }

    if (url.pathname.startsWith('/moments-api')) {
      return handleMomentsApi(request, env, url, corsHeaders, ctx);
    }

    return handleInquiry(request, env, corsHeaders);
  },

  async scheduled(event, env, ctx) {
    if (!env.MOMENTS_DB || !env.MOMENTS_BUCKET) return;
    ctx.waitUntil(cleanExpiredMedia(env, RETENTION_CLEANUP_LIMIT));
  }
};

async function handleInquiry(request, env, corsHeaders) {
  if (request.method !== 'POST') {
    return json({ ok: false, message: 'Method not allowed.' }, 405, corsHeaders);
  }

  try {
    const submission = await readSubmission(request);

    if (submission._honey) {
      return json({ ok: true, message: 'Inquiry received.' }, 200, corsHeaders);
    }

    const validationError = validateSubmission(submission);

    if (validationError) {
      return json({ ok: false, message: validationError }, 400, corsHeaders);
    }

    const internalResult = await sendInternalNotification(submission, env);

    if (!internalResult.ok) {
      const detail = await internalResult.text();
      console.error('Resend inquiry delivery failed', internalResult.status, detail);
      return json({ ok: false, message: getEmailErrorMessage(internalResult.status, detail) }, 502, corsHeaders);
    }

    const confirmationResult = await sendApplicantConfirmation(submission, env);

    if (!confirmationResult.ok) {
      const detail = await confirmationResult.text();
      console.error('Applicant inquiry confirmation failed', confirmationResult.status, detail);
    }

    return json({ ok: true, message: 'Inquiry sent.' }, 200, corsHeaders);
  } catch (error) {
    console.error('Wallflowers inquiry form error', error);
    return json({ ok: false, message: 'Inquiry could not be sent right now.' }, 500, corsHeaders);
  }
}

async function handleMomentsApi(request, env, url, corsHeaders, ctx) {
  if (!env.MOMENTS_DB || !env.MOMENTS_BUCKET) {
    return json({ ok: false, message: 'Wallflower Moments storage is not configured yet.' }, 503, corsHeaders);
  }

  const parts = url.pathname.split('/').filter(Boolean).slice(1);

  try {
    if (request.method === 'GET' && parts[0] === 'tags' && parts[1]) {
      return getTagEvent(request, parts[1], env, corsHeaders);
    }

    if (request.method === 'POST' && parts[0] === 'events' && parts[1] && parts[2] === 'submissions' && parts.length === 3) {
      return createSubmission(request, env, corsHeaders, parts[1], ctx);
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && parts[0] === 'events' && parts[1] && parts[2] === 'group-hero' && parts[3] === 'image') {
      return streamGroupHeroImage(request, env, url, corsHeaders, parts[1]);
    }

    if (request.method === 'GET' && parts[0] === 'events' && parts[1] && parts[2] === 'group-hero' && parts.length === 3) {
      return getGuestGroupHero(request, env, url, corsHeaders, parts[1]);
    }

    if (parts[0] === 'bridge') {
      return handleBridgeApi(request, env, url, corsHeaders, parts.slice(1));
    }

    if (request.method === 'GET' && parts[0] === 'events' && parts[1] && parts[2] === 'host-posts') {
      return listGuestHostPosts(request, env, url, corsHeaders, parts[1]);
    }

    if (request.method === 'POST' && parts[0] === 'events' && parts[1] && parts[2] === 'submissions' && parts[4] === 'reactions' && parts.length === 5) {
      return addSubmissionReaction(request, env, url, corsHeaders, parts[1], parts[3]);
    }

    if (request.method === 'POST' && parts[0] === 'events' && parts[1] && parts[2] === 'submissions' && parts[4] === 'comments' && parts.length === 5) {
      return addSubmissionComment(request, env, url, corsHeaders, parts[1], parts[3]);
    }

    if (request.method === 'GET' && parts[0] === 'host' && parts[1] === 'events' && parts[2] && parts[3] === 'submissions') {
      return listHostSubmissions(request, env, url, corsHeaders, parts[2]);
    }

    if (request.method === 'POST' && parts[0] === 'host' && parts[1] === 'events' && parts[2] && parts[3] === 'posts') {
      return createHostPost(request, env, url, corsHeaders, parts[2], ctx);
    }

    if (request.method === 'PATCH' && parts[0] === 'host' && parts[1] === 'events' && parts[2] && parts[3] === 'countdown') {
      return updateHostEventCountdown(request, env, url, corsHeaders, parts[2]);
    }

    if (request.method === 'PATCH' && parts[0] === 'host' && parts[1] === 'events' && parts[2] && parts[3] === 'party-view-settings') {
      return updateHostPartyViewSettings(request, env, url, corsHeaders, parts[2]);
    }

    if (request.method === 'POST' && parts[0] === 'host' && parts[1] === 'events' && parts[2] && parts[3] === 'group-hero' && parts[4] === 'regenerate') {
      return regenerateHostGroupHero(request, env, url, corsHeaders, parts[2], ctx);
    }

    if (parts[0] === 'host' && parts[1] === 'events' && parts[2] && parts[3] === 'time-capsule') {
      if (request.method === 'GET') {
        return getHostTimeCapsule(request, env, url, corsHeaders, parts[2]);
      }

      if (request.method === 'PATCH') {
        return updateHostTimeCapsule(request, env, url, corsHeaders, parts[2]);
      }

      if (request.method === 'POST' && parts[4] === 'items') {
        return createTimeCapsuleItem(request, env, url, corsHeaders, parts[2], ctx);
      }
    }

    if (parts[0] === 'host' && parts[1] === 'time-capsule' && parts[2] === 'items' && parts[3]) {
      if (request.method === 'PATCH') {
        return updateTimeCapsuleItem(request, env, url, corsHeaders, parts[3]);
      }

      if (request.method === 'DELETE') {
        return deleteTimeCapsuleItem(request, env, url, corsHeaders, parts[3]);
      }
    }

    if (request.method === 'GET' && parts[0] === 'capsules' && parts[1]) {
      return getPublishedTimeCapsule(request, env, url, corsHeaders, parts[1]);
    }

    if (parts[0] === 'host' && parts[1] === 'submissions' && parts[2]) {
      if (request.method === 'PATCH' && parts[3] === 'party-view') {
        return updateSubmissionPartyView(request, env, url, corsHeaders, parts[2], ctx);
      }

      if (request.method === 'PATCH') {
        return updateHostSubmission(request, env, url, corsHeaders, parts[2], ctx);
      }

      if (request.method === 'DELETE') {
        return deleteHostSubmission(request, env, url, corsHeaders, parts[2], ctx);
      }
    }

    if (parts[0] === 'media' && parts[1] && parts[2] === 'thumbnail') {
      if (request.method === 'POST') {
        return saveGeneratedThumbnail(request, env, url, corsHeaders, parts[1], ctx);
      }

      if (request.method === 'GET' || request.method === 'HEAD') {
        return streamThumbnail(request, env, url, corsHeaders, parts[1]);
      }
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && parts[0] === 'media' && parts[1]) {
      return streamMedia(request, env, url, corsHeaders, parts[1]);
    }

    if (parts[0] === 'admin') {
      return handleAdminApi(request, env, url, corsHeaders, parts.slice(1));
    }

    return json({ ok: false, message: 'Moments route not found.' }, 404, corsHeaders);
  } catch (error) {
    console.error('Wallflower Moments API error', error);
    return json({ ok: false, message: 'Wallflower Moments is temporarily unavailable.' }, 500, corsHeaders);
  }
}

async function getTagEvent(request, tagCode, env, corsHeaders) {
  const tagRate = await consumeRateLimit(
    env,
    await getClientRateLimitKey(request, `tag:${normalizeTagCode(tagCode)}`),
    TAG_RATE_LIMIT,
    TAG_RATE_WINDOW_SECONDS
  );

  if (!tagRate.ok) {
    return json({ ok: false, message: 'Too many tag lookups. Please wait a bit and try again.' }, 429, corsHeaders);
  }

  const row = await env.MOMENTS_DB.prepare(`
    SELECT
      t.id AS tagId,
      t.public_code AS publicCode,
      t.label AS tagLabel,
      t.status AS tagStatus,
      e.id AS eventId,
      e.name AS eventName,
      e.event_date AS eventDate,
      e.host_name AS hostName,
      e.event_start_at AS eventStartAt,
      e.countdown_enabled AS countdownEnabled,
      e.countdown_message AS countdownMessage,
      e.guest_uploads_before_countdown_enabled AS guestUploadsBeforeCountdownEnabled,
      e.party_view_swipe_enabled AS partyViewSwipeEnabled,
      e.status AS eventStatus,
      e.retention_expires_at AS retentionExpiresAt
    FROM tags t
    LEFT JOIN events e ON e.id = t.active_event_id
    WHERE t.public_code = ?
  `).bind(normalizeTagCode(tagCode)).first();

  if (!row || row.tagStatus !== 'active' || !row.eventId) {
    return json({ ok: false, message: 'This tag is not assigned to an active event yet.' }, 404, corsHeaders);
  }

  if (!isActiveEvent(row)) {
    return json({ ok: false, message: 'This event is no longer accepting moments.' }, 410, corsHeaders);
  }

  const uploadToken = await createSignedToken(env, 'upload', row.eventId, UPLOAD_TOKEN_TTL_SECONDS);
  const groupHero = await getEventGroupHeroClient(env, row.eventId, request);
  await recordScanEvent(env, row.eventId, row.tagId);
  await safeQueueEventLightTrigger(env, row.eventId, 'tag_scan');

  return json({
    ok: true,
    tag: {
      id: row.tagId,
      publicCode: row.publicCode,
      label: row.tagLabel
    },
    event: {
      id: row.eventId,
      name: row.eventName,
      eventDate: row.eventDate,
      eventStartAt: row.eventStartAt,
      countdownEnabled: row.countdownEnabled,
      countdownMessage: row.countdownMessage,
      guestUploadsBeforeCountdownEnabled: Number(row.guestUploadsBeforeCountdownEnabled || 0) === 1,
      partyViewSwipeEnabled: Number(row.partyViewSwipeEnabled || 0) === 1,
      hostName: row.hostName,
      groupHero
    },
    uploadToken
  }, 200, corsHeaders);
}

async function createSubmission(request, env, corsHeaders, eventId, ctx) {
  const event = await getEventById(env, eventId);

  if (!event || !isActiveEvent(event)) {
    return json({ ok: false, message: 'This event is no longer accepting moments.' }, 410, corsHeaders);
  }

  if (isGuestUploadBlockedBeforeCountdown(event)) {
    return json({ ok: false, message: 'The party has not started yet. Guest uploads unlock when the countdown ends.' }, 403, corsHeaders);
  }

  const uploadRate = await consumeRateLimit(
    env,
    await getClientRateLimitKey(request, `upload:${eventId}`),
    UPLOAD_RATE_LIMIT,
    UPLOAD_RATE_WINDOW_SECONDS
  );

  if (!uploadRate.ok) {
    return json({ ok: false, message: 'Too many uploads from this device. Please wait a bit before trying again.' }, 429, corsHeaders);
  }

  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > VIDEO_MAX_BYTES + 1024 * 1024) {
    return json({ ok: false, message: 'Upload is too large.' }, 413, corsHeaders);
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return json({ ok: false, message: 'Upload must use multipart form data.' }, 415, corsHeaders);
  }

  const formData = await request.formData();
  const media = formData.get('media');
  const consent = String(formData.get('consent') || '').toLowerCase() === 'true';
  const uploadToken = String(formData.get('uploadToken') || '');
  const aiArtworkConsent = normalizeBoolean(formData.get('aiArtworkConsent'));

  if (!consent) {
    return json({ ok: false, message: 'Consent is required before uploading.' }, 400, corsHeaders);
  }

  if (!media || typeof media === 'string' || typeof media.stream !== 'function') {
    return json({ ok: false, message: 'Please upload a photo, video, or voice memo.' }, 400, corsHeaders);
  }

  if (!await verifySignedToken(env, uploadToken, 'upload', eventId)) {
    return json({ ok: false, message: 'This upload session expired. Please scan the tag again.' }, 403, corsHeaders);
  }

  const mediaType = normalizeMediaType(formData.get('mediaType'), media.type, media.name);
  const durationSeconds = Number(formData.get('durationSeconds') || 0);
  const validationError = validateMedia(media, mediaType, durationSeconds);

  if (validationError) {
    return json({ ok: false, message: validationError }, 400, corsHeaders);
  }

  const thumbnail = validateVideoThumbnail(formData.get('thumbnail'), mediaType);
  if (thumbnail.error) {
    return json({ ok: false, message: thumbnail.error }, 400, corsHeaders);
  }

  const aiReference = validateAiReference(formData.get('aiReference'), mediaType, aiArtworkConsent);
  if (aiReference.error) {
    return json({ ok: false, message: aiReference.error }, 400, corsHeaders);
  }

  const quotaError = await validateEventQuota(env, eventId, media.size);
  if (quotaError) {
    return json({ ok: false, message: quotaError }, 429, corsHeaders);
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const originalFilename = sanitizeFilename(media.name || `${mediaType}-${id}`);
  const storedMimeType = getStoredMimeType(media.type, originalFilename, mediaType);
  const objectKey = `moments/${eventId}/${id}.${extensionFor(storedMimeType, originalFilename)}`;
  const guestName = cleanText(formData.get('guestName'), 90);
  const guestNote = cleanText(formData.get('guestNote'), 220);
  const aiArtworkConsentAt = aiArtworkConsent ? now : null;

  await env.MOMENTS_BUCKET.put(objectKey, media.stream(), {
    httpMetadata: {
      contentType: storedMimeType,
      contentDisposition: `inline; filename="${originalFilename}"`
    },
    customMetadata: {
      eventId,
      submissionId: id,
      mediaType
    }
  });

  const thumbnailRecord = thumbnail.file
    ? await storeVideoThumbnail(env, eventId, id, thumbnail.file, now)
    : emptyThumbnailRecord();

  if (aiReference.file) {
    await storeAiReferenceImage(env, eventId, id, aiReference.file, now);
  }

  await env.MOMENTS_DB.prepare(`
    INSERT INTO submissions (
      id, event_id, media_type, object_key, original_filename, mime_type, size,
      thumbnail_object_key, thumbnail_mime_type, thumbnail_size, thumbnail_created_at,
      duration_seconds, guest_name, guest_note, consent_at, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).bind(
    id,
    eventId,
    mediaType,
    objectKey,
    originalFilename,
    storedMimeType,
    media.size,
    thumbnailRecord.objectKey,
    thumbnailRecord.mimeType,
    thumbnailRecord.size,
    thumbnailRecord.createdAt,
    Number.isFinite(durationSeconds) ? durationSeconds : 0,
    guestName,
    guestNote,
    now,
    now,
    now
  ).run();

  if (aiArtworkConsentAt) {
    await env.MOMENTS_DB.prepare(`
      UPDATE submissions
      SET ai_artwork_consent_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(aiArtworkConsentAt, now, id).run();
  }

  await queueUploadNotification(env, ctx, {
    event,
    submissionId: id,
    sourceLabel: 'Guest upload',
    mediaType,
    previewUrl: await buildUploadNotificationPreviewUrl(request, env, id, mediaType, thumbnailRecord.objectKey),
    originalFilename,
    size: media.size,
    title: '',
    caption: '',
    guestName,
    guestNote,
    status: 'pending',
    createdAt: now
  });

  await safeQueueEventLightTrigger(env, eventId, 'submission_received');

  return json({
    ok: true,
    submission: {
      id,
      status: 'pending',
      aiArtworkConsent: Boolean(aiArtworkConsentAt)
    }
  }, 201, corsHeaders);
}

async function listGuestHostPosts(request, env, url, corsHeaders, eventId) {
  const event = await getEventById(env, eventId);

  if (!event || !isActiveEvent(event)) {
    return json({ ok: false, message: 'This event is no longer accepting moments.' }, 410, corsHeaders);
  }

  const token = getAccessToken(request, url);
  if (!await verifySignedToken(env, token, 'upload', eventId)) {
    return json({ ok: false, message: 'This guest link is not valid.' }, 403, corsHeaders);
  }

  const groupHero = await getEventGroupHeroClient(env, event.id, request);

  if (!event.timeCapsuleEnabled) {
    return json({
      ok: true,
      event: {
        id: event.id,
        name: event.name,
        eventDate: event.eventDate,
        hostName: event.hostName,
        partyViewSwipeEnabled: Number(event.partyViewSwipeEnabled || 0) === 1,
        groupHero
      },
      items: []
    }, 200, corsHeaders);
  }

  const [hostItems, guestItems] = await Promise.all([
    getTimeCapsuleItems(env, event.id, request, { visibleOnly: true, hostOnly: true }),
    getGuestVisibleSubmissions(env, event.id, request)
  ]);
  const items = [...hostItems, ...guestItems]
    .sort((a, b) => new Date(b.capturedAt || b.createdAt || 0) - new Date(a.capturedAt || a.createdAt || 0));

  return json({
    ok: true,
    event: {
      id: event.id,
      name: event.name,
      eventDate: event.eventDate,
      hostName: event.hostName,
      partyViewSwipeEnabled: Number(event.partyViewSwipeEnabled || 0) === 1,
      groupHero
    },
    items
  }, 200, corsHeaders);
}

async function addSubmissionReaction(request, env, url, corsHeaders, eventId, submissionId) {
  const token = getAccessToken(request, url);
  const event = await getEventById(env, eventId);
  if (!event || !isActiveEvent(event)) {
    return json({ ok: false, message: 'This event is no longer accepting moments.' }, 410, corsHeaders);
  }

  if (!await verifySignedToken(env, token, 'upload', eventId)) {
    return json({ ok: false, message: 'This guest link is not valid.' }, 403, corsHeaders);
  }

  const payload = await request.json().catch(() => null);
  const reaction = String(payload?.reaction || '').trim().toLowerCase();
  if (!INTERACTION_REACTIONS.includes(reaction)) {
    return json({ ok: false, message: `Unsupported reaction: ${reaction || 'empty'}` }, 400, corsHeaders);
  }

  if (reaction === 'like') {
    const likeScope = await getReactionActorLimitScope(request, event.id, submissionId, String(payload?.sessionId || ""));
    const likeRateResult = await consumeRateLimit(env, likeScope, LIKE_INTERACTION_RATE_LIMIT, LIKE_INTERACTION_RATE_WINDOW_SECONDS);
    if (!likeRateResult.ok) {
      return json({ ok: false, message: 'You already liked this moment. Try a different reaction if you want to show something else.' }, 409, corsHeaders);
    }
  }

  const scope = await getClientRateLimitKey(request, `interaction:${event.id}:${submissionId}`);
  const rateResult = await consumeRateLimit(env, scope, INTERACTION_RATE_LIMIT, INTERACTION_RATE_WINDOW_SECONDS);
  if (!rateResult.ok) {
    return json({ ok: false, message: 'You are reacting too quickly. Please wait a moment.' }, 429, corsHeaders);
  }

  const submission = await getGuestPartyVisibleSubmission(env, event.id, submissionId);
  if (!submission) {
    return json({ ok: false, message: 'Could not find that moment to react to.' }, 404, corsHeaders);
  }

  const now = new Date().toISOString();
  await env.MOMENTS_DB.prepare(`
    INSERT INTO submission_reactions (
      id, event_id, submission_id, reaction, created_at
    )
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    event.id,
    submission.id,
    reaction,
    now
  ).run();

  const interactions = await getSubmissionInteractions(env, submission.id);
  return json({
    ok: true,
    submissionId: submission.id,
    interactions
  }, 201, corsHeaders);
}

async function addSubmissionComment(request, env, url, corsHeaders, eventId, submissionId) {
  const token = getAccessToken(request, url);
  const event = await getEventById(env, eventId);
  if (!event || !isActiveEvent(event)) {
    return json({ ok: false, message: 'This event is no longer accepting moments.' }, 410, corsHeaders);
  }

  if (!await verifySignedToken(env, token, 'upload', eventId)) {
    return json({ ok: false, message: 'This guest link is not valid.' }, 403, corsHeaders);
  }

  const scope = await getClientRateLimitKey(request, `interaction:${event.id}:${submissionId}:comment`);
  const rateResult = await consumeRateLimit(env, scope, INTERACTION_RATE_LIMIT, INTERACTION_RATE_WINDOW_SECONDS);
  if (!rateResult.ok) {
    return json({ ok: false, message: 'You are commenting too quickly. Please wait a moment.' }, 429, corsHeaders);
  }

  const payload = await request.json().catch(() => null);
  const comment = cleanText(payload?.comment || '', MAX_COMMENT_LENGTH);
  if (!comment) {
    return json({ ok: false, message: 'Please enter a comment.' }, 400, corsHeaders);
  }

  const submission = await getGuestPartyVisibleSubmission(env, event.id, submissionId);
  if (!submission) {
    return json({ ok: false, message: 'Could not find that moment to comment on.' }, 404, corsHeaders);
  }

  const now = new Date().toISOString();
  await env.MOMENTS_DB.prepare(`
    INSERT INTO submission_comments (
      id, event_id, submission_id, comment, created_at
    )
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    event.id,
    submission.id,
    comment,
    now
  ).run();

  const interactions = await getSubmissionInteractions(env, submission.id);
  return json({
    ok: true,
    submissionId: submission.id,
    interactions
  }, 201, corsHeaders);
}

async function createHostPost(request, env, url, corsHeaders, eventId, ctx) {
  const token = getAccessToken(request, url);
  const event = await getHostEvent(env, eventId, token);

  if (!event) {
    return json({ ok: false, message: 'This host gallery link is not valid.' }, 403, corsHeaders);
  }

  if (!event.timeCapsuleEnabled) {
    return json({ ok: false, message: 'Wallflower Time Capsule is not enabled for this event.' }, 404, corsHeaders);
  }

  if (!isActiveEvent(event)) {
    return json({ ok: false, message: 'This event is no longer accepting moments.' }, 410, corsHeaders);
  }

  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > VIDEO_MAX_BYTES + 1024 * 1024) {
    return json({ ok: false, message: 'Upload is too large.' }, 413, corsHeaders);
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return json({ ok: false, message: 'Upload must use multipart form data.' }, 415, corsHeaders);
  }

  const formData = await request.formData();
  const media = formData.get('media');

  if (!media || typeof media === 'string' || typeof media.stream !== 'function') {
    return json({ ok: false, message: 'Please upload a photo, video, or voice memo.' }, 400, corsHeaders);
  }

  const mediaType = normalizeMediaType(formData.get('mediaType'), media.type, media.name);
  const durationSeconds = Number(formData.get('durationSeconds') || 0);
  const validationError = validateMedia(media, mediaType, durationSeconds);

  if (validationError) {
    return json({ ok: false, message: validationError }, 400, corsHeaders);
  }

  const thumbnail = validateVideoThumbnail(formData.get('thumbnail'), mediaType);
  if (thumbnail.error) {
    return json({ ok: false, message: thumbnail.error }, 400, corsHeaders);
  }

  const quotaError = await validateEventQuota(env, eventId, media.size);
  if (quotaError) {
    return json({ ok: false, message: quotaError }, 429, corsHeaders);
  }

  const now = new Date().toISOString();
  const submissionId = crypto.randomUUID();
  const originalFilename = sanitizeFilename(media.name || `host-${mediaType}-${submissionId}`);
  const storedMimeType = getStoredMimeType(media.type, originalFilename, mediaType);
  const objectKey = `moments/${eventId}/${submissionId}.${extensionFor(storedMimeType, originalFilename)}`;
  const title = cleanText(formData.get('title'), 120) || 'Host Post';
  const caption = cleanText(formData.get('caption'), 600);
  const sortOrder = await getNextTimeCapsuleSortOrder(env, eventId);

  await env.MOMENTS_BUCKET.put(objectKey, media.stream(), {
    httpMetadata: {
      contentType: storedMimeType,
      contentDisposition: `inline; filename="${originalFilename}"`
    },
    customMetadata: {
      eventId,
      submissionId,
      mediaType,
      source: 'host'
    }
  });

  const thumbnailRecord = thumbnail.file
    ? await storeVideoThumbnail(env, eventId, submissionId, thumbnail.file, now)
    : emptyThumbnailRecord();

  await env.MOMENTS_DB.prepare(`
    INSERT INTO submissions (
      id, event_id, media_type, source, object_key, original_filename, mime_type, size,
      thumbnail_object_key, thumbnail_mime_type, thumbnail_size, thumbnail_created_at,
      duration_seconds, guest_name, guest_note, consent_at, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    submissionId,
    eventId,
    mediaType,
    'host',
    objectKey,
    originalFilename,
    storedMimeType,
    media.size,
    thumbnailRecord.objectKey,
    thumbnailRecord.mimeType,
    thumbnailRecord.size,
    thumbnailRecord.createdAt,
    Number.isFinite(durationSeconds) ? durationSeconds : 0,
    'Host',
    cleanText(caption, 220),
    now,
    'approved',
    now,
    now
  ).run();

  await queueStreamOptimization(env, request, await getSubmissionWithEvent(env, submissionId), ctx);

  const itemId = crypto.randomUUID();
  await env.MOMENTS_DB.prepare(`
    INSERT INTO time_capsule_items (
      id, event_id, submission_id, title, caption, chapter, captured_at, location,
      sort_order, is_visible, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    itemId,
    eventId,
    submissionId,
    title,
    caption,
    'Host Posts',
    now,
    '',
    sortOrder,
    1,
    now,
    now
  ).run();

  const item = await getTimeCapsuleItemById(env, itemId, request);

  await queueUploadNotification(env, ctx, {
    event,
    submissionId,
    sourceLabel: 'Host post',
    mediaType,
    originalFilename,
    size: media.size,
    title,
    caption,
    guestName: 'Host',
    guestNote: '',
    status: 'approved',
    createdAt: now
  });

  return json({
    ok: true,
    submission: {
      id: submissionId,
      eventId,
      mediaType,
      source: 'host',
      status: 'approved',
      guestName: 'Host',
      guestNote: caption,
      createdAt: now,
      updatedAt: now
    },
    item: await toTimeCapsuleItemClient(item, request, env)
  }, 201, corsHeaders);
}

async function listHostSubmissions(request, env, url, corsHeaders, eventId) {
  const token = getAccessToken(request, url);
  const event = await getHostEvent(env, eventId, token);

  if (!event) {
    return json({ ok: false, message: 'This host gallery link is not valid.' }, 403, corsHeaders);
  }

  const result = await env.MOMENTS_DB.prepare(`
    SELECT *
    FROM submissions
    WHERE event_id = ? AND deleted_at IS NULL AND status != 'deleted'
    ORDER BY created_at DESC
  `).bind(eventId).all();
  const guestLink = await getHostGuestLink(env, event.id);
  const eventClient = toEventClient(event, env);
  eventClient.guestLink = guestLink;
  eventClient.groupHero = await getEventGroupHeroClient(env, event.id, request);

  return json({
    ok: true,
    event: eventClient,
    submissions: await Promise.all((result.results || []).map((row) => toSubmissionClient(row, request, env)))
  }, 200, corsHeaders);
}

async function getHostGuestLink(env, eventId) {
  const tag = await env.MOMENTS_DB.prepare(`
    SELECT id, public_code AS publicCode, label
    FROM tags
    WHERE active_event_id = ? AND status = 'active'
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1
  `).bind(eventId).first();

  if (!tag?.publicCode) return null;

  return {
    id: tag.id,
    label: tag.label || 'Guest link',
    publicCode: tag.publicCode,
    url: `${getSiteUrl(env)}/moments/?t=${encodeURIComponent(tag.publicCode)}`
  };
}

async function getHostTimeCapsule(request, env, url, corsHeaders, eventId) {
  const event = await getAuthorizedCapsuleEvent(request, env, url, eventId);
  if (event.response) return event.response;

  const items = await getTimeCapsuleItems(env, event.record.id, request, { includeHidden: true });

  return json({
    ok: true,
    event: toEventClient(event.record, env),
    timeCapsule: toTimeCapsuleClient(event.record, env),
    items
  }, 200, corsHeaders);
}

async function updateHostTimeCapsule(request, env, url, corsHeaders, eventId) {
  const event = await getAuthorizedCapsuleEvent(request, env, url, eventId);
  if (event.response) return event.response;

  const body = await request.json();
  const requestedStatus = body.status === undefined ? event.record.timeCapsuleStatus : String(body.status || '').toLowerCase();
  const status = requestedStatus === 'published' ? 'published' : 'draft';
  const title = cleanText(body.title, 140) || event.record.timeCapsuleTitle || `${event.record.name} Time Capsule`;
  const now = new Date().toISOString();
  let publishedAt = status === 'published' ? (event.record.timeCapsulePublishedAt || now) : null;

  await env.MOMENTS_DB.prepare(`
    UPDATE events
    SET time_capsule_status = ?, time_capsule_title = ?, time_capsule_published_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(status, title, publishedAt, now, event.record.id).run();

  const updated = await getEventById(env, event.record.id);
  return json({
    ok: true,
    timeCapsule: toTimeCapsuleClient(updated, env)
  }, 200, corsHeaders);
}

async function createTimeCapsuleItem(request, env, url, corsHeaders, eventId, ctx) {
  const event = await getAuthorizedCapsuleEvent(request, env, url, eventId);
  if (event.response) return event.response;

  const body = await request.json();
  const submissionId = cleanText(body.submissionId, 80);
  const submission = await getSubmissionWithEvent(env, submissionId);

  if (!submission || submission.eventId !== event.record.id || submission.deletedAt || submission.status === 'deleted') {
    return json({ ok: false, message: 'Submission not found for this event.' }, 404, corsHeaders);
  }

  if (submission.status !== 'approved') {
    return json({ ok: false, message: 'Only approved submissions can be added to the Time Capsule.' }, 400, corsHeaders);
  }

  const existing = await getTimeCapsuleItemBySubmission(env, event.record.id, submissionId);
  if (existing) {
    return json({ ok: false, message: 'That moment is already in the Time Capsule.' }, 409, corsHeaders);
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const sortOrder = Number.isFinite(Number(body.sortOrder))
    ? Number(body.sortOrder)
    : await getNextTimeCapsuleSortOrder(env, event.record.id);

  await env.MOMENTS_DB.prepare(`
    INSERT INTO time_capsule_items (
      id, event_id, submission_id, title, caption, chapter, captured_at, location,
      sort_order, is_visible, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    event.record.id,
    submission.id,
    cleanText(body.title, 120) || submission.guestName || 'Guest moment',
    cleanText(body.caption, 600) || submission.guestNote || '',
    cleanText(body.chapter, 80) || 'Guest moments',
    cleanText(body.capturedAt, 40) || submission.createdAt,
    cleanText(body.location, 100),
    sortOrder,
    body.isVisible === false ? 0 : 1,
    now,
    now
  ).run();

  await queueStreamOptimization(env, request, submission, ctx);

  const item = await getTimeCapsuleItemById(env, id, request);
  return json({ ok: true, item: await toTimeCapsuleItemClient(item, request, env) }, 201, corsHeaders);
}

async function updateTimeCapsuleItem(request, env, url, corsHeaders, itemId) {
  const token = getAccessToken(request, url);
  const item = await getTimeCapsuleItemWithEvent(env, itemId);

  if (!item || token !== item.hostToken) {
    return json({ ok: false, message: 'This host gallery link is not valid.' }, 403, corsHeaders);
  }

  if (!item.timeCapsuleEnabled) {
    return json({ ok: false, message: 'Wallflower Time Capsule is not enabled for this event.' }, 404, corsHeaders);
  }

  const body = await request.json();
  const next = {
    title: body.title === undefined ? item.title : cleanText(body.title, 120),
    caption: body.caption === undefined ? item.caption : cleanText(body.caption, 600),
    chapter: body.chapter === undefined ? item.chapter : cleanText(body.chapter, 80),
    capturedAt: body.capturedAt === undefined ? item.capturedAt : cleanText(body.capturedAt, 40),
    location: body.location === undefined ? item.location : cleanText(body.location, 100),
    sortOrder: body.sortOrder === undefined || !Number.isFinite(Number(body.sortOrder)) ? item.sortOrder : Number(body.sortOrder),
    isVisible: body.isVisible === undefined ? item.isVisible : (body.isVisible ? 1 : 0)
  };

  await env.MOMENTS_DB.prepare(`
    UPDATE time_capsule_items
    SET title = ?, caption = ?, chapter = ?, captured_at = ?, location = ?,
      sort_order = ?, is_visible = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    next.title || 'Guest moment',
    next.caption || '',
    next.chapter || 'Guest moments',
    next.capturedAt || item.createdAt,
    next.location || '',
    next.sortOrder,
    next.isVisible,
    new Date().toISOString(),
    itemId
  ).run();

  const updated = await getTimeCapsuleItemById(env, itemId, request);
  return json({ ok: true, item: await toTimeCapsuleItemClient(updated, request, env) }, 200, corsHeaders);
}

async function deleteTimeCapsuleItem(request, env, url, corsHeaders, itemId) {
  const token = getAccessToken(request, url);
  const item = await getTimeCapsuleItemWithEvent(env, itemId);

  if (!item || token !== item.hostToken) {
    return json({ ok: false, message: 'This host gallery link is not valid.' }, 403, corsHeaders);
  }

  await env.MOMENTS_DB.prepare('DELETE FROM time_capsule_items WHERE id = ?').bind(itemId).run();
  return json({ ok: true }, 200, corsHeaders);
}

async function getPublishedTimeCapsule(request, env, url, corsHeaders, eventId) {
  const token = getAccessToken(request, url);
  const event = await getEventById(env, eventId);

  if (
    !event ||
    !event.timeCapsuleEnabled ||
    event.timeCapsuleStatus !== 'published' ||
    !event.timeCapsuleShareToken ||
    token !== event.timeCapsuleShareToken
  ) {
    return json({ ok: false, message: 'This Time Capsule link is not valid.' }, 403, corsHeaders);
  }

  const items = await getTimeCapsuleItems(env, event.id, request, { visibleOnly: true });

  return json({
    ok: true,
    event: {
      id: event.id,
      name: event.name,
      title: event.timeCapsuleTitle || `${event.name} Time Capsule`,
      eventDate: event.eventDate,
      publishedAt: event.timeCapsulePublishedAt
    },
    items
  }, 200, corsHeaders);
}

async function updateHostSubmission(request, env, url, corsHeaders, submissionId, ctx) {
  const token = getAccessToken(request, url);
  const submission = await getSubmissionWithEvent(env, submissionId);

  if (!submission || !isAuthorizedForSubmission(submission, token, env)) {
    return json({ ok: false, message: 'This host gallery link is not valid.' }, 403, corsHeaders);
  }

  const body = await request.json();
  const status = String(body.status || '').toLowerCase();

  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return json({ ok: false, message: 'Submission status must be pending, approved, or rejected.' }, 400, corsHeaders);
  }

  const now = new Date().toISOString();
  await env.MOMENTS_DB.prepare(`
    UPDATE submissions
    SET status = ?, guest_visible_at = CASE WHEN ? = 'approved' THEN guest_visible_at ELSE NULL END, updated_at = ?
    WHERE id = ? AND deleted_at IS NULL
  `).bind(status, status, now, submissionId).run();

  if (status === 'approved') {
    const approvedSubmission = { ...submission, status, updatedAt: now };
    await queueStreamOptimization(env, request, approvedSubmission, ctx);
    await queueEventGroupHeroGenerationForSubmission(env, request, approvedSubmission, ctx);
  } else {
    await queueEventGroupHeroRefreshIfIncluded(env, request, submission, ctx);
  }

  return json({ ok: true, status }, 200, corsHeaders);
}

async function updateSubmissionPartyView(request, env, url, corsHeaders, submissionId, ctx) {
  const token = getAccessToken(request, url);
  const submission = await getSubmissionWithEvent(env, submissionId);

  if (!submission || !isAuthorizedForSubmission(submission, token, env)) {
    return json({ ok: false, message: 'This host gallery link is not valid.' }, 403, corsHeaders);
  }

  if (submission.deletedAt || submission.status === 'deleted') {
    return json({ ok: false, message: 'Submission not found.' }, 404, corsHeaders);
  }

  const body = await request.json();
  const visible = body.visible !== false;

  if (visible && submission.status !== 'approved') {
    return json({ ok: false, message: 'Only approved submissions can be shown in Party View.' }, 400, corsHeaders);
  }

  const now = new Date().toISOString();
  const guestVisibleAt = visible ? now : null;
  await env.MOMENTS_DB.prepare(`
    UPDATE submissions
    SET guest_visible_at = ?, updated_at = ?
    WHERE id = ? AND deleted_at IS NULL
  `).bind(guestVisibleAt, now, submissionId).run();

  if (visible) {
    await queueStreamOptimization(env, request, submission, ctx);
  }

  return json({
    ok: true,
    guestVisible: visible,
    guestVisibleAt: guestVisibleAt || ''
  }, 200, corsHeaders);
}

async function updateHostEventCountdown(request, env, url, corsHeaders, eventId) {
  const token = getAccessToken(request, url);
  const event = await getHostEvent(env, eventId, token);

  if (!event) {
    return json({ ok: false, message: 'This host gallery link is not valid.' }, 403, corsHeaders);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: 'Invalid event settings payload.' }, 400, corsHeaders);
  }

  const countdownEnabled = Boolean(body.countdownEnabled);
  const countdownMessage = cleanText(body.countdownMessage || '', 140);
  const guestUploadsBeforeCountdownEnabled = normalizeBoolean(body.guestUploadsBeforeCountdownEnabled) ? 1 : 0;
  const eventStartAt = normalizeCountdownStartAt(body.eventStartAt);
  const enabled = countdownEnabled && Boolean(eventStartAt);
  const finalMessage = countdownMessage || 'Party starts in';
  const now = new Date().toISOString();

  if (countdownEnabled && !eventStartAt) {
    return json({ ok: false, message: 'Set an event start time to enable the countdown.' }, 400, corsHeaders);
  }

  await env.MOMENTS_DB.prepare(`
    UPDATE events
    SET event_start_at = ?, countdown_enabled = ?, countdown_message = ?,
      guest_uploads_before_countdown_enabled = ?, updated_at = ?
    WHERE id = ? AND host_token = ?
  `).bind(
    eventStartAt || null,
    enabled ? 1 : 0,
    finalMessage || null,
    guestUploadsBeforeCountdownEnabled,
    now,
    event.id,
    token
  ).run();

  return json({
    ok: true,
    event: toEventClient({
      ...event,
      eventStartAt,
      countdownEnabled: enabled ? 1 : 0,
      countdownMessage: finalMessage,
      guestUploadsBeforeCountdownEnabled,
      updatedAt: now
    }, env)
  }, 200, corsHeaders);
}

async function updateHostPartyViewSettings(request, env, url, corsHeaders, eventId) {
  const token = getAccessToken(request, url);
  const event = await getHostEvent(env, eventId, token);

  if (!event) {
    return json({ ok: false, message: 'This host gallery link is not valid.' }, 403, corsHeaders);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: 'Invalid Party View settings payload.' }, 400, corsHeaders);
  }

  const partyViewSwipeEnabled = normalizeBoolean(body.partyViewSwipeEnabled) ? 1 : 0;
  const now = new Date().toISOString();

  await env.MOMENTS_DB.prepare(`
    UPDATE events
    SET party_view_swipe_enabled = ?, updated_at = ?
    WHERE id = ? AND host_token = ?
  `).bind(
    partyViewSwipeEnabled,
    now,
    event.id,
    token
  ).run();

  return json({
    ok: true,
    event: toEventClient({
      ...event,
      partyViewSwipeEnabled,
      updatedAt: now
    }, env)
  }, 200, corsHeaders);
}

async function getGuestGroupHero(request, env, url, corsHeaders, eventId) {
  const event = await getEventById(env, eventId);

  if (!event || !isActiveEvent(event)) {
    return json({ ok: false, message: 'This event is no longer accepting moments.' }, 410, corsHeaders);
  }

  const token = getAccessToken(request, url);
  if (!await verifySignedToken(env, token, 'upload', eventId)) {
    return json({ ok: false, message: 'This guest link is not valid.' }, 403, corsHeaders);
  }

  return json({
    ok: true,
    groupHero: await getEventGroupHeroClient(env, eventId, request)
  }, 200, corsHeaders);
}

async function streamGroupHeroImage(request, env, url, corsHeaders, eventId) {
  const heroToken = url.searchParams.get('heroToken') || '';
  if (!await verifySignedToken(env, heroToken, 'group-hero', eventId)) {
    return json({ ok: false, message: 'This group artwork link is not valid.' }, 403, corsHeaders);
  }

  const hero = await getEventGroupHero(env, eventId);
  const objectKey = hero?.object_key || hero?.objectKey || '';
  if (!hero || hero.status !== 'ready' || !objectKey) {
    return json({ ok: false, message: 'Group artwork is not ready yet.' }, 404, corsHeaders);
  }

  const isHeadRequest = request.method === 'HEAD';
  const object = isHeadRequest
    ? await env.MOMENTS_BUCKET.head(objectKey)
    : await env.MOMENTS_BUCKET.get(objectKey);

  if (!object) {
    return json({ ok: false, message: 'Group artwork is missing from storage.' }, 404, corsHeaders);
  }

  const headers = new Headers(corsHeaders);
  if (typeof object.writeHttpMetadata === 'function') {
    object.writeHttpMetadata(headers);
  }
  headers.set('Content-Type', hero.mime_type || hero.mimeType || 'image/png');
  headers.set('Cache-Control', 'private, max-age=300');
  headers.set('ETag', object.httpEtag || object.etag || `${eventId}-group-hero`);
  headers.set('Content-Disposition', `inline; filename="${eventId}-wallflower-group-hero.png"`);
  headers.set('Content-Length', String(hero.size || object.size || 0));

  return new Response(isHeadRequest ? null : object.body, { status: 200, headers });
}

async function regenerateHostGroupHero(request, env, url, corsHeaders, eventId, ctx) {
  const token = getAccessToken(request, url);
  const event = await getHostEvent(env, eventId, token);

  if (!event) {
    return json({ ok: false, message: 'This host gallery link is not valid.' }, 403, corsHeaders);
  }

  const rate = await consumeRateLimit(
    env,
    `group-hero:force:${eventId}`,
    GROUP_HERO_FORCE_RATE_LIMIT,
    GROUP_HERO_FORCE_RATE_WINDOW_SECONDS
  );

  if (!rate.ok) {
    return json({ ok: false, message: 'Too many AI group artwork refreshes. Please wait before trying again.' }, 429, corsHeaders);
  }

  await queueEventGroupHeroGeneration(env, request, eventId, { force: true });

  return json({
    ok: true,
    groupHero: await getEventGroupHeroClient(env, eventId, request)
  }, 202, corsHeaders);
}

async function queueEventGroupHeroGenerationForSubmission(env, request, submission, ctx) {
  if (!isGroupHeroEligibleSubmission(submission)) return;
  await queueEventGroupHeroGeneration(env, request, submission.eventId || submission.event_id, { force: false }, ctx);
}

async function queueEventGroupHeroRefreshIfIncluded(env, request, submission, ctx) {
  const eventId = submission?.eventId || submission?.event_id;
  const submissionId = submission?.id;
  if (!eventId || !submissionId) return;

  const hero = await getEventGroupHero(env, eventId);
  if (!getGroupHeroSourceIds(hero).includes(submissionId)) return;

  await queueEventGroupHeroGeneration(env, request, eventId, { force: true }, ctx);
}

async function queueEventGroupHeroGeneration(env, request, eventId, options = {}, ctx) {
  if (!eventId) return;

  const force = Boolean(options.force);
  const event = await getEventById(env, eventId);
  const prompt = buildGroupHeroPrompt(event?.name || event?.eventName || 'the event');
  const sources = await getGroupHeroSourceSubmissions(env, eventId);
  const sourceIds = sources.map((source) => source.id);
  const existing = await getEventGroupHero(env, eventId);
  const existingObjectKey = existing?.object_key || existing?.objectKey || '';

  if (sources.length === 0) {
    await storeEventGroupHeroState(env, {
      eventId,
      status: 'empty',
      objectKey: null,
      mimeType: null,
      size: 0,
      participantCount: 0,
      sourceIds: [],
      model: getOpenAiImageModel(env),
      prompt,
      errorMessage: '',
      generatedAt: null
    });
    if (existingObjectKey) {
      try {
        await env.MOMENTS_BUCKET.delete(existingObjectKey);
      } catch (error) {
        console.error('R2 delete failed for cleared group hero', eventId, error);
      }
    }
    return;
  }

  if (!force && sourceIdsMatch(getGroupHeroSourceIds(existing), sourceIds)) {
    return;
  }

  await storeEventGroupHeroState(env, {
    eventId,
    status: 'queued',
    objectKey: existingObjectKey || null,
    mimeType: existing?.mime_type || existing?.mimeType || null,
    size: existing?.size || 0,
    participantCount: sources.length,
    sourceIds,
    model: getOpenAiImageModel(env),
    prompt,
    errorMessage: '',
    generatedAt: existing?.generated_at || existing?.generatedAt || null
  });

  const work = generateEventGroupHero(env, request, eventId, sources, sourceIds, prompt, existingObjectKey).catch(async (error) => {
    console.error('AI group hero generation failed', eventId, String(error.message || error));
    await storeEventGroupHeroState(env, {
      eventId,
      status: 'failed',
      objectKey: existingObjectKey || null,
      mimeType: existing?.mime_type || existing?.mimeType || null,
      size: existing?.size || 0,
      participantCount: sources.length,
      sourceIds,
      model: getOpenAiImageModel(env),
      prompt,
      errorMessage: cleanText(error.message || 'AI group hero generation failed.', 500),
      generatedAt: existing?.generated_at || existing?.generatedAt || null
    });
  });

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(work);
    return;
  }

  await work;
}

async function generateEventGroupHero(env, request, eventId, sources, sourceIds, prompt = GROUP_HERO_PROMPT, previousObjectKey = '') {
  const now = new Date().toISOString();
  await storeEventGroupHeroState(env, {
    eventId,
    status: 'generating',
    objectKey: previousObjectKey || null,
    mimeType: 'image/png',
    size: 0,
    participantCount: sources.length,
    sourceIds,
    model: getOpenAiImageModel(env),
    prompt,
    errorMessage: '',
    generatedAt: null
  });

  const apiKey = getOpenAiApiKey(env);
  if (!apiKey) {
    throw new Error('OpenAI API key is not configured.');
  }

  let activeSources = sources;
  let activeSourceIds = sourceIds;
  let imageBytes = null;

  while (activeSources.length > 0) {
    try {
      imageBytes = await requestOpenAiGroupHeroImage(env, apiKey, activeSources, prompt);
      break;
    } catch (error) {
      const invalidImageIndex = getOpenAiInvalidImageIndex(error.message || '');
      const rejectedSource = invalidImageIndex === null ? null : activeSources[invalidImageIndex];

      if (!rejectedSource) {
        throw error;
      }

      const normalizedSource = await normalizeGroupHeroSourceImage(env, request, eventId, rejectedSource)
        .catch((normalizeError) => {
          console.warn(
            'AI group hero source normalization failed',
            eventId,
            rejectedSource.id,
            String(normalizeError.message || normalizeError)
          );
          return null;
        });

      if (normalizedSource) {
        console.warn('AI group hero source normalized after OpenAI rejection', eventId, rejectedSource.id);
        activeSources = activeSources.map((source, index) => (
          index === invalidImageIndex ? normalizedSource : source
        ));
        activeSourceIds = activeSources.map((source) => source.id);

        await storeEventGroupHeroState(env, {
          eventId,
          status: 'generating',
          objectKey: previousObjectKey || null,
          mimeType: 'image/png',
          size: 0,
          participantCount: activeSources.length,
          sourceIds: activeSourceIds,
          model: getOpenAiImageModel(env),
          prompt,
          errorMessage: '',
          generatedAt: null
        });
        continue;
      }

      if (activeSources.length <= 1) {
        throw error;
      }

      console.warn('AI group hero source rejected by OpenAI', eventId, rejectedSource.id);
      activeSources = activeSources.filter((_, index) => index !== invalidImageIndex);
      activeSourceIds = activeSources.map((source) => source.id);

      await storeEventGroupHeroState(env, {
        eventId,
        status: 'generating',
        objectKey: previousObjectKey || null,
        mimeType: 'image/png',
        size: 0,
        participantCount: activeSources.length,
        sourceIds: activeSourceIds,
        model: getOpenAiImageModel(env),
        prompt,
        errorMessage: '',
        generatedAt: null
      });
    }
  }

  if (!imageBytes?.byteLength) {
    throw new Error('OpenAI did not return generated image data.');
  }

  const objectKey = `moments/${eventId}/generated/group-hero-${Date.now()}.png`;
  await env.MOMENTS_BUCKET.put(objectKey, imageBytes, {
    httpMetadata: {
      contentType: 'image/png',
      contentDisposition: `inline; filename="${eventId}-wallflower-group-hero.png"`
    },
    customMetadata: {
      eventId,
      mediaType: 'group-hero',
      sourceSubmissionIds: JSON.stringify(activeSourceIds)
    }
  });

  await storeEventGroupHeroState(env, {
    eventId,
    status: 'ready',
    objectKey,
    mimeType: 'image/png',
    size: imageBytes.byteLength,
    participantCount: activeSources.length,
    sourceIds: activeSourceIds,
    model: getOpenAiImageModel(env),
    prompt,
    errorMessage: '',
    generatedAt: now
  });

  if (previousObjectKey && previousObjectKey !== objectKey) {
    try {
      await env.MOMENTS_BUCKET.delete(previousObjectKey);
    } catch (error) {
      console.error('R2 delete failed for replaced group hero', eventId, error);
    }
  }
}

async function requestOpenAiGroupHeroImage(env, apiKey, sources, prompt) {
  const formData = new FormData();
  formData.append('model', getOpenAiImageModel(env));
  formData.append('prompt', prompt);
  formData.append('size', '1536x1024');
  formData.append('quality', 'medium');
  formData.append('output_format', 'png');
  formData.append('n', '1');

  for (const source of sources) {
    const sourceObject = await getGroupHeroSourceObject(env, source);
    const bytes = await r2ObjectToArrayBuffer(sourceObject.object);
    const mimeType = sourceObject.mimeType;
    const filename = sourceObject.filename;
    formData.append('image[]', new Blob([bytes], { type: mimeType }), filename);
  }

  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: formData
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(getOpenAiErrorMessage(payload, response.status));
  }

  return getOpenAiImageBytes(payload);
}

async function getGroupHeroSourceObject(env, source) {
  const aiReferenceObjectKey = source.aiReferenceObjectKey || source.ai_reference_object_key || '';
  if (aiReferenceObjectKey) {
    const aiReferenceObject = await env.MOMENTS_BUCKET.get(aiReferenceObjectKey);
    if (aiReferenceObject) {
      return {
        object: aiReferenceObject,
        objectKey: aiReferenceObjectKey,
        mimeType: source.aiReferenceMimeType || source.ai_reference_mime_type || AI_REFERENCE_MIME_TYPE,
        filename: `${source.id}-ai-reference.${AI_REFERENCE_EXTENSION}`
      };
    }
  }

  const objectKey = source.objectKey || source.object_key;
  const object = await env.MOMENTS_BUCKET.get(objectKey);
  if (!object) {
    throw new Error(`Source image is missing from storage: ${source.id}`);
  }

  const mimeType = source.mimeType || source.mime_type || 'image/jpeg';
  return {
    object,
    objectKey,
    mimeType,
    filename: `${source.id}.${extensionFor(mimeType, source.originalFilename || source.original_filename || '')}`
  };
}

async function normalizeGroupHeroSourceImage(env, request, eventId, source) {
  const mediaType = source.mediaType || source.media_type || '';
  if (mediaType !== 'photo' || source.aiReferenceWasGenerated) return null;

  const sourceUrl = await buildMediaAccessUrl(request, env, source.id);
  const response = await fetch(sourceUrl, {
    cf: {
      image: {
        fit: 'scale-down',
        width: AI_REFERENCE_WIDTH,
        format: 'jpeg',
        quality: AI_REFERENCE_QUALITY
      }
    }
  });

  if (!response.ok) return null;

  const contentType = getBaseMimeType(response.headers.get('Content-Type') || '');
  if (contentType && contentType !== AI_REFERENCE_MIME_TYPE) return null;

  const bytes = await response.arrayBuffer();
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > AI_REFERENCE_MAX_BYTES) return null;

  const objectKey = getAiReferenceObjectKey(eventId, source.id);
  await env.MOMENTS_BUCKET.put(objectKey, new Uint8Array(bytes), {
    httpMetadata: {
      contentType: AI_REFERENCE_MIME_TYPE,
      contentDisposition: `inline; filename="${source.id}-ai-reference.${AI_REFERENCE_EXTENSION}"`
    },
    customMetadata: {
      eventId,
      submissionId: source.id,
      mediaType: 'ai-reference',
      source: 'normalization'
    }
  });

  return {
    ...source,
    aiReferenceObjectKey: objectKey,
    aiReferenceMimeType: AI_REFERENCE_MIME_TYPE,
    aiReferenceWasGenerated: true
  };
}

async function getEventGroupHeroClient(env, eventId, request) {
  return toEventGroupHeroClient(await getEventGroupHero(env, eventId), request, env, eventId);
}

async function toEventGroupHeroClient(row, request, env, eventId) {
  const normalized = row || {};
  const status = normalized.status || 'empty';
  const objectKey = normalized.object_key || normalized.objectKey || '';

  return {
    status,
    imageUrl: status === 'ready' && objectKey ? await buildGroupHeroAccessUrl(request, env, eventId) : '',
    participantCount: Number(normalized.participant_count || normalized.participantCount || 0),
    updatedAt: normalized.updated_at || normalized.updatedAt || ''
  };
}

async function buildGroupHeroAccessUrl(request, env, eventId) {
  const heroToken = await createSignedToken(env, 'group-hero', eventId, GROUP_HERO_TOKEN_TTL_SECONDS);
  return `${getApiOrigin(request, env)}/moments-api/events/${encodeURIComponent(eventId)}/group-hero/image?heroToken=${encodeURIComponent(heroToken)}`;
}

async function getEventGroupHero(env, eventId) {
  return env.MOMENTS_DB.prepare(`
    SELECT
      event_id AS eventId,
      status,
      object_key AS objectKey,
      mime_type AS mimeType,
      size,
      participant_count AS participantCount,
      source_submission_ids AS sourceSubmissionIds,
      model,
      prompt,
      error_message AS errorMessage,
      generated_at AS generatedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM event_group_heroes
    WHERE event_id = ?
  `).bind(eventId).first();
}

async function getGroupHeroSourceSubmissions(env, eventId) {
  const result = await env.MOMENTS_DB.prepare(`
    SELECT
      id,
      event_id AS eventId,
      media_type AS mediaType,
      guest_name AS guestName,
      object_key AS photoObjectKey,
      thumbnail_object_key AS objectKey,
      original_filename AS originalFilename,
      mime_type AS photoMimeType,
      thumbnail_mime_type AS mimeType,
      created_at AS createdAt
    FROM submissions
    WHERE event_id = ?
      AND source = 'guest'
      AND status = 'approved'
      AND deleted_at IS NULL
      AND ai_artwork_consent_at IS NOT NULL
      AND (
        (media_type = 'photo' AND mime_type IN ('image/jpeg', 'image/png', 'image/webp'))
        OR (media_type = 'video' AND thumbnail_object_key IS NOT NULL AND thumbnail_mime_type IN ('image/jpeg', 'image/png', 'image/webp'))
      )
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(eventId, GROUP_HERO_SOURCE_LOOKBACK_LIMIT).all();

  const compatibleSources = (result.results || []).map((row) => {
    if ((row.mediaType || row.media_type) === 'video') {
      const mimeType = row.mimeType || row.mime_type || 'image/jpeg';
      return {
        ...row,
        objectKey: row.objectKey || row.object_key,
        originalFilename: `${row.id}-video-thumbnail.${extensionFor(mimeType, '')}`,
        mimeType
      };
    }
    return {
      ...row,
      objectKey: row.photoObjectKey || row.objectKey || row.object_key,
      mimeType: row.photoMimeType || row.mimeType || row.mime_type,
      aiReferenceObjectKey: getAiReferenceObjectKey(row.eventId || row.event_id || eventId, row.id),
      aiReferenceMimeType: AI_REFERENCE_MIME_TYPE
    };
  });

  return selectDistinctGroupHeroSources(compatibleSources);
}

function selectDistinctGroupHeroSources(sources) {
  const selected = [];
  const seenGuestKeys = new Set();

  for (const source of sources) {
    if (selected.length >= GROUP_HERO_MAX_INPUTS) break;

    const guestKey = getGroupHeroGuestKey(source.guestName || source.guest_name || '');
    if (guestKey) {
      if (seenGuestKeys.has(guestKey)) continue;
      seenGuestKeys.add(guestKey);
    }

    selected.push(source);
  }

  return selected;
}

function getGroupHeroGuestKey(value) {
  return cleanText(value, 120)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function storeEventGroupHeroState(env, state) {
  const now = new Date().toISOString();
  await env.MOMENTS_DB.prepare(`
    INSERT INTO event_group_heroes (
      event_id, status, object_key, mime_type, size, participant_count,
      source_submission_ids, model, prompt, error_message, generated_at,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET
      status = excluded.status,
      object_key = excluded.object_key,
      mime_type = excluded.mime_type,
      size = excluded.size,
      participant_count = excluded.participant_count,
      source_submission_ids = excluded.source_submission_ids,
      model = excluded.model,
      prompt = excluded.prompt,
      error_message = excluded.error_message,
      generated_at = excluded.generated_at,
      updated_at = excluded.updated_at
  `).bind(
    state.eventId,
    state.status,
    state.objectKey || null,
    state.mimeType || null,
    Number(state.size || 0),
    Number(state.participantCount || 0),
    JSON.stringify(state.sourceIds || []),
    state.model || getOpenAiImageModel(env),
    state.prompt || GROUP_HERO_PROMPT,
    state.errorMessage || '',
    state.generatedAt || null,
    now,
    now
  ).run();
}

function isGroupHeroEligibleSubmission(submission) {
  if (!submission) return false;
  const mediaType = submission.mediaType || submission.media_type;
  const source = submission.source || 'guest';
  const mimeType = submission.mimeType || submission.mime_type || '';
  const thumbnailObjectKey = submission.thumbnailObjectKey || submission.thumbnail_object_key || '';
  const thumbnailMimeType = submission.thumbnailMimeType || submission.thumbnail_mime_type || '';
  const consentAt = submission.aiArtworkConsentAt || submission.ai_artwork_consent_at || '';
  if (source !== 'guest' || !consentAt) return false;
  if (mediaType === 'photo') return GROUP_HERO_INPUT_TYPES.has(getBaseMimeType(mimeType));
  if (mediaType === 'video') return Boolean(thumbnailObjectKey) && GROUP_HERO_INPUT_TYPES.has(getBaseMimeType(thumbnailMimeType));
  return false;
}

function buildGroupHeroPrompt(eventName) {
  const eventLabel = cleanText(eventName, 90).replace(/["<>]/g, '').trim() || 'the event';
  return [
    `Create a warm editorial cartoon group portrait for the event "${eventLabel}".`,
    'Use the curated uploaded photos and video thumbnails as approved real-person likeness references for the group scene.',
    'If the same visible guest appears across multiple references, draw that guest once rather than repeating them; use the clearest single appearance as the likeness anchor.',
    'Prioritize recognizable cartoon likeness over generic character design: preserve facial structure, hairstyle, age cues, skin tone, eyewear, expression, posture, and clothing color or style from each source image.',
    'Use family-friendly, age-appropriate, respectful caricature styling without exaggerating sensitive traits.',
    'Place the people together in one cohesive celebratory portrait with premium floral wall decor and warm event lighting.',
    `If any readable sign, backdrop lettering, or wall text appears, it must say "${eventLabel}" exactly; otherwise avoid readable text entirely.`,
    'Do not include company branding, guest names, captions, logos, watermarks, UI elements, or realistic fake photography.',
    'The final image should feel polished, celebratory, premium, and suitable as a guest-facing event hero.'
  ].join(' ');
}

function getGroupHeroSourceIds(row) {
  const value = row?.source_submission_ids || row?.sourceSubmissionIds || '[]';
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function sourceIdsMatch(previous, next) {
  if (!Array.isArray(previous) || !Array.isArray(next)) return false;
  if (previous.length !== next.length) return false;
  return previous.every((id, index) => id === next[index]);
}

async function r2ObjectToArrayBuffer(object) {
  if (typeof object.arrayBuffer === 'function') {
    return object.arrayBuffer();
  }

  if (object.body) {
    return new Response(object.body).arrayBuffer();
  }

  throw new Error('Stored source image is not readable.');
}

async function getOpenAiImageBytes(payload) {
  const first = payload?.data?.[0] || {};
  if (first.b64_json) {
    return base64ToUint8Array(first.b64_json);
  }

  if (first.url) {
    const response = await fetch(first.url);
    if (!response.ok) throw new Error('Could not download generated image.');
    return new Uint8Array(await response.arrayBuffer());
  }

  return null;
}

function base64ToUint8Array(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function getOpenAiApiKey(env) {
  return env.OPENAI_API_KEY || env.openai || env.OPENAI || '';
}

function getOpenAiImageModel(env) {
  return env.OPENAI_IMAGE_MODEL || GROUP_HERO_DEFAULT_MODEL;
}

function getOpenAiErrorMessage(payload, status) {
  const message = payload?.error?.message || payload?.message || `OpenAI image generation failed with status ${status}.`;
  return cleanText(message, 500);
}

function getOpenAiInvalidImageIndex(message) {
  const match = String(message || '').match(/\binvalid image file or mode for image\s+(\d+)/i);
  if (!match) return null;

  const index = Number(match[1]) - 1;
  return Number.isInteger(index) && index >= 0 ? index : null;
}

async function deleteHostSubmission(request, env, url, corsHeaders, submissionId, ctx) {
  const token = getAccessToken(request, url);
  const submission = await getSubmissionWithEvent(env, submissionId);

  if (!submission || !isAuthorizedForSubmission(submission, token, env)) {
    return json({ ok: false, message: 'This host gallery link is not valid.' }, 403, corsHeaders);
  }

  const now = new Date().toISOString();
  await env.MOMENTS_DB.prepare(`
    UPDATE submissions
    SET status = 'deleted', deleted_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(now, now, submissionId).run();

  await env.MOMENTS_DB.prepare('DELETE FROM time_capsule_items WHERE submission_id = ?').bind(submissionId).run();

  try {
    await env.MOMENTS_BUCKET.delete(submission.objectKey);
    if (submission.thumbnailObjectKey) await env.MOMENTS_BUCKET.delete(submission.thumbnailObjectKey);
    await deleteAiReferenceImage(env, submission.eventId, submission.id);
    if (submission.streamUid) await deleteStreamVideo(env, submission.streamUid);
  } catch (error) {
    console.error('R2 delete failed for host-deleted submission', submissionId, error);
  }

  await queueEventGroupHeroRefreshIfIncluded(env, request, submission, ctx);

  return json({ ok: true, status: 'deleted' }, 200, corsHeaders);
}

async function streamMedia(request, env, url, corsHeaders, submissionId) {
  const token = getAccessToken(request, url);
  const mediaToken = url.searchParams.get('mediaToken') || '';
  const submission = await getSubmissionWithEvent(env, submissionId);

  if (!submission || submission.deletedAt || submission.status === 'deleted') {
    return json({ ok: false, message: 'Media not found.' }, 404, corsHeaders);
  }

  const isAuthorized = mediaToken
    ? await verifySignedToken(env, mediaToken, 'media', submissionId)
    : isAuthorizedForSubmission(submission, token, env);

  if (!isAuthorized) {
    return json({ ok: false, message: 'This media link is not valid.' }, 403, corsHeaders);
  }

  const totalSize = Number(submission.size || 0);
  const parsedRange = parseRange(request.headers.get('Range'), totalSize);
  const isHeadRequest = request.method === 'HEAD';
  const object = isHeadRequest
    ? await env.MOMENTS_BUCKET.head(submission.objectKey)
    : await env.MOMENTS_BUCKET.get(
      submission.objectKey,
      parsedRange ? { range: { offset: parsedRange.start, length: parsedRange.length } } : undefined
    );

  if (!object) {
    return json({ ok: false, message: 'Media file is missing from storage.' }, 404, corsHeaders);
  }

  const headers = new Headers(corsHeaders);
  if (typeof object.writeHttpMetadata === 'function') {
    object.writeHttpMetadata(headers);
  }
  headers.set('Content-Type', submission.mimeType);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'private, max-age=60');
  headers.set('ETag', object.httpEtag || object.etag);
  headers.set('Content-Disposition', `${getDisposition(url)}; filename="${downloadFilename(submission)}"`);
  if (isHeadRequest && totalSize) {
    headers.set('Content-Range', `bytes 0-${Math.max(totalSize - 1, 0)}/${totalSize}`);
  }

  if (parsedRange) {
    headers.set('Content-Range', `bytes ${parsedRange.start}-${parsedRange.end}/${totalSize}`);
    headers.set('Content-Length', String(parsedRange.length));
    return new Response(isHeadRequest ? null : object.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(totalSize || object.size || 0));
  return new Response(isHeadRequest ? null : object.body, { status: 200, headers });
}

async function streamThumbnail(request, env, url, corsHeaders, submissionId) {
  const token = getAccessToken(request, url);
  const thumbnailToken = url.searchParams.get('thumbnailToken') || '';
  const submission = await getSubmissionWithEvent(env, submissionId);

  if (!submission || submission.deletedAt || submission.status === 'deleted' || !submission.thumbnailObjectKey) {
    return json({ ok: false, message: 'Thumbnail not found.' }, 404, corsHeaders);
  }

  const isAuthorized = thumbnailToken
    ? await verifySignedToken(env, thumbnailToken, 'thumbnail', submissionId)
    : isAuthorizedForSubmission(submission, token, env);

  if (!isAuthorized) {
    return json({ ok: false, message: 'This thumbnail link is not valid.' }, 403, corsHeaders);
  }

  const isHeadRequest = request.method === 'HEAD';
  const object = isHeadRequest
    ? await env.MOMENTS_BUCKET.head(submission.thumbnailObjectKey)
    : await env.MOMENTS_BUCKET.get(submission.thumbnailObjectKey);

  if (!object) {
    return json({ ok: false, message: 'Thumbnail file is missing from storage.' }, 404, corsHeaders);
  }

  const headers = new Headers(corsHeaders);
  if (typeof object.writeHttpMetadata === 'function') {
    object.writeHttpMetadata(headers);
  }
  headers.set('Content-Type', submission.thumbnailMimeType || 'image/jpeg');
  headers.set('Cache-Control', 'private, max-age=3600');
  headers.set('ETag', object.httpEtag || object.etag);
  headers.set('Content-Disposition', `inline; filename="thumbnail-${submission.id}.jpg"`);
  headers.set('Content-Length', String(submission.thumbnailSize || object.size || 0));

  return new Response(isHeadRequest ? null : object.body, { status: 200, headers });
}

async function saveGeneratedThumbnail(request, env, url, corsHeaders, submissionId, ctx) {
  const thumbnailToken = url.searchParams.get('thumbnailToken') || '';
  const submission = await getSubmissionWithEvent(env, submissionId);

  if (!submission || submission.deletedAt || submission.status === 'deleted') {
    return json({ ok: false, message: 'Submission not found.' }, 404, corsHeaders);
  }

  if (submission.mediaType !== 'video') {
    return json({ ok: false, message: 'Only videos can store thumbnails.' }, 400, corsHeaders);
  }

  if (!await verifySignedToken(env, thumbnailToken, 'thumbnail', submissionId)) {
    return json({ ok: false, message: 'This thumbnail upload link is not valid.' }, 403, corsHeaders);
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return json({ ok: false, message: 'Thumbnail upload must use multipart form data.' }, 415, corsHeaders);
  }

  const formData = await request.formData();
  const thumbnail = validateVideoThumbnail(formData.get('thumbnail'), 'video');
  if (!thumbnail.file || thumbnail.error) {
    return json({ ok: false, message: thumbnail.error || 'Please upload a video thumbnail image.' }, 400, corsHeaders);
  }

  const now = new Date().toISOString();
  const record = await storeVideoThumbnail(env, submission.eventId, submission.id, thumbnail.file, now, submission.thumbnailObjectKey);

  await env.MOMENTS_DB.prepare(`
    UPDATE submissions
    SET thumbnail_object_key = ?, thumbnail_mime_type = ?, thumbnail_size = ?, thumbnail_created_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(record.objectKey, record.mimeType, record.size, record.createdAt, now, submission.id).run();

  await queueEventGroupHeroGenerationForSubmission(env, request, {
    ...submission,
    thumbnailObjectKey: record.objectKey,
    thumbnailMimeType: record.mimeType,
    thumbnailSize: record.size,
    thumbnailCreatedAt: record.createdAt,
    updatedAt: now
  }, ctx);

  return json({
    ok: true,
    thumbnailUrl: await buildThumbnailAccessUrl(request, env, submission.id)
  }, 200, corsHeaders);
}

async function queueStreamOptimization(env, request, submission, ctx) {
  const work = optimizeSubmissionForStream(env, request, submission).catch((error) => {
    console.error('Cloudflare Stream optimization failed', submission?.id || 'unknown-submission', String(error.message || error));
  });

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(work);
    return;
  }

  await work;
}

async function optimizeSubmissionForStream(env, request, submission) {
  if (!submission || submission.mediaType !== 'video' || submission.deletedAt || submission.status === 'deleted') return;
  if (!isStreamConfigured(env)) return;

  const existingUid = submission.streamUid || submission.stream_uid || '';
  const existingStatus = submission.streamStatus || submission.stream_status || '';
  if (existingUid && existingStatus !== 'error') {
    const refreshed = await refreshStreamStatusIfNeeded(env, submission.id, existingUid, existingStatus);
    return { ok: true, status: refreshed?.status || existingStatus, uid: existingUid };
  }

  const now = new Date().toISOString();
  await storeStreamState(env, submission.id, {
    uid: '',
    status: 'queued',
    error: '',
    readyAt: '',
    createdAt: now,
    updatedAt: now
  });

  try {
    const mediaUrl = await buildMediaAccessUrl(request, env, submission.id);
    const video = await createStreamCopy(env, submission, mediaUrl);
    const record = streamRecordFromVideo(video, 'queued');
    await storeStreamState(env, submission.id, record);
    return { ok: record.status !== 'error', ...record };
  } catch (error) {
    const message = cleanText(error.message || error, 500);
    await storeStreamState(env, submission.id, {
      uid: '',
      status: 'error',
      error: message,
      readyAt: '',
      updatedAt: new Date().toISOString()
    });
    return { ok: false, status: 'error', error: message };
  }
}

async function createStreamCopy(env, submission, inputUrl) {
  const accountId = getCloudflareAccountId(env);
  const body = {
    allowedOrigins: getStreamAllowedOrigins(env),
    creator: cleanText(submission.eventId || submission.event_id || 'wallflower-moments', 64),
    input: inputUrl,
    url: inputUrl,
    name: submission.originalFilename || submission.original_filename || `wallflower-${submission.id}.mp4`,
    requireSignedURLs: true,
    thumbnailTimestampPct: 0.08,
    meta: {
      eventId: submission.eventId || submission.event_id || '',
      submissionId: submission.id,
      source: 'wallflower-moments'
    }
  };

  return cloudflareApiFetch(env, `/accounts/${encodeURIComponent(accountId)}/stream/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Upload-Creator': body.creator },
    body: JSON.stringify(body)
  });
}

async function refreshStreamStatusIfNeeded(env, submissionId, streamUid, currentStatus) {
  if (!streamUid || currentStatus === 'ready' || !isStreamConfigured(env)) return null;

  const accountId = getCloudflareAccountId(env);
  const video = await cloudflareApiFetch(env, `/accounts/${encodeURIComponent(accountId)}/stream/${encodeURIComponent(streamUid)}`);
  const record = streamRecordFromVideo(video, currentStatus || 'processing');
  await storeStreamState(env, submissionId, record);
  return record;
}

async function storeStreamState(env, submissionId, state) {
  const now = new Date().toISOString();
  const uid = state.uid || '';
  const status = state.status || 'queued';
  const error = cleanText(state.error, 500);
  const readyAt = state.readyAt || null;
  const createdAt = state.createdAt || now;
  const updatedAt = state.updatedAt || now;

  await env.MOMENTS_DB.prepare(`
    UPDATE submissions
    SET stream_uid = ?, stream_status = ?, stream_error = ?, stream_ready_at = ?,
      stream_created_at = COALESCE(stream_created_at, ?), stream_updated_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(uid || null, status, error || null, readyAt, createdAt, updatedAt, now, submissionId).run();
}

async function buildStreamPlaybackClient(row, request, env, submissionId, mediaType) {
  const streamUid = row.stream_uid || row.streamUid || '';
  if ((row.media_type || row.mediaType || mediaType) !== 'video' || !streamUid) {
    return emptyStreamPlayback(row);
  }

  let status = row.stream_status || row.streamStatus || 'processing';
  let readyAt = row.stream_ready_at || row.streamReadyAt || '';
  let error = row.stream_error || row.streamError || '';

  if (status !== 'ready' && status !== 'error') {
    const refreshed = await refreshStreamStatusIfNeeded(env, submissionId, streamUid, status).catch(() => null);
    if (refreshed) {
      status = refreshed.status;
      readyAt = refreshed.readyAt;
      error = refreshed.error;
    }
  }

  if (status !== 'ready') {
    return { status, url: '', readyAt: readyAt || '', error: error || '' };
  }

  const token = await createStreamPlaybackToken(env, streamUid).catch(() => '');
  return {
    status,
    url: token ? `${STREAM_DELIVERY_BASE_URL}/${encodeURIComponent(token)}/manifest/video.m3u8` : '',
    readyAt: readyAt || '',
    error: ''
  };
}

function emptyStreamPlayback(row = {}) {
  return {
    status: row.stream_status || row.streamStatus || 'none',
    url: '',
    readyAt: row.stream_ready_at || row.streamReadyAt || '',
    error: row.stream_error || row.streamError || ''
  };
}

async function createStreamPlaybackToken(env, streamUid) {
  if (!streamUid || !isStreamConfigured(env)) return '';

  const nowSeconds = Math.floor(Date.now() / 1000);
  const cached = streamPlaybackTokenCache.get(streamUid);
  if (cached && cached.expiresAt > nowSeconds + 60) return cached.token;

  const accountId = getCloudflareAccountId(env);
  const exp = nowSeconds + STREAM_TOKEN_TTL_SECONDS;
  const result = await cloudflareApiFetch(env, `/accounts/${encodeURIComponent(accountId)}/stream/${encodeURIComponent(streamUid)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exp })
  });
  const token = result?.token || '';
  if (token) streamPlaybackTokenCache.set(streamUid, { token, expiresAt: exp });
  return token;
}

async function deleteStreamVideo(env, streamUid) {
  if (!streamUid || !isStreamConfigured(env)) return;
  const accountId = getCloudflareAccountId(env);
  await cloudflareApiFetch(env, `/accounts/${encodeURIComponent(accountId)}/stream/${encodeURIComponent(streamUid)}`, {
    method: 'DELETE'
  }).catch((error) => {
    console.error('Cloudflare Stream delete failed', streamUid, String(error.message || error));
  });
}

function streamRecordFromVideo(video, fallbackStatus = 'queued') {
  const status = normalizeStreamStatus(video, fallbackStatus);
  return {
    uid: video?.uid || '',
    status,
    error: status === 'error' ? cleanText(video?.status?.errorReasonText || 'Cloudflare Stream processing failed.', 500) : '',
    readyAt: video?.readyToStreamAt || (status === 'ready' ? new Date().toISOString() : ''),
    createdAt: video?.created || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function normalizeStreamStatus(video, fallbackStatus = 'queued') {
  const state = String(video?.status?.state || '').toLowerCase();
  if (video?.readyToStream || video?.readyToStreamAt || state === 'ready') return 'ready';
  if (state === 'error') return 'error';
  if (state === 'inprogress') return 'processing';
  return fallbackStatus;
}

async function buildMediaAccessUrl(request, env, submissionId, ttlSeconds = MEDIA_TOKEN_TTL_SECONDS) {
  const mediaToken = await createSignedToken(env, 'media', submissionId, ttlSeconds);
  return `${getApiOrigin(request, env)}/moments-api/media/${encodeURIComponent(submissionId)}?mediaToken=${encodeURIComponent(mediaToken)}&disposition=inline`;
}

function isStreamConfigured(env) {
  return Boolean(getCloudflareAccountId(env) && getCloudflareAuthHeaders(env));
}

function getCloudflareAccountId(env) {
  return cleanText(env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID, 80);
}

function getCloudflareAuthHeaders(env) {
  const email = cleanText(env.CLOUDFLARE_EMAIL || env.CF_API_EMAIL, 200);
  const globalKey = cleanText(env.CLOUDFLARE_GLOBAL_API_KEY || env.CLOUDFLARE_API, 300);
  if (email && globalKey) {
    return {
      'X-Auth-Email': email,
      'X-Auth-Key': globalKey
    };
  }

  const apiToken = cleanText(env.CLOUDFLARE_STREAM_API_TOKEN || env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN || env.CLOUDFLARE_API, 300);
  if (!apiToken) return null;
  return { Authorization: `Bearer ${apiToken}` };
}

async function cloudflareApiFetch(env, path, init = {}) {
  const authHeaders = getCloudflareAuthHeaders(env);
  if (!authHeaders) throw new Error('Cloudflare Stream API credentials are not configured.');

  const response = await fetch(`${STREAM_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...authHeaders,
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok || payload.success === false) {
    const message = payload.errors?.[0]?.message || `Cloudflare Stream API returned ${response.status}.`;
    throw new Error(message);
  }

  return payload.result || payload;
}

function getStreamAllowedOrigins(env) {
  const values = (env.STREAM_ALLOWED_ORIGINS || `${getSiteUrl(env)},https://www.williamsonwallflowers.com`)
    .split(',')
    .map((value) => hostnameForOrigin(value))
    .filter(Boolean);
  return [...new Set(values)];
}

function hostnameForOrigin(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  try {
    return new URL(trimmed).hostname;
  } catch {
    return trimmed.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }
}

async function handleAdminApi(request, env, url, corsHeaders, parts) {
  if (!isAdminRequest(request, url, env)) {
    return json({ ok: false, message: 'Admin token is required.' }, 401, corsHeaders);
  }

  if (request.method === 'GET' && parts[0] === 'overview') {
    return getAdminOverview(request, env, corsHeaders);
  }

  if (request.method === 'GET' && parts[0] === 'retention-candidates') {
    return getRetentionCandidates(env, corsHeaders);
  }

  if (request.method === 'POST' && parts[0] === 'retention-cleanup') {
    return runRetentionCleanup(request, env, corsHeaders);
  }

  if (request.method === 'POST' && parts[0] === 'stream-backfill') {
    return runStreamBackfill(request, env, corsHeaders);
  }

  if (request.method === 'POST' && parts[0] === 'events') {
    return createAdminEvent(request, env, corsHeaders);
  }

  if (request.method === 'PATCH' && parts[0] === 'events' && parts[1]) {
    return updateAdminEvent(request, env, corsHeaders, parts[1]);
  }

  if (request.method === 'DELETE' && parts[0] === 'events' && parts[1]) {
    return deleteAdminEvent(request, env, corsHeaders, parts[1]);
  }

  if (request.method === 'POST' && parts[0] === 'tags') {
    return createAdminTag(request, env, corsHeaders);
  }

  if (request.method === 'PATCH' && parts[0] === 'tags' && parts[1]) {
    return updateAdminTag(request, env, corsHeaders, parts[1]);
  }

  if (request.method === 'DELETE' && parts[0] === 'tags' && parts[1]) {
    return deleteAdminTag(request, env, corsHeaders, parts[1]);
  }

  if (request.method === 'POST' && parts[0] === 'wall-devices') {
    return createAdminWallDevice(request, env, corsHeaders);
  }

  if (request.method === 'PATCH' && parts[0] === 'wall-devices' && parts[1]) {
    return updateAdminWallDevice(request, env, corsHeaders, parts[1]);
  }

  if (request.method === 'POST' && parts[0] === 'wall-devices' && parts[1] && parts[2] === 'triggers') {
    return triggerAdminWallDevice(request, env, corsHeaders, parts[1]);
  }

  return json({ ok: false, message: 'Admin route not found.' }, 404, corsHeaders);
}

async function getAdminOverview(request, env, corsHeaders) {
  const eventsResult = await env.MOMENTS_DB.prepare(`
    SELECT
      e.*,
      COALESCE(SUM(CASE WHEN s.status = 'pending' AND s.deleted_at IS NULL THEN 1 ELSE 0 END), 0) AS pending_count,
      COALESCE(SUM(CASE WHEN s.status = 'approved' AND s.deleted_at IS NULL THEN 1 ELSE 0 END), 0) AS approved_count,
      COALESCE(SUM(CASE WHEN s.status = 'rejected' AND s.deleted_at IS NULL THEN 1 ELSE 0 END), 0) AS rejected_count
    FROM events e
    LEFT JOIN submissions s ON s.event_id = e.id
    GROUP BY e.id
    ORDER BY e.created_at DESC
  `).all();

  const tagsResult = await env.MOMENTS_DB.prepare(`
    SELECT
      t.*,
      e.name AS active_event_name
    FROM tags t
    LEFT JOIN events e ON e.id = t.active_event_id
    ORDER BY t.created_at DESC
  `).all();

  const devicesResult = await env.MOMENTS_DB.prepare(`
    SELECT
      wd.*,
      e.name AS event_name,
      COALESCE(SUM(CASE WHEN lt.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_trigger_count,
      COALESCE(SUM(CASE WHEN lt.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_trigger_count
    FROM wall_devices wd
    INNER JOIN events e ON e.id = wd.event_id
    LEFT JOIN light_triggers lt ON lt.wall_device_id = wd.id
    GROUP BY wd.id
    ORDER BY wd.created_at DESC
  `).all();

  const stats = await env.MOMENTS_DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM events) AS events,
      (SELECT COUNT(*) FROM tags) AS tags,
      (SELECT COUNT(*) FROM submissions WHERE status = 'pending' AND deleted_at IS NULL) AS pending,
      (SELECT COUNT(*) FROM submissions WHERE status = 'approved' AND deleted_at IS NULL) AS approved,
      (SELECT COUNT(*) FROM wall_devices) AS wallDevices,
      (SELECT COUNT(*) FROM light_triggers WHERE status = 'pending') AS pendingLightTriggers
  `).first();

  return json({
    ok: true,
    stats,
    events: (eventsResult.results || []).map((row) => toAdminEventClient(row, env)),
    tags: (tagsResult.results || []).map((row) => toAdminTagClient(row)),
    wallDevices: (devicesResult.results || []).map((row) => toAdminWallDeviceClient(row)),
    links: {
      guestBaseUrl: `${getSiteUrl(env)}/moments/?t=`,
      adminUrl: `${getSiteUrl(env)}/moments/admin/`
    }
  }, 200, corsHeaders);
}

async function getRetentionCandidates(env, corsHeaders) {
  const result = await env.MOMENTS_DB.prepare(`
    SELECT s.id, s.event_id AS eventId, s.object_key AS objectKey, e.retention_expires_at AS retentionExpiresAt
    FROM submissions s
    INNER JOIN events e ON e.id = s.event_id
    WHERE e.retention_expires_at <= ? AND s.deleted_at IS NULL
    ORDER BY e.retention_expires_at ASC
  `).bind(new Date().toISOString()).all();

  return json({ ok: true, candidates: result.results || [] }, 200, corsHeaders);
}

async function runRetentionCleanup(request, env, corsHeaders) {
  let limit = RETENTION_CLEANUP_LIMIT;

  try {
    const body = await request.json();
    limit = Math.max(1, Math.min(Number(body.limit || limit), RETENTION_CLEANUP_LIMIT));
  } catch {
    // An empty body is fine; use the default cleanup limit.
  }

  const result = await cleanExpiredMedia(env, limit);
  return json({ ok: true, ...result }, 200, corsHeaders);
}

async function runStreamBackfill(request, env, corsHeaders) {
  let body = {};

  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const dryRun = normalizeBoolean(body.dryRun);
  const retryErrors = normalizeBoolean(body.retryErrors);
  const requestedLimit = Number(body.limit || STREAM_BACKFILL_DEFAULT_LIMIT);
  const limit = Number.isFinite(requestedLimit) ? Math.max(
    1,
    Math.min(requestedLimit, STREAM_BACKFILL_MAX_LIMIT)
  ) : STREAM_BACKFILL_DEFAULT_LIMIT;
  const configured = isStreamConfigured(env);

  if (!dryRun && !configured) {
    return json({
      ok: false,
      message: 'Cloudflare Stream is not configured for this Worker.'
    }, 503, corsHeaders);
  }

  const [eligible, candidates] = await Promise.all([
    countStreamBackfillCandidates(env, retryErrors),
    getStreamBackfillCandidates(env, limit, retryErrors)
  ]);
  let queued = 0;
  const errors = [];

  if (!dryRun) {
    for (const candidate of candidates) {
      try {
        const result = await optimizeSubmissionForStream(env, request, candidate);
        if (result?.ok === false) {
          errors.push({
            id: candidate.id,
            message: result.error || 'Cloudflare Stream did not accept this video.'
          });
        } else {
          queued += 1;
        }
      } catch (error) {
        errors.push({
          id: candidate.id,
          message: cleanText(error.message || error, 500)
        });
      }
    }
  }

  return json({
    ok: errors.length === 0,
    dryRun,
    configured,
    retryErrors,
    limit,
    eligible,
    scanned: candidates.length,
    queued,
    remaining: Math.max(eligible - queued, 0),
    candidates: candidates.map(toStreamBackfillCandidateClient),
    errors
  }, errors.length ? 207 : 200, corsHeaders);
}

async function countStreamBackfillCandidates(env, retryErrors = false) {
  const row = await env.MOMENTS_DB.prepare(`
    SELECT COUNT(*) AS count
    FROM submissions
    WHERE ${streamBackfillWhereClause(retryErrors)}
  `).first();

  return Number(row?.count || 0);
}

async function getStreamBackfillCandidates(env, limit, retryErrors = false) {
  const result = await env.MOMENTS_DB.prepare(`
    SELECT
      id,
      event_id AS eventId,
      media_type AS mediaType,
      source,
      object_key AS objectKey,
      original_filename AS originalFilename,
      mime_type AS mimeType,
      size,
      status,
      stream_uid AS streamUid,
      stream_status AS streamStatus,
      stream_error AS streamError,
      stream_ready_at AS streamReadyAt,
      stream_created_at AS streamCreatedAt,
      stream_updated_at AS streamUpdatedAt,
      deleted_at AS deletedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM submissions
    WHERE ${streamBackfillWhereClause(retryErrors)}
    ORDER BY created_at ASC
    LIMIT ?
  `).bind(limit).all();

  return result.results || [];
}

function streamBackfillWhereClause(retryErrors = false) {
  const retryFilter = retryErrors ? " OR stream_status = 'error'" : '';
  return `
    media_type = 'video'
    AND status = 'approved'
    AND deleted_at IS NULL
    AND (
      (
        (
          stream_uid IS NULL
          OR stream_uid = ''
          OR stream_status IS NULL
          OR stream_status = ''
          OR stream_status = 'none'
        )
        AND COALESCE(stream_status, 'none') != 'error'
      )
      ${retryFilter}
    )
  `;
}

function toStreamBackfillCandidateClient(row) {
  return {
    id: row.id,
    eventId: row.eventId || row.event_id,
    source: row.source || 'guest',
    streamStatus: row.streamStatus || row.stream_status || 'none',
    streamUidPresent: Boolean(row.streamUid || row.stream_uid),
    createdAt: row.createdAt || row.created_at || ''
  };
}

async function cleanExpiredMedia(env, limit = RETENTION_CLEANUP_LIMIT) {
  const now = new Date().toISOString();
  const result = await env.MOMENTS_DB.prepare(`
    SELECT s.id, s.object_key AS objectKey, s.thumbnail_object_key AS thumbnailObjectKey, s.stream_uid AS streamUid
    FROM submissions s
    INNER JOIN events e ON e.id = s.event_id
    WHERE e.retention_expires_at <= ? AND s.deleted_at IS NULL
    ORDER BY e.retention_expires_at ASC
    LIMIT ?
  `).bind(now, limit).all();

  const candidates = result.results || [];
  let purged = 0;
  const errors = [];

  for (const candidate of candidates) {
    try {
      await env.MOMENTS_BUCKET.delete(candidate.objectKey);
      if (candidate.thumbnailObjectKey) await env.MOMENTS_BUCKET.delete(candidate.thumbnailObjectKey);
      if (candidate.streamUid) await deleteStreamVideo(env, candidate.streamUid);
      await env.MOMENTS_DB.prepare(`
        UPDATE submissions
        SET status = 'deleted', deleted_at = ?, updated_at = ?
        WHERE id = ?
      `).bind(now, now, candidate.id).run();
      purged += 1;
    } catch (error) {
      errors.push({ id: candidate.id, message: String(error.message || error) });
    }
  }

  return { checked: candidates.length, purged, errors };
}

async function createAdminEvent(request, env, corsHeaders) {
  const body = await request.json();
  const name = cleanText(body.name, 120);

  if (!name) {
    return json({ ok: false, message: 'Event name is required.' }, 400, corsHeaders);
  }

  const now = new Date().toISOString();
  const eventDate = cleanText(body.eventDate, 20);
  const timeCapsuleEnabled = normalizeBoolean(body.timeCapsuleEnabled);
  const id = crypto.randomUUID();
  const hostToken = randomToken();
  const adminToken = randomToken();
  const timeCapsuleShareToken = timeCapsuleEnabled ? randomToken() : null;
  const timeCapsuleTitle = timeCapsuleEnabled ? (cleanText(body.timeCapsuleTitle, 140) || `${name} Time Capsule`) : null;
  const timeCapsuleStatus = timeCapsuleEnabled ? 'published' : 'draft';
  const timeCapsulePublishedAt = timeCapsuleEnabled ? now : null;
  const retentionExpiresAt = getRetentionExpiresAt(eventDate, timeCapsuleEnabled ? TIME_CAPSULE_RETENTION_DAYS : STANDARD_RETENTION_DAYS);

  await env.MOMENTS_DB.prepare(`
    INSERT INTO events (
      id, name, event_date, host_name, host_email, host_token, admin_token,
      status, retention_expires_at, created_at, updated_at, time_capsule_enabled,
      time_capsule_status, time_capsule_title, time_capsule_share_token, time_capsule_published_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    name,
    eventDate || null,
    cleanText(body.hostName, 90),
    cleanText(body.hostEmail, 140),
    hostToken,
    adminToken,
    retentionExpiresAt,
    now,
    now,
    timeCapsuleEnabled ? 1 : 0,
    timeCapsuleStatus,
    timeCapsuleTitle,
    timeCapsuleShareToken,
    timeCapsulePublishedAt
  ).run();

  return json({
    ok: true,
    event: {
      id,
      name,
      eventDate,
      hostToken,
      adminToken,
      retentionExpiresAt,
      hostUrl: `${getSiteUrl(env)}/moments/host/?event=${encodeURIComponent(id)}#token=${encodeURIComponent(hostToken)}`,
      timeCapsuleEnabled,
      timeCapsuleStatus,
      timeCapsuleTitle,
      timeCapsuleShareToken,
      timeCapsulePublishedAt,
      capsuleShareUrl: timeCapsuleEnabled ? buildTimeCapsuleShareUrl(env, id, timeCapsuleShareToken) : ''
    }
  }, 201, corsHeaders);
}

async function updateAdminEvent(request, env, corsHeaders, eventId) {
  const current = await getEventById(env, eventId);
  if (!current) return json({ ok: false, message: 'Event not found.' }, 404, corsHeaders);

  const body = await request.json();
  const nextEventDate = body.eventDate === undefined ? current.eventDate : cleanText(body.eventDate, 20);
  const nextTimeCapsuleEnabled = body.timeCapsuleEnabled === undefined
    ? Boolean(current.timeCapsuleEnabled)
    : normalizeBoolean(body.timeCapsuleEnabled);
  const shouldRecalculateRetention = body.retentionExpiresAt === undefined
    && (body.eventDate !== undefined || body.timeCapsuleEnabled !== undefined);
  const nextTimeCapsuleShareToken = nextTimeCapsuleEnabled
    ? (current.timeCapsuleShareToken || randomToken())
    : current.timeCapsuleShareToken;
  const timeCapsuleWasEnabled = Boolean(current.timeCapsuleEnabled);
  const requestedTimeCapsuleStatus = !nextTimeCapsuleEnabled
    ? 'draft'
    : body.timeCapsuleStatus === undefined
    ? (nextTimeCapsuleEnabled && !timeCapsuleWasEnabled ? 'published' : current.timeCapsuleStatus)
    : normalizeStatus(body.timeCapsuleStatus, ['draft', 'published']);
  const next = {
    name: body.name === undefined ? current.name : cleanText(body.name, 120),
    eventDate: nextEventDate || null,
    hostName: body.hostName === undefined ? current.hostName : cleanText(body.hostName, 90),
    hostEmail: body.hostEmail === undefined ? current.hostEmail : cleanText(body.hostEmail, 140),
    status: body.status === undefined ? current.status : normalizeStatus(body.status, ['active', 'inactive', 'archived']),
    hostToken: body.rotateHostToken ? randomToken() : current.hostToken,
    retentionExpiresAt: body.retentionExpiresAt || (
      shouldRecalculateRetention
        ? getRetentionExpiresAt(nextEventDate, nextTimeCapsuleEnabled ? TIME_CAPSULE_RETENTION_DAYS : STANDARD_RETENTION_DAYS)
        : current.retentionExpiresAt
    ),
    timeCapsuleEnabled: nextTimeCapsuleEnabled,
    timeCapsuleStatus: requestedTimeCapsuleStatus,
    timeCapsuleTitle: body.timeCapsuleTitle === undefined ? current.timeCapsuleTitle : cleanText(body.timeCapsuleTitle, 140),
    timeCapsuleShareToken: nextTimeCapsuleShareToken,
    timeCapsulePublishedAt: !nextTimeCapsuleEnabled
      ? null
      : requestedTimeCapsuleStatus === 'published'
      ? (current.timeCapsulePublishedAt || new Date().toISOString())
      : (requestedTimeCapsuleStatus === 'draft' || !nextTimeCapsuleEnabled ? null : current.timeCapsulePublishedAt)
  };

  if (!next.name) {
    return json({ ok: false, message: 'Event name is required.' }, 400, corsHeaders);
  }

  next.timeCapsuleTitle = next.timeCapsuleEnabled
    ? (next.timeCapsuleTitle || `${next.name} Time Capsule`)
    : null;

  await env.MOMENTS_DB.prepare(`
    UPDATE events
    SET name = ?, event_date = ?, host_name = ?, host_email = ?, status = ?, host_token = ?,
      retention_expires_at = ?, time_capsule_enabled = ?, time_capsule_status = ?,
      time_capsule_title = ?, time_capsule_share_token = ?, time_capsule_published_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    next.name,
    next.eventDate,
    next.hostName,
    next.hostEmail,
    next.status,
    next.hostToken,
    next.retentionExpiresAt,
    next.timeCapsuleEnabled ? 1 : 0,
    next.timeCapsuleStatus,
    next.timeCapsuleTitle,
    next.timeCapsuleShareToken,
    next.timeCapsulePublishedAt,
    new Date().toISOString(),
    eventId
  ).run();

  return json({ ok: true, event: { id: eventId, ...next } }, 200, corsHeaders);
}

async function deleteAdminEvent(request, env, corsHeaders, eventId) {
  const current = await getEventById(env, eventId);
  if (!current) return json({ ok: false, message: 'Event not found.' }, 404, corsHeaders);

  const mediaResult = await env.MOMENTS_DB.prepare(`
    SELECT id, object_key AS objectKey, thumbnail_object_key AS thumbnailObjectKey, stream_uid AS streamUid
    FROM submissions
    WHERE event_id = ?
  `).bind(eventId).all();
  const mediaRows = mediaResult.results || [];
  const now = new Date().toISOString();

  await env.MOMENTS_DB.prepare(`
    UPDATE tags
    SET active_event_id = NULL, updated_at = ?
    WHERE active_event_id = ?
  `).bind(now, eventId).run();
  await env.MOMENTS_DB.prepare('DELETE FROM time_capsule_items WHERE event_id = ?').bind(eventId).run();
  await env.MOMENTS_DB.prepare('DELETE FROM submissions WHERE event_id = ?').bind(eventId).run();
  await env.MOMENTS_DB.prepare('DELETE FROM events WHERE id = ?').bind(eventId).run();

  let deletedMedia = 0;
  const mediaErrors = [];
  for (const row of mediaRows) {
    if (!row.objectKey && !row.thumbnailObjectKey && !row.streamUid) continue;
    try {
      if (row.objectKey) {
        await env.MOMENTS_BUCKET.delete(row.objectKey);
        deletedMedia += 1;
      }
      if (row.thumbnailObjectKey) {
        await env.MOMENTS_BUCKET.delete(row.thumbnailObjectKey);
        deletedMedia += 1;
      }
      if (row.streamUid) {
        await deleteStreamVideo(env, row.streamUid);
        deletedMedia += 1;
      }
    } catch (error) {
      console.error('R2 delete failed for admin-deleted event media', eventId, row.id, error);
      mediaErrors.push({ id: row.id, message: String(error.message || error) });
    }
  }

  return json({
    ok: true,
    deletedEventId: eventId,
    deletedMedia,
    mediaErrors
  }, 200, corsHeaders);
}

async function createAdminTag(request, env, corsHeaders) {
  const body = await request.json();
  const publicCode = normalizeTagCode(body.publicCode) || `ww-${randomToken(9).toLowerCase()}`;
  const label = cleanText(body.label, 100);

  if (!label) {
    return json({ ok: false, message: 'Tag label is required.' }, 400, corsHeaders);
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  try {
    await env.MOMENTS_DB.prepare(`
      INSERT INTO tags (id, public_code, label, status, active_event_id, created_at, updated_at)
      VALUES (?, ?, ?, 'active', NULL, ?, ?)
    `).bind(id, publicCode, label, now, now).run();
  } catch (error) {
    if (String(error.message || error).toLowerCase().includes('unique')) {
      return json({ ok: false, message: 'That public tag code already exists.' }, 409, corsHeaders);
    }
    throw error;
  }

  return json({ ok: true, tag: { id, publicCode, label, status: 'active' } }, 201, corsHeaders);
}

async function updateAdminTag(request, env, corsHeaders, tagId) {
  const body = await request.json();
  const current = await env.MOMENTS_DB.prepare('SELECT * FROM tags WHERE id = ?').bind(tagId).first();
  if (!current) return json({ ok: false, message: 'Tag not found.' }, 404, corsHeaders);

  const activeEventId = body.activeEventId === undefined ? current.active_event_id : cleanText(body.activeEventId, 80) || null;

  if (activeEventId) {
    const event = await getEventById(env, activeEventId);
    if (!event) return json({ ok: false, message: 'Assigned event was not found.' }, 404, corsHeaders);
  }

  const next = {
    label: body.label === undefined ? current.label : cleanText(body.label, 100),
    status: body.status === undefined ? current.status : normalizeStatus(body.status, ['active', 'inactive']),
    activeEventId
  };

  await env.MOMENTS_DB.prepare(`
    UPDATE tags
    SET label = ?, status = ?, active_event_id = ?, updated_at = ?
    WHERE id = ?
  `).bind(next.label, next.status, next.activeEventId, new Date().toISOString(), tagId).run();

  return json({ ok: true, tag: { id: tagId, ...next } }, 200, corsHeaders);
}

async function deleteAdminTag(request, env, corsHeaders, tagId) {
  const current = await env.MOMENTS_DB.prepare('SELECT * FROM tags WHERE id = ?').bind(tagId).first();
  if (!current) return json({ ok: false, message: 'Tag not found.' }, 404, corsHeaders);

  await env.MOMENTS_DB.prepare('DELETE FROM tags WHERE id = ?').bind(tagId).run();

  return json({
    ok: true,
    deletedTagId: tagId
  }, 200, corsHeaders);
}

async function createAdminWallDevice(request, env, corsHeaders) {
  const body = await request.json();
  const eventId = cleanText(body.eventId, 80);
  const name = cleanText(body.name, 100) || 'Butterfly Wall';

  if (!eventId) {
    return json({ ok: false, message: 'Event is required for the wall device.' }, 400, corsHeaders);
  }

  const event = await getEventById(env, eventId);
  if (!event) {
    return json({ ok: false, message: 'Assigned event was not found.' }, 404, corsHeaders);
  }

  const bridgeToken = randomToken();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const device = {
    scanPresetId: normalizePresetId(body.scanPresetId, DEFAULT_SCAN_PRESET_ID),
    submissionPresetId: normalizePresetId(body.submissionPresetId, DEFAULT_SUBMISSION_PRESET_ID),
    manualPresetId: normalizePresetId(body.manualPresetId, DEFAULT_MANUAL_PRESET_ID),
    brightness: normalizeBrightness(body.brightness, DEFAULT_LIGHT_BRIGHTNESS),
    status: normalizeStatus(body.status, ['active', 'inactive'])
  };

  try {
    await env.MOMENTS_DB.prepare(`
      INSERT INTO wall_devices (
        id, event_id, name, status, bridge_token_hash, scan_preset_id,
        submission_preset_id, manual_preset_id, brightness, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      eventId,
      name,
      device.status,
      await hashBridgeToken(bridgeToken),
      device.scanPresetId,
      device.submissionPresetId,
      device.manualPresetId,
      device.brightness,
      now,
      now
    ).run();
  } catch (error) {
    if (String(error.message || error).toLowerCase().includes('unique')) {
      return json({ ok: false, message: 'This event already has a wall device.' }, 409, corsHeaders);
    }
    throw error;
  }

  const created = await getWallDeviceById(env, id);
  return json({
    ok: true,
    wallDevice: toAdminWallDeviceClient(created),
    bridgeToken,
    bridgeConfig: buildBridgeConfig(env, id, bridgeToken)
  }, 201, corsHeaders);
}

async function updateAdminWallDevice(request, env, corsHeaders, deviceId) {
  const current = await getWallDeviceById(env, deviceId);
  if (!current) {
    return json({ ok: false, message: 'Wall device not found.' }, 404, corsHeaders);
  }

  const body = await request.json();
  const eventId = body.eventId === undefined ? current.eventId : cleanText(body.eventId, 80);

  if (!eventId) {
    return json({ ok: false, message: 'Event is required for the wall device.' }, 400, corsHeaders);
  }

  if (eventId !== current.eventId) {
    const event = await getEventById(env, eventId);
    if (!event) return json({ ok: false, message: 'Assigned event was not found.' }, 404, corsHeaders);
  }

  const next = {
    eventId,
    name: body.name === undefined ? current.name : cleanText(body.name, 100) || current.name,
    status: body.status === undefined ? current.status : normalizeStatus(body.status, ['active', 'inactive']),
    scanPresetId: body.scanPresetId === undefined ? current.scanPresetId : normalizePresetId(body.scanPresetId, current.scanPresetId),
    submissionPresetId: body.submissionPresetId === undefined ? current.submissionPresetId : normalizePresetId(body.submissionPresetId, current.submissionPresetId),
    manualPresetId: body.manualPresetId === undefined ? current.manualPresetId : normalizePresetId(body.manualPresetId, current.manualPresetId),
    brightness: body.brightness === undefined ? current.brightness : normalizeBrightness(body.brightness, current.brightness)
  };
  const bridgeToken = body.rotateBridgeToken ? randomToken() : '';
  const bridgeTokenHash = bridgeToken ? await hashBridgeToken(bridgeToken) : current.bridgeTokenHash;

  try {
    await env.MOMENTS_DB.prepare(`
      UPDATE wall_devices
      SET event_id = ?, name = ?, status = ?, bridge_token_hash = ?, scan_preset_id = ?,
          submission_preset_id = ?, manual_preset_id = ?, brightness = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      next.eventId,
      next.name,
      next.status,
      bridgeTokenHash,
      next.scanPresetId,
      next.submissionPresetId,
      next.manualPresetId,
      next.brightness,
      new Date().toISOString(),
      deviceId
    ).run();
  } catch (error) {
    if (String(error.message || error).toLowerCase().includes('unique')) {
      return json({ ok: false, message: 'That event already has a wall device.' }, 409, corsHeaders);
    }
    throw error;
  }

  const updated = await getWallDeviceById(env, deviceId);
  return json({
    ok: true,
    wallDevice: toAdminWallDeviceClient(updated),
    bridgeToken: bridgeToken || undefined,
    bridgeConfig: bridgeToken ? buildBridgeConfig(env, deviceId, bridgeToken) : undefined
  }, 200, corsHeaders);
}

async function triggerAdminWallDevice(request, env, corsHeaders, deviceId) {
  const device = await getWallDeviceById(env, deviceId);
  if (!device) {
    return json({ ok: false, message: 'Wall device not found.' }, 404, corsHeaders);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const triggerType = normalizeTriggerType(body.triggerType || 'manual_test');
  const presetId = normalizePresetId(body.presetId, getPresetForTrigger(device, triggerType));
  const brightness = normalizeBrightness(body.brightness, device.brightness || DEFAULT_LIGHT_BRIGHTNESS);
  const trigger = await queueDeviceLightTrigger(env, {
    eventId: device.eventId,
    wallDeviceId: device.id,
    triggerType,
    presetId,
    brightness
  });

  return json({ ok: true, queued: Boolean(trigger), trigger }, 201, corsHeaders);
}

async function handleBridgeApi(request, env, url, corsHeaders, parts) {
  if (request.method === 'GET' && parts[0] === 'devices' && parts[1] && parts[2] === 'triggers') {
    return listBridgeTriggers(request, env, url, corsHeaders, parts[1]);
  }

  if (request.method === 'POST' && parts[0] === 'triggers' && parts[1] && parts[2] === 'complete') {
    return completeBridgeTrigger(request, env, url, corsHeaders, parts[1]);
  }

  return json({ ok: false, message: 'Bridge route not found.' }, 404, corsHeaders);
}

async function listBridgeTriggers(request, env, url, corsHeaders, deviceId) {
  const bridge = await authorizeBridgeDevice(request, url, env, deviceId);

  if (!bridge.ok) {
    return json({ ok: false, message: bridge.message }, bridge.status, corsHeaders);
  }

  const now = new Date().toISOString();
  await env.MOMENTS_DB.prepare('UPDATE wall_devices SET last_seen_at = ?, updated_at = ? WHERE id = ?')
    .bind(now, now, deviceId)
    .run();

  const result = await env.MOMENTS_DB.prepare(`
    SELECT
      id,
      event_id AS eventId,
      wall_device_id AS wallDeviceId,
      trigger_type AS triggerType,
      preset_id AS presetId,
      brightness,
      status,
      attempts,
      created_at AS createdAt
    FROM light_triggers
    WHERE wall_device_id = ? AND status = 'pending'
    ORDER BY created_at ASC
    LIMIT ?
  `).bind(deviceId, BRIDGE_TRIGGER_LIMIT).all();

  const triggers = result.results || [];

  for (const trigger of triggers) {
    await env.MOMENTS_DB.prepare(`
      UPDATE light_triggers
      SET status = 'processing', attempts = attempts + 1, claimed_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).bind(now, now, trigger.id).run();
  }

  return json({
    ok: true,
    device: {
      id: bridge.device.id,
      name: bridge.device.name
    },
    triggers: triggers.map(toBridgeTriggerClient)
  }, 200, corsHeaders);
}

async function completeBridgeTrigger(request, env, url, corsHeaders, triggerId) {
  const trigger = await getLightTriggerWithDevice(env, triggerId);
  if (!trigger) {
    return json({ ok: false, message: 'Light trigger not found.' }, 404, corsHeaders);
  }

  const bridge = await authorizeBridgeDevice(request, url, env, trigger.wallDeviceId, trigger.device);

  if (!bridge.ok) {
    return json({ ok: false, message: bridge.message }, bridge.status, corsHeaders);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const now = new Date().toISOString();
  const success = body.success === true;

  if (success) {
    await env.MOMENTS_DB.prepare(`
      UPDATE light_triggers
      SET status = 'completed', completed_at = ?, error_message = NULL, updated_at = ?
      WHERE id = ?
    `).bind(now, now, triggerId).run();

    return json({ ok: true, status: 'completed' }, 200, corsHeaders);
  }

  const nextStatus = Number(trigger.attempts || 0) >= BRIDGE_MAX_ATTEMPTS ? 'failed' : 'pending';
  await env.MOMENTS_DB.prepare(`
    UPDATE light_triggers
    SET status = ?, error_message = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    nextStatus,
    cleanText(body.errorMessage, 500) || 'Bridge reported a WLED failure.',
    now,
    triggerId
  ).run();

  return json({ ok: true, status: nextStatus }, 200, corsHeaders);
}

function getAllowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin, env) {
  if (!origin) {
    return true;
  }

  return getAllowedOrigins(env).includes(origin);
}

function getCorsHeaders(origin, env) {
  const allowedOrigin = isAllowedOrigin(origin, env) && origin ? origin : 'https://www.williamsonwallflowers.com';

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Range, X-Admin-Token, Authorization',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag, Content-Disposition',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin'
  };
}

async function consumeRateLimit(env, key, limit, windowSeconds) {
  if (!env.MOMENTS_DB) return { ok: true, remaining: limit };

  const nowMs = Date.now();
  const windowMs = windowSeconds * 1000;
  const windowStart = Math.floor(nowMs / windowMs) * windowMs;
  const now = new Date(nowMs).toISOString();
  const current = await env.MOMENTS_DB.prepare('SELECT window_start AS windowStart, count FROM rate_limits WHERE key = ?')
    .bind(key)
    .first();

  if (!current || Number(current.windowStart) !== windowStart) {
    await env.MOMENTS_DB.prepare(`
      INSERT INTO rate_limits (key, window_start, count, updated_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1, updated_at = excluded.updated_at
    `).bind(key, windowStart, now).run();
    return { ok: true, remaining: Math.max(limit - 1, 0) };
  }

  if (Number(current.count) >= limit) {
    return { ok: false, remaining: 0 };
  }

  await env.MOMENTS_DB.prepare('UPDATE rate_limits SET count = count + 1, updated_at = ? WHERE key = ?')
    .bind(now, key)
    .run();

  return { ok: true, remaining: Math.max(limit - Number(current.count) - 1, 0) };
}

async function getClientRateLimitKey(request, scope) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0] || 'unknown';
  const userAgent = request.headers.get('User-Agent') || 'unknown';
  const digest = await sha256Hex(`${ip}|${userAgent}`);
  return `${scope}:${digest.slice(0, 32)}`;
}

async function getReactionActorLimitScope(request, eventId, submissionId, sessionId = "") {
  const normalizedEventId = String(eventId || '').trim();
  const normalizedSubmissionId = String(submissionId || '').trim();
  const normalizedSessionId = String(sessionId || '').trim();
  const baseScope = `interaction:${normalizedEventId}:${normalizedSubmissionId}:like:actor`;

  if (normalizedSessionId) {
    const sessionDigest = await sha256Hex(`session:${normalizedSessionId}`);
    return `${baseScope}:session:${sessionDigest.slice(0, 32)}`;
  }

  return getClientRateLimitKey(request, `interaction:${normalizedEventId}:${normalizedSubmissionId}:like`);
}

async function validateEventQuota(env, eventId, incomingBytes) {
  const usage = await env.MOMENTS_DB.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes
    FROM submissions
    WHERE event_id = ? AND deleted_at IS NULL AND status != 'deleted'
  `).bind(eventId).first();

  const maxSubmissions = Number(env.MOMENTS_EVENT_MAX_SUBMISSIONS || DEFAULT_EVENT_MAX_SUBMISSIONS);
  const maxBytes = Number(env.MOMENTS_EVENT_MAX_BYTES || DEFAULT_EVENT_MAX_BYTES);

  if (Number(usage?.count || 0) >= maxSubmissions) {
    return 'This event has reached its submission limit.';
  }

  if (Number(usage?.bytes || 0) + Number(incomingBytes || 0) > maxBytes) {
    return 'This event has reached its storage limit.';
  }

  return '';
}

async function recordScanEvent(env, eventId, tagId) {
  try {
    await env.MOMENTS_DB.prepare(`
      INSERT INTO scan_events (id, event_id, tag_id, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(crypto.randomUUID(), eventId, tagId, new Date().toISOString()).run();
  } catch (error) {
    console.error('Wallflower Moments scan audit failed', String(error.message || error));
  }
}

async function safeQueueEventLightTrigger(env, eventId, triggerType) {
  try {
    return await queueEventLightTrigger(env, eventId, triggerType);
  } catch (error) {
    console.error('Wallflower Moments light trigger queue failed', String(error.message || error));
    return null;
  }
}

async function queueEventLightTrigger(env, eventId, triggerType) {
  const device = await getActiveWallDeviceForEvent(env, eventId);
  if (!device) return null;

  return queueDeviceLightTrigger(env, {
    eventId,
    wallDeviceId: device.id,
    triggerType,
    presetId: getPresetForTrigger(device, triggerType),
    brightness: device.brightness || DEFAULT_LIGHT_BRIGHTNESS
  });
}

async function queueDeviceLightTrigger(env, input) {
  const now = new Date().toISOString();
  const trigger = {
    id: crypto.randomUUID(),
    eventId: input.eventId,
    wallDeviceId: input.wallDeviceId,
    triggerType: normalizeTriggerType(input.triggerType),
    presetId: normalizePresetId(input.presetId, DEFAULT_MANUAL_PRESET_ID),
    brightness: normalizeBrightness(input.brightness, DEFAULT_LIGHT_BRIGHTNESS),
    status: 'pending',
    createdAt: now
  };

  await env.MOMENTS_DB.prepare(`
    INSERT INTO light_triggers (
      id, event_id, wall_device_id, trigger_type, preset_id, brightness,
      status, attempts, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).bind(
    trigger.id,
    trigger.eventId,
    trigger.wallDeviceId,
    trigger.triggerType,
    trigger.presetId,
    trigger.brightness,
    trigger.status,
    now,
    now
  ).run();

  return trigger;
}

async function getActiveWallDeviceForEvent(env, eventId) {
  const row = await env.MOMENTS_DB.prepare(`
    SELECT
      id,
      event_id AS eventId,
      name,
      status,
      bridge_token_hash AS bridgeTokenHash,
      scan_preset_id AS scanPresetId,
      submission_preset_id AS submissionPresetId,
      manual_preset_id AS manualPresetId,
      brightness,
      last_seen_at AS lastSeenAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM wall_devices
    WHERE event_id = ? AND status = 'active'
    LIMIT 1
  `).bind(eventId).first();

  return row || null;
}

async function getWallDeviceById(env, deviceId) {
  const row = await env.MOMENTS_DB.prepare(`
    SELECT
      wd.id,
      wd.event_id AS eventId,
      wd.name,
      wd.status,
      wd.bridge_token_hash AS bridgeTokenHash,
      wd.scan_preset_id AS scanPresetId,
      wd.submission_preset_id AS submissionPresetId,
      wd.manual_preset_id AS manualPresetId,
      wd.brightness,
      wd.last_seen_at AS lastSeenAt,
      wd.created_at AS createdAt,
      wd.updated_at AS updatedAt,
      e.name AS eventName
    FROM wall_devices wd
    INNER JOIN events e ON e.id = wd.event_id
    WHERE wd.id = ?
  `).bind(deviceId).first();

  return row || null;
}

async function getLightTriggerWithDevice(env, triggerId) {
  const row = await env.MOMENTS_DB.prepare(`
    SELECT
      lt.id,
      lt.event_id AS eventId,
      lt.wall_device_id AS wallDeviceId,
      lt.trigger_type AS triggerType,
      lt.preset_id AS presetId,
      lt.brightness,
      lt.status,
      lt.attempts,
      lt.created_at AS createdAt,
      wd.id AS deviceId,
      wd.name AS deviceName,
      wd.status AS deviceStatus,
      wd.bridge_token_hash AS bridgeTokenHash
    FROM light_triggers lt
    INNER JOIN wall_devices wd ON wd.id = lt.wall_device_id
    WHERE lt.id = ?
  `).bind(triggerId).first();

  if (!row) return null;

  return {
    id: row.id,
    eventId: row.eventId,
    wallDeviceId: row.wallDeviceId,
    triggerType: row.triggerType,
    presetId: row.presetId,
    brightness: row.brightness,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.createdAt,
    device: {
      id: row.deviceId,
      name: row.deviceName,
      status: row.deviceStatus,
      bridgeTokenHash: row.bridgeTokenHash
    }
  };
}

async function authorizeBridgeDevice(request, url, env, deviceId, knownDevice) {
  const token = getBearerToken(request) || url.searchParams.get('bridgeToken') || '';

  if (!token) {
    return { ok: false, status: 401, message: 'Bridge token is required.' };
  }

  const device = knownDevice || await getWallDeviceById(env, deviceId);

  if (!device || device.status !== 'active') {
    return { ok: false, status: 403, message: 'This wall device is not active.' };
  }

  const tokenHash = await hashBridgeToken(token);
  if (!constantTimeEqual(tokenHash, device.bridgeTokenHash || '')) {
    return { ok: false, status: 403, message: 'Bridge token is not valid.' };
  }

  return { ok: true, device };
}

function getBearerToken(request) {
  const auth = request.headers.get('Authorization') || '';
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
}

function normalizeTriggerType(value) {
  const triggerType = String(value || '').toLowerCase();
  return ['tag_scan', 'submission_received', 'manual_test'].includes(triggerType) ? triggerType : 'manual_test';
}

function getPresetForTrigger(device, triggerType) {
  if (triggerType === 'tag_scan') return Number(device.scanPresetId || DEFAULT_SCAN_PRESET_ID);
  if (triggerType === 'submission_received') return Number(device.submissionPresetId || DEFAULT_SUBMISSION_PRESET_ID);
  return Number(device.manualPresetId || DEFAULT_MANUAL_PRESET_ID);
}

function normalizePresetId(value, fallback) {
  const presetId = Number(value);
  if (Number.isInteger(presetId) && presetId >= 1 && presetId <= 250) return presetId;
  return Number(fallback || DEFAULT_MANUAL_PRESET_ID);
}

function normalizeBrightness(value, fallback) {
  const brightness = Number(value);
  if (Number.isInteger(brightness) && brightness >= 1 && brightness <= 255) return brightness;
  return Number(fallback || DEFAULT_LIGHT_BRIGHTNESS);
}

async function hashBridgeToken(token) {
  return sha256Hex(`wallflower-bridge:${token}`);
}

function toBridgeTriggerClient(row) {
  return {
    id: row.id,
    eventId: row.eventId,
    wallDeviceId: row.wallDeviceId,
    triggerType: row.triggerType,
    presetId: Number(row.presetId),
    brightness: Number(row.brightness),
    createdAt: row.createdAt
  };
}

function buildBridgeConfig(env, deviceId, bridgeToken) {
  const apiBaseUrl = getApiBaseUrl(env);
  const apiBase = apiBaseUrl.endsWith('/moments-api') ? apiBaseUrl : `${apiBaseUrl}/moments-api`;

  return [
    `WALLFLOWER_API_BASE=${apiBase}`,
    `WALL_DEVICE_ID=${deviceId}`,
    `BRIDGE_TOKEN=${bridgeToken}`,
    'WLED_BASE_URL=http://192.168.1.50',
    'BRIDGE_POLL_MS=1500',
    'WLED_TIMEOUT_MS=5000'
  ].join('\n');
}

function getApiBaseUrl(env) {
  return (env.MOMENTS_API_URL || env.PUBLIC_SITE_URL || PUBLIC_SITE_URL).replace(/\/$/, '');
}

async function readSubmission(request) {
  const contentType = request.headers.get('Content-Type') || '';

  if (contentType.includes('application/json')) {
    return request.json();
  }

  const formData = await request.formData();
  const submission = {};

  formData.forEach((value, key) => {
    submission[key] = String(value).trim();
  });

  return submission;
}

function validateSubmission(submission) {
  for (const field of REQUIRED_FIELDS) {
    if (!submission[field]) {
      return `Missing required field: ${getLabel(field)}`;
    }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submission.email)) {
    return 'Please enter a valid email address.';
  }

  return '';
}

async function sendInternalNotification(submission, env) {
  const recipients = getInternalRecipients(env);
  const subject = `Williamson Wallflowers Inquiry${submission['event-type'] ? ` - ${submission['event-type']}` : ''}`;
  const text = buildInternalEmail(submission);
  const results = await Promise.all(recipients.map((to) => sendEmail({ env, to, subject, text })));
  const failedResult = results.find((result) => !result.ok);

  return failedResult || new Response(null, { status: 200 });
}

async function sendApplicantConfirmation(submission, env) {
  return sendEmail({
    env,
    to: submission.email,
    subject: 'Williamson Wallflowers received your inquiry',
    text: buildApplicantConfirmation(submission)
  });
}

async function queueUploadNotification(env, ctx, details) {
  const work = sendUploadNotification(env, details).catch((error) => {
    console.error('Wallflower Moments upload notification failed', error?.message || error);
  });

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(work);
    return;
  }

  await work;
}

async function sendUploadNotification(env, details) {
  const resendApiKey = env.resend || env.RESEND_API_KEY || env.RESEND;
  if (!resendApiKey || !env.FROM_EMAIL) return;

  const notification = {
    ...details,
    reviewUrl: buildUploadReviewUrl(env, details)
  };
  const recipients = getUploadNotificationRecipients(notification);
  if (recipients.length === 0) return;

  const subject = buildUploadNotificationSubject(notification);
  const result = await sendEmail({
    env,
    to: recipients,
    subject,
    text: buildUploadNotificationEmail(notification),
    html: buildUploadNotificationHtml(notification)
  });

  if (!result.ok) {
    const detail = await result.text();
    throw new Error(`Resend upload notification failed: ${result.status} ${detail}`);
  }
}

function sendEmail({ env, to, subject, text, html }) {
  const resendApiKey = env.resend || env.RESEND_API_KEY || env.RESEND;

  if (!resendApiKey || !env.FROM_EMAIL) {
    throw new Error('Missing resend, RESEND_API_KEY, RESEND, or FROM_EMAIL.');
  }

  const recipients = normalizeEmailRecipients(to);
  if (recipients.length === 0) {
    throw new Error('Email requires at least one valid recipient.');
  }

  const body = {
    from: env.FROM_EMAIL,
    to: recipients,
    subject,
    text
  };

  if (html) body.html = html;

  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

function getInternalRecipients(env) {
  const recipients = [env.TO_EMAIL, env.SUPPORT_EMAIL]
    .filter(Boolean)
    .flatMap((value) => value.split(','))
    .map((email) => email.trim())
    .filter(Boolean);

  return [...new Set(recipients)];
}

function getUploadNotificationRecipients(details) {
  const recipients = [UPLOAD_NOTIFICATION_RECIPIENT];

  if (details.sourceLabel === 'Guest upload' && details.event?.hostEmail) {
    recipients.push(details.event.hostEmail);
  }

  return normalizeEmailRecipients(recipients);
}

function normalizeEmailRecipients(value) {
  const values = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const recipients = [];

  values
    .filter(Boolean)
    .flatMap((entry) => String(entry).split(','))
    .map((email) => email.trim())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    .forEach((email) => {
      const key = email.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      recipients.push(email);
    });

  return recipients;
}

function buildInternalEmail(submission) {
  return FIELD_LABELS
    .filter(([key]) => submission[key])
    .map(([key, label]) => `${label}: ${formatSubmissionField(key, submission[key])}`)
    .join('\n\n');
}

function buildApplicantConfirmation(submission) {
  const timeCapsuleLine = normalizeBoolean(submission['ask-time-capsule'])
    ? '\nWallflower Time Capsule: We will include add-on details in your follow-up.'
    : '';

  return `Hi ${getFirstName(submission.name)},

Thanks for reaching out to Williamson Wallflowers.

We received your event inquiry and Jami will review the details soon.

Quick summary:
Event Date: ${submission['event-date'] || 'Not provided'}
Event Type: ${submission['event-type'] || 'Not provided'}
Venue / Location: ${submission.venue || 'Not provided'}
Preferred Wall: ${submission['preferred-wall'] || 'Not provided'}${timeCapsuleLine}

Williamson Wallflowers
Luxury flower wall rentals for Nashville, Williamson County, and Middle Tennessee
jamicarswell@gmail.com`;
}

function buildUploadNotificationEmail(details) {
  if (details.sourceLabel === 'Guest upload') {
    return buildGuestUploadNotificationEmail(details);
  }

  const lines = [
    'A new Wallflower Moments media upload was received.',
    '',
    `Event: ${details.event?.name || 'Unknown event'}`,
    `Event ID: ${details.event?.id || 'Unknown event ID'}`,
    `Source: ${details.sourceLabel}`,
    `Media type: ${details.mediaType}`,
    `Filename: ${details.originalFilename || 'Not provided'}`,
    `Size: ${details.size || 0} bytes`,
    `Status: ${details.status || 'pending'}`,
    `Uploaded at: ${details.createdAt || new Date().toISOString()}`
  ];

  if (details.title) lines.push(`Title: ${details.title}`);
  if (details.caption) lines.push(`Caption: ${details.caption}`);
  if (details.guestName) lines.push(`Guest name: ${details.guestName}`);
  if (details.guestNote) lines.push(`Note: ${details.guestNote}`);
  if (details.event?.hostName) lines.push(`Event host: ${details.event.hostName}`);
  if (details.previewUrl) lines.push(`Preview: ${details.previewUrl}`);
  if (details.reviewUrl) {
    lines.push(
      '',
      'Review this submission:',
      details.reviewUrl,
      '',
      'Open the host dashboard to approve it, add it to Party View, add it to the Time Capsule, or reject it.'
    );
  }

  return lines.join('\n');
}

function buildGuestUploadNotificationEmail(details) {
  const eventName = details.event?.name || 'your event';
  const mediaLabel = getUploadMediaLabel(details.mediaType);
  const guestName = getUploadGuestName(details);
  const lines = [
    `${guestName} shared a new ${mediaLabel} for ${eventName}.`,
    '',
    `Event: ${eventName}`,
    `Guest: ${guestName}`,
    `Moment: ${capitalizeFirst(mediaLabel)}`
  ];

  if (details.guestNote) lines.push(`Message from guest: ${details.guestNote}`);
  if (details.previewUrl) lines.push(`Preview image: ${details.previewUrl}`);
  if (details.reviewUrl) {
    lines.push(
      '',
      'Review this moment:',
      details.reviewUrl,
      '',
      'Approve or reject it in the host dashboard. Approved moments can go to Party View, the Time Capsule, or both.'
    );
  }

  return lines.join('\n');
}

function buildUploadNotificationHtml(details) {
  if (details.sourceLabel === 'Guest upload') {
    return buildGuestUploadNotificationHostHtml(details);
  }

  const eventName = details.event?.name || 'Unknown event';
  const mediaLabel = getUploadMediaLabel(details.mediaType);
  const headline = `A new host ${mediaLabel} was posted`;
  const intro = 'A host post was added to this event.';
  const detailRows = [
    ['Event', eventName],
    ['Event ID', details.event?.id || 'Unknown event ID'],
    ['Source', details.sourceLabel || 'Unknown source'],
    ['Media type', details.mediaType || 'Unknown media'],
    ['Filename', details.originalFilename || 'Not provided'],
    ['Size', `${details.size || 0} bytes`],
    ['Status', details.status || 'pending'],
    ['Uploaded at', details.createdAt || new Date().toISOString()]
  ];

  if (details.title) detailRows.push(['Title', details.title]);
  if (details.caption) detailRows.push(['Caption', details.caption]);
  if (details.guestName) detailRows.push(['Guest name', details.guestName]);
  if (details.guestNote) detailRows.push(['Note', details.guestNote]);
  if (details.event?.hostName) detailRows.push(['Event host', details.event.hostName]);

  const rows = detailRows
    .map(([label, value]) => `
      <tr>
        <td style="padding:8px 0;color:#7a6d66;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0;">${escapeEmailHtml(label)}</td>
        <td style="padding:8px 0;color:#2f2b28;font-size:15px;font-weight:700;text-align:right;">${escapeEmailHtml(value)}</td>
      </tr>`)
    .join('');

  const reviewButton = details.reviewUrl
    ? `<a href="${escapeEmailAttribute(details.reviewUrl)}" style="display:inline-block;margin-top:20px;border-radius:8px;background:#2f6f5f;color:#fffaf5;font-size:16px;font-weight:800;line-height:1;text-decoration:none;padding:15px 20px;">Review submission</a>
      <p style="margin:14px 0 0;color:#7a6d66;font-size:13px;line-height:1.5;">This opens the private host dashboard for approval, Party View, Time Capsule, or rejection.</p>`
    : '';
  const previewBlock = buildUploadNotificationPreviewHtml(details, mediaLabel, eventName);

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f7f1eb;font-family:Arial,Helvetica,sans-serif;color:#2f2b28;">
    <div style="display:none;max-height:0;overflow:hidden;">${escapeEmailHtml(headline)} for ${escapeEmailHtml(eventName)}.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f1eb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fffaf5;border:1px solid #eadfd6;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:24px 26px;background:#2f2b28;color:#fffaf5;">
                <div style="font-size:12px;font-weight:800;letter-spacing:0;text-transform:uppercase;color:#f7d8c7;">Wallflower Moments</div>
                <h1 style="margin:10px 0 0;font-size:26px;line-height:1.15;">${escapeEmailHtml(headline)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 26px;">
                <p style="margin:0 0 18px;color:#4f4742;font-size:16px;line-height:1.6;">${escapeEmailHtml(intro)}</p>
                ${previewBlock}
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #eadfd6;border-bottom:1px solid #eadfd6;padding:8px 0;">
                  ${rows}
                </table>
                ${reviewButton}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildGuestUploadNotificationHostHtml(details) {
  const eventName = details.event?.name || 'your event';
  const mediaLabel = getUploadMediaLabel(details.mediaType);
  const guestName = getUploadGuestName(details);
  const headline = `${guestName} shared a new ${mediaLabel}`;
  const intro = `Review this moment for ${eventName}. Approve or reject it, then choose whether it belongs in Party View, the Time Capsule, or both.`;
  const detailRows = [
    ['Event', eventName],
    ['Guest', guestName],
    ['Moment', capitalizeFirst(mediaLabel)]
  ];

  if (details.guestNote) detailRows.push(['Message', details.guestNote]);

  const rows = detailRows
    .map(([label, value]) => `
      <tr>
        <td style="padding:8px 0;color:#7a6d66;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0;">${escapeEmailHtml(label)}</td>
        <td style="padding:8px 0;color:#2f2b28;font-size:15px;font-weight:700;text-align:right;">${escapeEmailHtml(value)}</td>
      </tr>`)
    .join('');

  const reviewButton = details.reviewUrl
    ? `<a href="${escapeEmailAttribute(details.reviewUrl)}" style="display:inline-block;margin-top:20px;border-radius:8px;background:#2f6f5f;color:#fffaf5;font-size:16px;font-weight:800;line-height:1;text-decoration:none;padding:15px 20px;">Review this moment</a>
      <p style="margin:14px 0 0;color:#7a6d66;font-size:13px;line-height:1.5;">This opens the private host dashboard so you can approve, reject, or place the moment where it belongs.</p>`
    : '';
  const previewBlock = buildUploadNotificationPreviewHtml(details, mediaLabel, eventName);

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f7f1eb;font-family:Arial,Helvetica,sans-serif;color:#2f2b28;">
    <div style="display:none;max-height:0;overflow:hidden;">${escapeEmailHtml(headline)} for ${escapeEmailHtml(eventName)}.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f1eb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fffaf5;border:1px solid #eadfd6;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:24px 26px;background:#2f2b28;color:#fffaf5;">
                <div style="font-size:12px;font-weight:800;letter-spacing:0;text-transform:uppercase;color:#f7d8c7;">Wallflower Moments</div>
                <h1 style="margin:10px 0 0;font-size:26px;line-height:1.15;">${escapeEmailHtml(headline)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 26px;">
                <p style="margin:0 0 18px;color:#4f4742;font-size:16px;line-height:1.6;">${escapeEmailHtml(intro)}</p>
                ${previewBlock}
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #eadfd6;border-bottom:1px solid #eadfd6;padding:8px 0;">
                  ${rows}
                </table>
                ${reviewButton}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildUploadNotificationPreviewHtml(details, mediaLabel, eventName) {
  if (details.sourceLabel !== 'Guest upload' || !details.previewUrl) return '';

  return `<div style="margin:0 0 20px;">
                  <div style="margin:0 0 8px;color:#7a6d66;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0;">Media preview</div>
                  <img src="${escapeEmailAttribute(details.previewUrl)}" width="588" alt="${escapeEmailAttribute(`${mediaLabel} preview for ${eventName}`)}" style="display:block;width:100%;max-width:588px;max-height:360px;object-fit:contain;border-radius:10px;border:1px solid #eadfd6;background:#1f1d1a;">
                </div>`;
}

async function buildUploadNotificationPreviewUrl(request, env, submissionId, mediaType, thumbnailObjectKey = '') {
  if (mediaType === 'photo') {
    return buildMediaAccessUrl(request, env, submissionId, EMAIL_PREVIEW_TOKEN_TTL_SECONDS);
  }

  if (mediaType === 'video' && thumbnailObjectKey) {
    return buildThumbnailAccessUrl(request, env, submissionId, EMAIL_PREVIEW_TOKEN_TTL_SECONDS);
  }

  return '';
}

function buildUploadNotificationSubject(details) {
  if (details.sourceLabel === 'Guest upload') {
    const mediaLabel = getUploadMediaLabel(details.mediaType);
    const eventName = details.event?.name ? ` for ${details.event.name}` : '';
    return `Wallflower Moments: ${getUploadGuestName(details)} shared a ${mediaLabel}${eventName}`;
  }

  return `Wallflower Moments ${getUploadNotificationSubjectSource(details.sourceLabel)} ${details.mediaType} upload`;
}

function buildUploadReviewUrl(env, details) {
  if (details.sourceLabel !== 'Guest upload') return '';
  const eventId = details.event?.id;
  const hostToken = details.event?.hostToken;
  const submissionId = details.submissionId;

  if (!eventId || !hostToken || !submissionId) return '';

  return `${getSiteUrl(env)}/moments/host/?event=${encodeURIComponent(eventId)}&submission=${encodeURIComponent(submissionId)}#token=${encodeURIComponent(hostToken)}`;
}

function getUploadNotificationSubjectSource(sourceLabel) {
  return sourceLabel === 'Host post' ? 'Host' : 'Guest';
}

function getUploadMediaLabel(mediaType) {
  if (mediaType === 'audio') return 'voice memo';
  if (mediaType === 'video') return 'video';
  return 'photo';
}

function getUploadGuestName(details) {
  return String(details.guestName || '').trim() || 'A guest';
}

function capitalizeFirst(value) {
  const text = String(value || '');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function escapeEmailHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function escapeEmailAttribute(value) {
  return escapeEmailHtml(value).replace(/`/g, '&#96;');
}

function formatSubmissionField(key, value) {
  if (key === 'ask-time-capsule') {
    return normalizeBoolean(value) ? 'Yes' : 'No';
  }

  return value;
}

function getFirstName(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || 'there';
}

function getLabel(field) {
  const match = FIELD_LABELS.find(([key]) => key === field);
  return match ? match[1] : field;
}

function getEmailErrorMessage(status, detail) {
  const normalizedDetail = String(detail || '').toLowerCase();

  if (status === 401 || normalizedDetail.includes('api key')) {
    return 'Email delivery is not configured correctly yet. Check the Resend API key secret in Cloudflare.';
  }

  if (status === 403 || normalizedDetail.includes('domain') || normalizedDetail.includes('sender')) {
    return 'Email delivery is not configured correctly yet. Verify the williamsonwallflowers.com sender domain in Resend.';
  }

  return 'Email delivery is temporarily unavailable. Please email jamicarswell@gmail.com directly.';
}

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

async function getEventById(env, eventId) {
  const row = await env.MOMENTS_DB.prepare(`
    SELECT
      id,
      name,
      event_date AS eventDate,
      event_start_at AS eventStartAt,
      countdown_enabled AS countdownEnabled,
      countdown_message AS countdownMessage,
      guest_uploads_before_countdown_enabled AS guestUploadsBeforeCountdownEnabled,
      party_view_swipe_enabled AS partyViewSwipeEnabled,
      host_name AS hostName,
      host_email AS hostEmail,
      host_token AS hostToken,
      admin_token AS adminToken,
      status,
      retention_expires_at AS retentionExpiresAt,
      time_capsule_enabled AS timeCapsuleEnabled,
      time_capsule_status AS timeCapsuleStatus,
      time_capsule_title AS timeCapsuleTitle,
      time_capsule_share_token AS timeCapsuleShareToken,
      time_capsule_published_at AS timeCapsulePublishedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM events
    WHERE id = ?
  `).bind(eventId).first();

  return row || null;
}

async function getHostEvent(env, eventId, token) {
  if (!token) return null;

  const row = await env.MOMENTS_DB.prepare(`
    SELECT
      id,
      name,
      event_date AS eventDate,
      event_start_at AS eventStartAt,
      countdown_enabled AS countdownEnabled,
      countdown_message AS countdownMessage,
      guest_uploads_before_countdown_enabled AS guestUploadsBeforeCountdownEnabled,
      party_view_swipe_enabled AS partyViewSwipeEnabled,
      host_name AS hostName,
      host_email AS hostEmail,
      host_token AS hostToken,
      admin_token AS adminToken,
      status,
      retention_expires_at AS retentionExpiresAt,
      time_capsule_enabled AS timeCapsuleEnabled,
      time_capsule_status AS timeCapsuleStatus,
      time_capsule_title AS timeCapsuleTitle,
      time_capsule_share_token AS timeCapsuleShareToken,
      time_capsule_published_at AS timeCapsulePublishedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM events
    WHERE id = ? AND host_token = ?
  `).bind(eventId, token).first();

  return row || null;
}

async function getAuthorizedCapsuleEvent(request, env, url, eventId) {
  const token = getAccessToken(request, url);
  const event = await getHostEvent(env, eventId, token);

  if (!event) {
    return { response: json({ ok: false, message: 'This host gallery link is not valid.' }, 403, getCorsHeaders(request.headers.get('Origin') || '', env)) };
  }

  if (!event.timeCapsuleEnabled) {
    return { response: json({ ok: false, message: 'Wallflower Time Capsule is not enabled for this event.' }, 404, getCorsHeaders(request.headers.get('Origin') || '', env)) };
  }

  return { record: event };
}

async function getTimeCapsuleItems(env, eventId, request, options = {}) {
  const visibilityFilter = options.visibleOnly ? 'AND i.is_visible = 1' : '';
  const sourceFilter = options.hostOnly ? "AND s.source = 'host'" : '';
  const result = await env.MOMENTS_DB.prepare(`
    SELECT
      i.id,
      i.event_id AS eventId,
      i.submission_id AS submissionId,
      i.title,
      i.caption,
      i.chapter,
      i.captured_at AS capturedAt,
      i.location,
      i.sort_order AS sortOrder,
      i.is_visible AS isVisible,
      i.created_at AS createdAt,
      i.updated_at AS updatedAt,
      s.media_type AS mediaType,
      s.source AS source,
      s.mime_type AS mimeType,
      s.size,
      s.thumbnail_object_key AS thumbnailObjectKey,
      s.thumbnail_mime_type AS thumbnailMimeType,
      s.thumbnail_size AS thumbnailSize,
      s.thumbnail_created_at AS thumbnailCreatedAt,
      s.stream_uid AS streamUid,
      s.stream_status AS streamStatus,
      s.stream_error AS streamError,
      s.stream_ready_at AS streamReadyAt,
      s.stream_created_at AS streamCreatedAt,
      s.stream_updated_at AS streamUpdatedAt,
      s.duration_seconds AS durationSeconds,
      s.guest_name AS guestName,
      s.guest_note AS guestNote,
      s.status AS submissionStatus,
      s.deleted_at AS deletedAt,
      s.created_at AS submissionCreatedAt,
      s.updated_at AS submissionUpdatedAt
    FROM time_capsule_items i
    INNER JOIN submissions s ON s.id = i.submission_id
    WHERE i.event_id = ? AND s.status = 'approved' AND s.deleted_at IS NULL ${visibilityFilter} ${sourceFilter}
    ORDER BY i.sort_order ASC, i.created_at ASC
  `).bind(eventId).all();

  return Promise.all((result.results || []).map((row) => toTimeCapsuleItemClient(row, request, env)));
}

async function getGuestVisibleSubmissions(env, eventId, request) {
  const result = await env.MOMENTS_DB.prepare(`
    SELECT *
    FROM submissions
    WHERE event_id = ? AND status = 'approved' AND deleted_at IS NULL AND guest_visible_at IS NOT NULL
    ORDER BY created_at DESC, guest_visible_at DESC
  `).bind(eventId).all();

  return Promise.all((result.results || []).map((row) => toPartyViewSubmissionClient(row, request, env)));
}

async function getGuestPartyVisibleSubmission(env, eventId, submissionId) {
  return env.MOMENTS_DB.prepare(`
    SELECT
      s.id,
      s.event_id AS eventId
    FROM submissions s
    WHERE s.id = ? AND s.event_id = ? AND s.status = 'approved' AND s.deleted_at IS NULL AND s.guest_visible_at IS NOT NULL
  `).bind(submissionId, eventId).first();
}

async function getSubmissionInteractions(env, submissionId) {
  const reactionResult = await env.MOMENTS_DB.prepare(`
    SELECT reaction, COUNT(*) AS count
    FROM submission_reactions
    WHERE submission_id = ?
    GROUP BY reaction
  `).bind(submissionId).all();

  const commentsResult = await env.MOMENTS_DB.prepare(`
    SELECT id, comment, created_at AS createdAt
    FROM submission_comments
    WHERE submission_id = ?
    ORDER BY created_at DESC
    LIMIT 3
  `).bind(submissionId).all();

  const counts = Object.fromEntries(INTERACTION_REACTIONS.map((type) => [type, 0]));
  (reactionResult.results || []).forEach((row) => {
    const reaction = String(row.reaction || '').toLowerCase();
    if (INTERACTION_REACTIONS.includes(reaction)) {
      counts[reaction] = Number(row.count || 0);
    }
  });

  const comments = (commentsResult.results || [])
    .map((comment) => ({
      id: comment.id,
      text: String(comment.comment || '').trim(),
      createdAt: comment.createdAt
    }))
    .reverse();

  return {
    counts,
    comments
  };
}

async function getTimeCapsuleItemBySubmission(env, eventId, submissionId) {
  return env.MOMENTS_DB.prepare(`
    SELECT id
    FROM time_capsule_items
    WHERE event_id = ? AND submission_id = ?
  `).bind(eventId, submissionId).first();
}

async function getNextTimeCapsuleSortOrder(env, eventId) {
  const row = await env.MOMENTS_DB.prepare(`
    SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextSortOrder
    FROM time_capsule_items
    WHERE event_id = ?
  `).bind(eventId).first();

  return Number(row?.nextSortOrder || row?.next_sort_order || 1);
}

async function getTimeCapsuleItemById(env, itemId) {
  return env.MOMENTS_DB.prepare(`
    SELECT
      i.id,
      i.event_id AS eventId,
      i.submission_id AS submissionId,
      i.title,
      i.caption,
      i.chapter,
      i.captured_at AS capturedAt,
      i.location,
      i.sort_order AS sortOrder,
      i.is_visible AS isVisible,
      i.created_at AS createdAt,
      i.updated_at AS updatedAt,
      s.media_type AS mediaType,
      s.source AS source,
      s.mime_type AS mimeType,
      s.size,
      s.thumbnail_object_key AS thumbnailObjectKey,
      s.thumbnail_mime_type AS thumbnailMimeType,
      s.thumbnail_size AS thumbnailSize,
      s.thumbnail_created_at AS thumbnailCreatedAt,
      s.stream_uid AS streamUid,
      s.stream_status AS streamStatus,
      s.stream_error AS streamError,
      s.stream_ready_at AS streamReadyAt,
      s.stream_created_at AS streamCreatedAt,
      s.stream_updated_at AS streamUpdatedAt,
      s.duration_seconds AS durationSeconds,
      s.guest_name AS guestName,
      s.guest_note AS guestNote,
      s.status AS submissionStatus,
      s.deleted_at AS deletedAt,
      s.created_at AS submissionCreatedAt,
      s.updated_at AS submissionUpdatedAt
    FROM time_capsule_items i
    INNER JOIN submissions s ON s.id = i.submission_id
    WHERE i.id = ?
  `).bind(itemId).first();
}

async function getTimeCapsuleItemWithEvent(env, itemId) {
  return env.MOMENTS_DB.prepare(`
    SELECT
      i.id,
      i.title,
      i.caption,
      i.chapter,
      i.captured_at AS capturedAt,
      i.location,
      i.sort_order AS sortOrder,
      i.is_visible AS isVisible,
      i.created_at AS createdAt,
      e.host_token AS hostToken,
      e.time_capsule_enabled AS timeCapsuleEnabled
    FROM time_capsule_items i
    INNER JOIN events e ON e.id = i.event_id
    WHERE i.id = ?
  `).bind(itemId).first();
}

async function getSubmissionWithEvent(env, submissionId) {
  const row = await env.MOMENTS_DB.prepare(`
    SELECT
      s.id,
      s.event_id AS eventId,
      s.media_type AS mediaType,
      s.source AS source,
      s.object_key AS objectKey,
      s.original_filename AS originalFilename,
      s.mime_type AS mimeType,
      s.size,
      s.thumbnail_object_key AS thumbnailObjectKey,
      s.thumbnail_mime_type AS thumbnailMimeType,
      s.thumbnail_size AS thumbnailSize,
      s.thumbnail_created_at AS thumbnailCreatedAt,
      s.stream_uid AS streamUid,
      s.stream_status AS streamStatus,
      s.stream_error AS streamError,
      s.stream_ready_at AS streamReadyAt,
      s.stream_created_at AS streamCreatedAt,
      s.stream_updated_at AS streamUpdatedAt,
      s.duration_seconds AS durationSeconds,
      s.guest_name AS guestName,
      s.guest_note AS guestNote,
      s.consent_at AS consentAt,
      s.ai_artwork_consent_at AS aiArtworkConsentAt,
      s.status,
      s.guest_visible_at AS guestVisibleAt,
      s.deleted_at AS deletedAt,
      s.created_at AS createdAt,
      s.updated_at AS updatedAt,
      e.host_token AS hostToken,
      e.admin_token AS eventAdminToken
    FROM submissions s
    INNER JOIN events e ON e.id = s.event_id
    WHERE s.id = ?
  `).bind(submissionId).first();

  return row || null;
}

function isActiveEvent(event) {
  return event.eventStatus === 'active' || event.status === 'active'
    ? new Date(event.retentionExpiresAt) > new Date()
    : false;
}

function isGuestUploadBlockedBeforeCountdown(event) {
  if (Number(event.guestUploadsBeforeCountdownEnabled || 0) === 1) return false;
  if (Number(event.countdownEnabled || 0) !== 1) return false;
  if (!event.eventStartAt) return false;

  const start = new Date(event.eventStartAt);
  return !Number.isNaN(start.getTime()) && start.getTime() > Date.now();
}

function isAuthorizedForSubmission(submission, token, env) {
  if (!token) return false;
  return token === submission.hostToken || token === submission.eventAdminToken || token === env.MOMENTS_ADMIN_TOKEN;
}

function getAccessToken(request, url) {
  const headerToken = request.headers.get('X-Host-Token') || '';
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
  return headerToken || bearer || url.searchParams.get('token') || '';
}

function isAdminRequest(request, url, env) {
  const headerToken = request.headers.get('X-Admin-Token') || '';
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
  const queryToken = url.searchParams.get('adminToken') || '';
  const token = headerToken || bearer || queryToken;

  return Boolean(env.MOMENTS_ADMIN_TOKEN && token && token === env.MOMENTS_ADMIN_TOKEN);
}

function normalizeMediaType(mediaType, mimeType, filename = '') {
  const requested = String(mediaType || '').toLowerCase();
  if (requested === 'photo' || requested === 'video' || requested === 'audio') return requested;
  const baseMimeType = getBaseMimeType(mimeType);
  if (baseMimeType.startsWith('image/')) return 'photo';
  if (baseMimeType.startsWith('video/')) return 'video';
  if (baseMimeType.startsWith('audio/')) return 'audio';
  if (VIDEO_EXTENSIONS.has(getFileExtension(filename))) return 'video';
  if (AUDIO_EXTENSIONS.has(getFileExtension(filename))) return 'audio';
  return '';
}

function validateMedia(media, mediaType, durationSeconds) {
  if (mediaType === 'photo') {
    if (!PHOTO_TYPES.has(getBaseMimeType(media.type))) return 'Photos must be JPEG, PNG, WEBP, HEIC, or HEIF.';
    if (media.size > PHOTO_MAX_BYTES) return 'Photos must be 8 MB or smaller.';
    return '';
  }

  if (mediaType === 'video') {
    if (!isAllowedMobileVideo(media)) return 'Videos must be MP4, MOV, M4V, WEBM, or a standard Android camera video.';
    if (media.size > VIDEO_MAX_BYTES) return 'Videos must be 50 MB or smaller.';
    if (Number(durationSeconds || 0) > VIDEO_MAX_SECONDS + 1) return 'Videos must be 30 seconds or shorter.';
    return '';
  }

  if (mediaType === 'audio') {
    if (!isAllowedVoiceMemo(media)) return 'Voice memos must be M4A, MP3, WAV, OGG, or WEBM audio.';
    if (media.size > AUDIO_MAX_BYTES) return 'Voice memos must be 20 MB or smaller.';
    if (Number(durationSeconds || 0) > AUDIO_MAX_SECONDS + 1) return 'Voice memos must be 60 seconds or shorter.';
    return '';
  }

  return 'Please upload a photo, video, or voice memo.';
}

function validateVideoThumbnail(thumbnail, mediaType) {
  if (mediaType !== 'video' || !thumbnail) return { file: null, error: '' };
  if (typeof thumbnail === 'string' || typeof thumbnail.stream !== 'function') return { file: null, error: '' };

  if (!isAllowedVideoThumbnail(thumbnail)) {
    return { file: null, error: 'Video thumbnails must be JPEG, PNG, or WEBP images.' };
  }

  if (thumbnail.size > THUMBNAIL_MAX_BYTES) {
    return { file: null, error: 'Video thumbnails must be 768 KB or smaller.' };
  }

  return { file: thumbnail, error: '' };
}

function validateAiReference(aiReference, mediaType, aiArtworkConsent) {
  if (!aiArtworkConsent || mediaType !== 'photo' || !aiReference) return { file: null, error: '' };
  if (typeof aiReference === 'string' || typeof aiReference.stream !== 'function') return { file: null, error: '' };

  if (!isAllowedAiReference(aiReference)) {
    return { file: null, error: 'AI artwork references must be JPEG images.' };
  }

  if (aiReference.size > AI_REFERENCE_MAX_BYTES) {
    return { file: null, error: 'AI artwork references must be 5 MB or smaller.' };
  }

  return { file: aiReference, error: '' };
}

function isAllowedAiReference(aiReference) {
  const baseMimeType = getBaseMimeType(aiReference.type);
  const extension = getFileExtension(aiReference.name);

  if (baseMimeType === AI_REFERENCE_MIME_TYPE) return true;
  if ((!baseMimeType || baseMimeType === 'application/octet-stream') && ['jpg', 'jpeg'].includes(extension)) return true;

  return false;
}

function isAllowedVideoThumbnail(thumbnail) {
  const baseMimeType = getBaseMimeType(thumbnail.type);
  const extension = getFileExtension(thumbnail.name);

  if (THUMBNAIL_TYPES.has(baseMimeType)) return true;
  if ((!baseMimeType || baseMimeType === 'application/octet-stream') && ['jpg', 'jpeg', 'png', 'webp'].includes(extension)) return true;

  return false;
}

async function storeVideoThumbnail(env, eventId, submissionId, thumbnail, now = new Date().toISOString(), existingObjectKey = '') {
  const originalFilename = sanitizeFilename(thumbnail.name || `thumbnail-${submissionId}.jpg`);
  const mimeType = getStoredThumbnailMimeType(thumbnail.type, originalFilename);
  const objectKey = existingObjectKey || `moments/${eventId}/thumbnails/${submissionId}.${extensionFor(mimeType, originalFilename)}`;

  await env.MOMENTS_BUCKET.put(objectKey, thumbnail.stream(), {
    httpMetadata: {
      contentType: mimeType,
      contentDisposition: `inline; filename="${originalFilename}"`
    },
    customMetadata: {
      eventId,
      submissionId,
      mediaType: 'thumbnail'
    }
  });

  return {
    objectKey,
    mimeType,
    size: thumbnail.size || 0,
    createdAt: now
  };
}

async function storeAiReferenceImage(env, eventId, submissionId, aiReference, now = new Date().toISOString()) {
  const originalFilename = sanitizeFilename(aiReference.name || `${submissionId}-ai-reference.${AI_REFERENCE_EXTENSION}`);
  const objectKey = getAiReferenceObjectKey(eventId, submissionId);

  await env.MOMENTS_BUCKET.put(objectKey, aiReference.stream(), {
    httpMetadata: {
      contentType: AI_REFERENCE_MIME_TYPE,
      contentDisposition: `inline; filename="${originalFilename}"`
    },
    customMetadata: {
      eventId,
      submissionId,
      mediaType: 'ai-reference'
    }
  });

  return {
    objectKey,
    mimeType: AI_REFERENCE_MIME_TYPE,
    size: aiReference.size || 0,
    createdAt: now
  };
}

function getAiReferenceObjectKey(eventId, submissionId) {
  return `moments/${eventId}/ai-references/${submissionId}.${AI_REFERENCE_EXTENSION}`;
}

async function deleteAiReferenceImage(env, eventId, submissionId) {
  if (!eventId || !submissionId) return;
  await env.MOMENTS_BUCKET.delete(getAiReferenceObjectKey(eventId, submissionId));
}

function emptyThumbnailRecord() {
  return {
    objectKey: null,
    mimeType: null,
    size: 0,
    createdAt: null
  };
}

function isAllowedMobileVideo(media) {
  const baseMimeType = getBaseMimeType(media.type);
  const extension = getFileExtension(media.name);

  if (VIDEO_TYPES.has(baseMimeType)) return true;
  if (baseMimeType.startsWith('video/') && VIDEO_EXTENSIONS.has(extension)) return true;
  if ((!baseMimeType || baseMimeType === 'application/octet-stream') && VIDEO_EXTENSIONS.has(extension)) return true;

  return false;
}

function isAllowedVoiceMemo(media) {
  const baseMimeType = getBaseMimeType(media.type);
  const extension = getFileExtension(media.name);

  if (AUDIO_TYPES.has(baseMimeType)) return true;
  if (baseMimeType.startsWith('audio/') && AUDIO_EXTENSIONS.has(extension)) return true;
  if ((!baseMimeType || baseMimeType === 'application/octet-stream') && AUDIO_EXTENSIONS.has(extension)) return true;

  return false;
}

function cleanText(value, maxLength) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
}

function normalizeBoolean(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return value === true || normalized === 'true' || normalized === 'yes' || normalized === 'on' || normalized === '1';
}

function normalizeTagCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalizeStatus(value, allowed) {
  const status = String(value || '').toLowerCase();
  return allowed.includes(status) ? status : allowed[0];
}

function sanitizeFilename(value) {
  return String(value || 'wallflower-moment')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 140);
}

function extensionFor(mimeType, filename) {
  const extension = String(filename || '').split('.').pop();
  if (extension && extension.length <= 5 && extension !== filename) return extension.toLowerCase();

  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/x-m4v': 'm4v',
    'video/m4v': 'm4v',
    'video/3gpp': '3gp',
    'video/3gpp2': '3g2',
    'video/hevc': 'mov',
    'video/h264': 'mp4',
    'audio/aac': 'aac',
    'audio/flac': 'flac',
    'audio/m4a': 'm4a',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'audio/x-m4a': 'm4a',
    'audio/x-wav': 'wav'
  };

  return map[getBaseMimeType(mimeType)] || 'bin';
}

function getBaseMimeType(mimeType) {
  return String(mimeType || '').split(';')[0].trim().toLowerCase();
}

function getFileExtension(filename) {
  const clean = String(filename || '').split('?')[0].split('#')[0];
  const index = clean.lastIndexOf('.');
  return index >= 0 ? clean.slice(index + 1).toLowerCase() : '';
}

function getStoredMimeType(mimeType, filename, mediaType) {
  const baseMimeType = getBaseMimeType(mimeType);
  if (baseMimeType && baseMimeType !== 'application/octet-stream') return baseMimeType;

  const extension = getFileExtension(filename);
  const byExtension = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v',
    webm: 'video/webm',
    '3gp': 'video/3gpp',
    '3gpp': 'video/3gpp',
    '3g2': 'video/3gpp2',
    aac: 'audio/aac',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    oga: 'audio/ogg',
    ogg: 'audio/ogg',
    opus: 'audio/opus',
    wav: 'audio/wav',
    weba: 'audio/webm'
  };

  if (extension === 'webm' && mediaType === 'audio') return 'audio/webm';
  if (byExtension[extension]) return byExtension[extension];
  if (mediaType === 'video') return 'video/mp4';
  if (mediaType === 'audio') return 'audio/webm';
  return 'application/octet-stream';
}

function getStoredThumbnailMimeType(mimeType, filename) {
  const baseMimeType = getBaseMimeType(mimeType);
  if (THUMBNAIL_TYPES.has(baseMimeType)) return baseMimeType;

  const extension = getFileExtension(filename);
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return 'image/jpeg';
}

async function createSignedToken(env, scope, subject, ttlSeconds) {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${scope}.${subject}.${expiresAt}`;
  const signature = await signTokenPayload(env, payload);
  return `${expiresAt}.${signature}`;
}

async function verifySignedToken(env, token, scope, subject) {
  const [expiresAt, signature] = String(token || '').split('.');
  const expiresAtNumber = Number(expiresAt);

  if (!expiresAt || !signature || !Number.isFinite(expiresAtNumber)) return false;
  if (expiresAtNumber < Math.floor(Date.now() / 1000)) return false;

  const payload = `${scope}.${subject}.${expiresAt}`;
  const expectedSignature = await signTokenPayload(env, payload);
  return constantTimeEqual(signature, expectedSignature);
}

async function signTokenPayload(env, payload) {
  const secret = env.MOMENTS_TOKEN_SECRET || env.MOMENTS_ADMIN_TOKEN;
  if (!secret) throw new Error('Missing MOMENTS_TOKEN_SECRET or MOMENTS_ADMIN_TOKEN.');

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return base64UrlEncode(new Uint8Array(signature));
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64UrlEncode(bytes) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return difference === 0;
}

function randomToken(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function getRetentionExpiresAt(eventDate, retentionDays = STANDARD_RETENTION_DAYS) {
  const base = eventDate ? new Date(`${eventDate}T23:59:59Z`) : new Date();
  if (Number.isNaN(base.getTime())) base.setTime(Date.now());
  base.setUTCDate(base.getUTCDate() + retentionDays);
  return base.toISOString();
}

function normalizeCountdownStartAt(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString();
}

function toEventClient(row, env) {
  return {
    id: row.id,
    name: row.name,
    eventDate: row.eventDate,
    eventStartAt: row.eventStartAt || null,
    countdownEnabled: Number(row.countdownEnabled || 0) === 1,
    countdownMessage: row.countdownMessage || "",
    guestUploadsBeforeCountdownEnabled: Number(row.guestUploadsBeforeCountdownEnabled || 0) === 1,
    partyViewSwipeEnabled: Number(row.partyViewSwipeEnabled || 0) === 1,
    hostName: row.hostName,
    status: row.status,
    retentionExpiresAt: row.retentionExpiresAt,
    timeCapsule: toTimeCapsuleClient(row, env)
  };
}

function toTimeCapsuleClient(row, env) {
  const enabled = Boolean(row.timeCapsuleEnabled);
  return {
    enabled,
    status: row.timeCapsuleStatus || 'draft',
    title: row.timeCapsuleTitle || (enabled ? `${row.name} Time Capsule` : ''),
    shareToken: enabled ? row.timeCapsuleShareToken || '' : '',
    publishedAt: row.timeCapsulePublishedAt || '',
    shareUrl: enabled && row.timeCapsuleShareToken ? buildTimeCapsuleShareUrl(env, row.id, row.timeCapsuleShareToken) : ''
  };
}

function toAdminEventClient(row, env) {
  return {
    id: row.id,
    name: row.name,
    eventDate: row.event_date,
    hostName: row.host_name,
    hostEmail: row.host_email,
    hostToken: row.host_token,
    adminToken: row.admin_token,
    status: row.status,
    retentionExpiresAt: row.retention_expires_at,
    createdAt: row.created_at,
    timeCapsuleEnabled: Boolean(row.time_capsule_enabled),
    timeCapsuleStatus: row.time_capsule_status || 'draft',
    timeCapsuleTitle: row.time_capsule_title || '',
    timeCapsuleShareToken: row.time_capsule_share_token || '',
    timeCapsulePublishedAt: row.time_capsule_published_at || '',
    partyViewSwipeEnabled: Number(row.party_view_swipe_enabled || 0) === 1,
    capsuleShareUrl: row.time_capsule_enabled && row.time_capsule_share_token
      ? buildTimeCapsuleShareUrl(env, row.id, row.time_capsule_share_token)
      : '',
    pendingCount: row.pending_count,
    approvedCount: row.approved_count,
    rejectedCount: row.rejected_count,
    hostUrl: `${getSiteUrl(env)}/moments/host/?event=${encodeURIComponent(row.id)}#token=${encodeURIComponent(row.host_token)}`
  };
}

async function toTimeCapsuleItemClient(row, request, env) {
  const mediaToken = await createSignedToken(env, 'media', row.submissionId, MEDIA_TOKEN_TTL_SECONDS);
  const mediaUrl = `${getApiOrigin(request, env)}/moments-api/media/${encodeURIComponent(row.submissionId)}?mediaToken=${encodeURIComponent(mediaToken)}`;
  const thumbnail = await buildThumbnailClient(row, request, env, row.submissionId, row.mediaType, row.thumbnailObjectKey);
  const stream = await buildStreamPlaybackClient(row, request, env, row.submissionId, row.mediaType);
  const interactions = await getSubmissionInteractions(env, row.submissionId);

  return {
    id: row.id,
    eventId: row.eventId,
    submissionId: row.submissionId,
    title: row.title || 'Guest moment',
    caption: row.caption || '',
    chapter: row.chapter || 'Guest moments',
    capturedAt: row.capturedAt || row.submissionCreatedAt || row.createdAt,
    location: row.location || '',
    sortOrder: Number(row.sortOrder || 0),
    isVisible: row.isVisible !== 0,
    mediaType: row.mediaType,
    interactions,
    source: row.source || 'guest',
    mimeType: row.mimeType,
    size: row.size,
    durationSeconds: row.durationSeconds,
    guestName: row.guestName || '',
    guestNote: row.guestNote || '',
    mediaUrl,
    downloadUrl: mediaUrl,
    streamUrl: stream.url,
    streamStatus: stream.status,
    streamReadyAt: stream.readyAt,
    thumbnailUrl: thumbnail.url,
    thumbnailUploadUrl: thumbnail.uploadUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function toAdminTagClient(row) {
  return {
    id: row.id,
    publicCode: row.public_code,
    label: row.label,
    status: row.status,
    activeEventId: row.active_event_id,
    activeEventName: row.active_event_name,
    createdAt: row.created_at
  };
}

function toAdminWallDeviceClient(row) {
  if (!row) return null;

  return {
    id: row.id,
    eventId: row.event_id || row.eventId,
    eventName: row.event_name || row.eventName,
    name: row.name,
    status: row.status,
    scanPresetId: Number(row.scan_preset_id ?? row.scanPresetId ?? DEFAULT_SCAN_PRESET_ID),
    submissionPresetId: Number(row.submission_preset_id ?? row.submissionPresetId ?? DEFAULT_SUBMISSION_PRESET_ID),
    manualPresetId: Number(row.manual_preset_id ?? row.manualPresetId ?? DEFAULT_MANUAL_PRESET_ID),
    brightness: Number(row.brightness || DEFAULT_LIGHT_BRIGHTNESS),
    lastSeenAt: row.last_seen_at || row.lastSeenAt,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
    pendingTriggerCount: Number(row.pending_trigger_count || row.pendingTriggerCount || 0),
    failedTriggerCount: Number(row.failed_trigger_count || row.failedTriggerCount || 0)
  };
}

async function toSubmissionClient(row, request, env) {
  const mediaToken = await createSignedToken(env, 'media', row.id, MEDIA_TOKEN_TTL_SECONDS);
  const mediaUrl = `${getApiOrigin(request, env)}/moments-api/media/${encodeURIComponent(row.id)}?mediaToken=${encodeURIComponent(mediaToken)}`;
  const thumbnail = await buildThumbnailClient(row, request, env, row.id, row.media_type || row.mediaType, row.thumbnail_object_key || row.thumbnailObjectKey);
  const stream = await buildStreamPlaybackClient(row, request, env, row.id, row.media_type || row.mediaType);
  const guestVisibleAt = row.guest_visible_at || row.guestVisibleAt || '';

  return {
    id: row.id,
    eventId: row.event_id || row.eventId,
    mediaType: row.media_type || row.mediaType,
    source: row.source || 'guest',
    mimeType: row.mime_type || row.mimeType,
    size: row.size,
    durationSeconds: row.duration_seconds || row.durationSeconds || 0,
    guestName: row.guest_name || row.guestName || '',
    guestNote: row.guest_note || row.guestNote || '',
    aiArtworkConsent: Boolean(row.ai_artwork_consent_at || row.aiArtworkConsentAt),
    status: row.status,
    guestVisibleAt,
    guestVisible: Boolean(guestVisibleAt),
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
    mediaUrl,
    downloadUrl: mediaUrl,
    streamUrl: stream.url,
    streamStatus: stream.status,
    streamReadyAt: stream.readyAt,
    thumbnailUrl: thumbnail.url,
    thumbnailUploadUrl: thumbnail.uploadUrl
  };
}

async function toPartyViewSubmissionClient(row, request, env) {
  const submission = await toSubmissionClient(row, request, env);
  const interactions = await getSubmissionInteractions(env, submission.id);
  return {
    id: `party-${submission.id}`,
    eventId: submission.eventId,
    submissionId: submission.id,
    title: submission.guestName ? `Moment from ${submission.guestName}` : 'Guest moment',
    caption: submission.guestNote || '',
    chapter: 'Guest moments',
    capturedAt: submission.createdAt,
    location: '',
    sortOrder: 0,
    isVisible: true,
    mediaType: submission.mediaType,
    source: submission.source || 'guest',
    mimeType: submission.mimeType,
    size: submission.size,
    durationSeconds: submission.durationSeconds,
    interactions,
    guestName: submission.guestName,
    guestNote: submission.guestNote,
    mediaUrl: submission.mediaUrl,
    downloadUrl: submission.downloadUrl,
    streamUrl: submission.streamUrl,
    streamStatus: submission.streamStatus,
    streamReadyAt: submission.streamReadyAt,
    thumbnailUrl: submission.thumbnailUrl,
    thumbnailUploadUrl: submission.thumbnailUploadUrl,
    createdAt: submission.createdAt,
    updatedAt: submission.updatedAt
  };
}

async function buildThumbnailClient(row, request, env, submissionId, mediaType, thumbnailObjectKey) {
  if (mediaType !== 'video') return { url: '', uploadUrl: '' };

  const accessUrl = await buildThumbnailAccessUrl(request, env, submissionId);
  return {
    url: thumbnailObjectKey ? accessUrl : '',
    uploadUrl: thumbnailObjectKey ? '' : accessUrl
  };
}

async function buildThumbnailAccessUrl(request, env, submissionId, ttlSeconds = THUMBNAIL_TOKEN_TTL_SECONDS) {
  const thumbnailToken = await createSignedToken(env, 'thumbnail', submissionId, ttlSeconds);
  return `${getApiOrigin(request, env)}/moments-api/media/${encodeURIComponent(submissionId)}/thumbnail?thumbnailToken=${encodeURIComponent(thumbnailToken)}`;
}

function getApiOrigin(request, env) {
  return (env.MOMENTS_API_URL || new URL(request.url).origin).replace(/\/$/, '');
}

function getSiteUrl(env) {
  return (env.PUBLIC_SITE_URL || PUBLIC_SITE_URL).replace(/\/$/, '');
}

function buildTimeCapsuleShareUrl(env, eventId, shareToken) {
  return `${getSiteUrl(env)}/moments/capsule/?event=${encodeURIComponent(eventId)}#token=${encodeURIComponent(shareToken)}`;
}

function getDisposition(url) {
  return url.searchParams.get('disposition') === 'attachment' ? 'attachment' : 'inline';
}

function downloadFilename(submission) {
  const fallback = `${submission.mediaType || 'moment'}-${submission.id}.${extensionFor(submission.mimeType, submission.originalFilename)}`;
  return sanitizeFilename(submission.originalFilename || fallback);
}

function parseRange(rangeHeader, totalSize) {
  if (!rangeHeader || !totalSize) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) return null;

  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : totalSize - 1;

  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2]);
    start = Math.max(totalSize - suffixLength, 0);
    end = totalSize - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= totalSize) {
    return null;
  }

  end = Math.min(end, totalSize - 1);
  return {
    start,
    end,
    length: end - start + 1
  };
}
