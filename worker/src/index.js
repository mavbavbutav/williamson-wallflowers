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
const VIDEO_MAX_SECONDS = 30;
const UPLOAD_TOKEN_TTL_SECONDS = 12 * 60 * 60;
const MEDIA_TOKEN_TTL_SECONDS = 6 * 60 * 60;
const UPLOAD_RATE_LIMIT = 12;
const UPLOAD_RATE_WINDOW_SECONDS = 60 * 60;
const TAG_RATE_LIMIT = 120;
const TAG_RATE_WINDOW_SECONDS = 60 * 60;
const DEFAULT_EVENT_MAX_SUBMISSIONS = 500;
const DEFAULT_EVENT_MAX_BYTES = 10 * 1024 * 1024 * 1024;
const RETENTION_CLEANUP_LIMIT = 100;
const STANDARD_RETENTION_DAYS = 90;
const TIME_CAPSULE_RETENTION_DAYS = 365;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
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
const PUBLIC_SITE_URL = 'https://williamsonwallflowers.com';

export default {
  async fetch(request, env) {
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
      return handleMomentsApi(request, env, url, corsHeaders);
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

async function handleMomentsApi(request, env, url, corsHeaders) {
  if (!env.MOMENTS_DB || !env.MOMENTS_BUCKET) {
    return json({ ok: false, message: 'Wallflower Moments storage is not configured yet.' }, 503, corsHeaders);
  }

  const parts = url.pathname.split('/').filter(Boolean).slice(1);

  try {
    if (request.method === 'GET' && parts[0] === 'tags' && parts[1]) {
      return getTagEvent(request, parts[1], env, corsHeaders);
    }

    if (request.method === 'POST' && parts[0] === 'events' && parts[1] && parts[2] === 'submissions') {
      return createSubmission(request, env, corsHeaders, parts[1]);
    }

    if (request.method === 'GET' && parts[0] === 'host' && parts[1] === 'events' && parts[2] && parts[3] === 'submissions') {
      return listHostSubmissions(request, env, url, corsHeaders, parts[2]);
    }

    if (parts[0] === 'host' && parts[1] === 'events' && parts[2] && parts[3] === 'time-capsule') {
      if (request.method === 'GET') {
        return getHostTimeCapsule(request, env, url, corsHeaders, parts[2]);
      }

      if (request.method === 'PATCH') {
        return updateHostTimeCapsule(request, env, url, corsHeaders, parts[2]);
      }

      if (request.method === 'POST' && parts[4] === 'items') {
        return createTimeCapsuleItem(request, env, url, corsHeaders, parts[2]);
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
      if (request.method === 'PATCH') {
        return updateHostSubmission(request, env, url, corsHeaders, parts[2]);
      }

      if (request.method === 'DELETE') {
        return deleteHostSubmission(request, env, url, corsHeaders, parts[2]);
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
      hostName: row.hostName
    },
    uploadToken
  }, 200, corsHeaders);
}

async function createSubmission(request, env, corsHeaders, eventId) {
  const event = await getEventById(env, eventId);

  if (!event || !isActiveEvent(event)) {
    return json({ ok: false, message: 'This event is no longer accepting moments.' }, 410, corsHeaders);
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

  if (!consent) {
    return json({ ok: false, message: 'Consent is required before uploading.' }, 400, corsHeaders);
  }

  if (!media || typeof media === 'string' || typeof media.stream !== 'function') {
    return json({ ok: false, message: 'Please upload a photo or video.' }, 400, corsHeaders);
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

  const quotaError = await validateEventQuota(env, eventId, media.size);
  if (quotaError) {
    return json({ ok: false, message: quotaError }, 429, corsHeaders);
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const originalFilename = sanitizeFilename(media.name || `${mediaType}-${id}`);
  const storedMimeType = getStoredMimeType(media.type, originalFilename, mediaType);
  const objectKey = `moments/${eventId}/${id}.${extensionFor(storedMimeType, originalFilename)}`;

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

  await env.MOMENTS_DB.prepare(`
    INSERT INTO submissions (
      id, event_id, media_type, object_key, original_filename, mime_type, size,
      duration_seconds, guest_name, guest_note, consent_at, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).bind(
    id,
    eventId,
    mediaType,
    objectKey,
    originalFilename,
    storedMimeType,
    media.size,
    Number.isFinite(durationSeconds) ? durationSeconds : 0,
    cleanText(formData.get('guestName'), 90),
    cleanText(formData.get('guestNote'), 220),
    now,
    now,
    now
  ).run();

  return json({
    ok: true,
    submission: {
      id,
      status: 'pending'
    }
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

  return json({
    ok: true,
    event: toEventClient(event, env),
    submissions: await Promise.all((result.results || []).map((row) => toSubmissionClient(row, request, env)))
  }, 200, corsHeaders);
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

  if (status === 'published') {
    const visibleItems = await getTimeCapsuleItems(env, event.record.id, request, { visibleOnly: true });
    if (!visibleItems.length) {
      return json({ ok: false, message: 'Add at least one visible approved moment before publishing.' }, 400, corsHeaders);
    }
  }

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

async function createTimeCapsuleItem(request, env, url, corsHeaders, eventId) {
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

async function updateHostSubmission(request, env, url, corsHeaders, submissionId) {
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
    SET status = ?, updated_at = ?
    WHERE id = ? AND deleted_at IS NULL
  `).bind(status, now, submissionId).run();

  return json({ ok: true, status }, 200, corsHeaders);
}

async function deleteHostSubmission(request, env, url, corsHeaders, submissionId) {
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
  } catch (error) {
    console.error('R2 delete failed for host-deleted submission', submissionId, error);
  }

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

  if (parsedRange) {
    headers.set('Content-Range', `bytes ${parsedRange.start}-${parsedRange.end}/${totalSize}`);
    headers.set('Content-Length', String(parsedRange.length));
    return new Response(isHeadRequest ? null : object.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(totalSize || object.size || 0));
  return new Response(isHeadRequest ? null : object.body, { status: 200, headers });
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

  if (request.method === 'POST' && parts[0] === 'events') {
    return createAdminEvent(request, env, corsHeaders);
  }

  if (request.method === 'PATCH' && parts[0] === 'events' && parts[1]) {
    return updateAdminEvent(request, env, corsHeaders, parts[1]);
  }

  if (request.method === 'POST' && parts[0] === 'tags') {
    return createAdminTag(request, env, corsHeaders);
  }

  if (request.method === 'PATCH' && parts[0] === 'tags' && parts[1]) {
    return updateAdminTag(request, env, corsHeaders, parts[1]);
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

  const stats = await env.MOMENTS_DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM events) AS events,
      (SELECT COUNT(*) FROM tags) AS tags,
      (SELECT COUNT(*) FROM submissions WHERE status = 'pending' AND deleted_at IS NULL) AS pending,
      (SELECT COUNT(*) FROM submissions WHERE status = 'approved' AND deleted_at IS NULL) AS approved
  `).first();

  return json({
    ok: true,
    stats,
    events: (eventsResult.results || []).map((row) => toAdminEventClient(row, env)),
    tags: (tagsResult.results || []).map((row) => toAdminTagClient(row)),
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

async function cleanExpiredMedia(env, limit = RETENTION_CLEANUP_LIMIT) {
  const now = new Date().toISOString();
  const result = await env.MOMENTS_DB.prepare(`
    SELECT s.id, s.object_key AS objectKey
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
    'draft',
    timeCapsuleTitle,
    timeCapsuleShareToken,
    null
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
      timeCapsuleStatus: 'draft',
      timeCapsuleTitle,
      timeCapsuleShareToken,
      timeCapsulePublishedAt: null,
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
    timeCapsuleStatus: body.timeCapsuleStatus === undefined ? current.timeCapsuleStatus : normalizeStatus(body.timeCapsuleStatus, ['draft', 'published']),
    timeCapsuleTitle: body.timeCapsuleTitle === undefined ? current.timeCapsuleTitle : cleanText(body.timeCapsuleTitle, 140),
    timeCapsuleShareToken: nextTimeCapsuleShareToken,
    timeCapsulePublishedAt: body.timeCapsuleStatus === 'published'
      ? (current.timeCapsulePublishedAt || new Date().toISOString())
      : (body.timeCapsuleStatus === 'draft' || !nextTimeCapsuleEnabled ? null : current.timeCapsulePublishedAt)
  };

  if (!next.name) {
    return json({ ok: false, message: 'Event name is required.' }, 400, corsHeaders);
  }

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
    next.timeCapsuleTitle || (next.timeCapsuleEnabled ? `${next.name} Time Capsule` : null),
    next.timeCapsuleShareToken,
    next.timeCapsulePublishedAt,
    new Date().toISOString(),
    eventId
  ).run();

  return json({ ok: true, event: { id: eventId, ...next } }, 200, corsHeaders);
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

function sendEmail({ env, to, subject, text }) {
  const resendApiKey = env.resend || env.RESEND_API_KEY || env.RESEND;

  if (!resendApiKey || !env.FROM_EMAIL) {
    throw new Error('Missing resend, RESEND_API_KEY, RESEND, or FROM_EMAIL.');
  }

  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: [to],
      subject,
      text
    })
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
      s.mime_type AS mimeType,
      s.size,
      s.duration_seconds AS durationSeconds,
      s.guest_name AS guestName,
      s.guest_note AS guestNote,
      s.status AS submissionStatus,
      s.deleted_at AS deletedAt,
      s.created_at AS submissionCreatedAt,
      s.updated_at AS submissionUpdatedAt
    FROM time_capsule_items i
    INNER JOIN submissions s ON s.id = i.submission_id
    WHERE i.event_id = ? AND s.status = 'approved' AND s.deleted_at IS NULL ${visibilityFilter}
    ORDER BY i.sort_order ASC, i.created_at ASC
  `).bind(eventId).all();

  return Promise.all((result.results || []).map((row) => toTimeCapsuleItemClient(row, request, env)));
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
      s.mime_type AS mimeType,
      s.size,
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
      s.object_key AS objectKey,
      s.original_filename AS originalFilename,
      s.mime_type AS mimeType,
      s.size,
      s.duration_seconds AS durationSeconds,
      s.guest_name AS guestName,
      s.guest_note AS guestNote,
      s.consent_at AS consentAt,
      s.status,
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
  if (requested === 'photo' || requested === 'video') return requested;
  const baseMimeType = getBaseMimeType(mimeType);
  if (baseMimeType.startsWith('image/')) return 'photo';
  if (baseMimeType.startsWith('video/')) return 'video';
  if (VIDEO_EXTENSIONS.has(getFileExtension(filename))) return 'video';
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

  return 'Please upload a photo or video.';
}

function isAllowedMobileVideo(media) {
  const baseMimeType = getBaseMimeType(media.type);
  const extension = getFileExtension(media.name);

  if (VIDEO_TYPES.has(baseMimeType)) return true;
  if (baseMimeType.startsWith('video/') && VIDEO_EXTENSIONS.has(extension)) return true;
  if ((!baseMimeType || baseMimeType === 'application/octet-stream') && VIDEO_EXTENSIONS.has(extension)) return true;

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
    'video/h264': 'mp4'
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
    '3g2': 'video/3gpp2'
  };

  return byExtension[extension] || (mediaType === 'video' ? 'video/mp4' : 'application/octet-stream');
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

function toEventClient(row, env) {
  return {
    id: row.id,
    name: row.name,
    eventDate: row.eventDate,
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
    mimeType: row.mimeType,
    size: row.size,
    durationSeconds: row.durationSeconds,
    guestName: row.guestName || '',
    guestNote: row.guestNote || '',
    mediaUrl,
    downloadUrl: mediaUrl,
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

async function toSubmissionClient(row, request, env) {
  const mediaToken = await createSignedToken(env, 'media', row.id, MEDIA_TOKEN_TTL_SECONDS);
  const mediaUrl = `${getApiOrigin(request, env)}/moments-api/media/${encodeURIComponent(row.id)}?mediaToken=${encodeURIComponent(mediaToken)}`;

  return {
    id: row.id,
    eventId: row.event_id,
    mediaType: row.media_type,
    mimeType: row.mime_type,
    size: row.size,
    durationSeconds: row.duration_seconds,
    guestName: row.guest_name,
    guestNote: row.guest_note,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    mediaUrl,
    downloadUrl: mediaUrl
  };
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
