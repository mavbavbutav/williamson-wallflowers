const FIELD_LABELS = [
  ['name', 'Name'],
  ['email', 'Email'],
  ['event-date', 'Event Date'],
  ['event-type', 'Event Type'],
  ['venue', 'Venue / Location'],
  ['preferred-wall', 'Preferred Wall'],
  ['details', 'Event Details']
];

const REQUIRED_FIELDS = ['name', 'email'];
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const VIDEO_MAX_SECONDS = 30;
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
      return getTagEvent(parts[1], env, corsHeaders);
    }

    if (request.method === 'POST' && parts[0] === 'events' && parts[1] && parts[2] === 'submissions') {
      return createSubmission(request, env, corsHeaders, parts[1]);
    }

    if (request.method === 'GET' && parts[0] === 'host' && parts[1] === 'events' && parts[2] && parts[3] === 'submissions') {
      return listHostSubmissions(request, env, url, corsHeaders, parts[2]);
    }

    if (parts[0] === 'host' && parts[1] === 'submissions' && parts[2]) {
      if (request.method === 'PATCH') {
        return updateHostSubmission(request, env, url, corsHeaders, parts[2]);
      }

      if (request.method === 'DELETE') {
        return deleteHostSubmission(env, url, corsHeaders, parts[2]);
      }
    }

    if (request.method === 'GET' && parts[0] === 'media' && parts[1]) {
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

async function getTagEvent(tagCode, env, corsHeaders) {
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
    }
  }, 200, corsHeaders);
}

async function createSubmission(request, env, corsHeaders, eventId) {
  const event = await getEventById(env, eventId);

  if (!event || !isActiveEvent(event)) {
    return json({ ok: false, message: 'This event is no longer accepting moments.' }, 410, corsHeaders);
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return json({ ok: false, message: 'Upload must use multipart form data.' }, 415, corsHeaders);
  }

  const formData = await request.formData();
  const media = formData.get('media');
  const consent = String(formData.get('consent') || '').toLowerCase() === 'true';

  if (!consent) {
    return json({ ok: false, message: 'Consent is required before uploading.' }, 400, corsHeaders);
  }

  if (!media || typeof media === 'string' || typeof media.stream !== 'function') {
    return json({ ok: false, message: 'Please upload a photo or video.' }, 400, corsHeaders);
  }

  const mediaType = normalizeMediaType(formData.get('mediaType'), media.type, media.name);
  const durationSeconds = Number(formData.get('durationSeconds') || 0);
  const validationError = validateMedia(media, mediaType, durationSeconds);

  if (validationError) {
    return json({ ok: false, message: validationError }, 400, corsHeaders);
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
  const token = url.searchParams.get('token') || '';
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
    event: toEventClient(event),
    submissions: (result.results || []).map((row) => toSubmissionClient(row, request, env, token))
  }, 200, corsHeaders);
}

async function updateHostSubmission(request, env, url, corsHeaders, submissionId) {
  const token = url.searchParams.get('token') || '';
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

async function deleteHostSubmission(env, url, corsHeaders, submissionId) {
  const token = url.searchParams.get('token') || '';
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

  return json({ ok: true, status: 'deleted' }, 200, corsHeaders);
}

async function streamMedia(request, env, url, corsHeaders, submissionId) {
  const token = url.searchParams.get('token') || '';
  const submission = await getSubmissionWithEvent(env, submissionId);

  if (!submission || submission.deletedAt || submission.status === 'deleted') {
    return json({ ok: false, message: 'Media not found.' }, 404, corsHeaders);
  }

  if (!isAuthorizedForSubmission(submission, token, env)) {
    return json({ ok: false, message: 'This media link is not valid.' }, 403, corsHeaders);
  }

  const totalSize = Number(submission.size || 0);
  const parsedRange = parseRange(request.headers.get('Range'), totalSize);
  const object = await env.MOMENTS_BUCKET.get(
    submission.objectKey,
    parsedRange ? { range: { offset: parsedRange.start, length: parsedRange.length } } : undefined
  );

  if (!object) {
    return json({ ok: false, message: 'Media file is missing from storage.' }, 404, corsHeaders);
  }

  const headers = new Headers(corsHeaders);
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', submission.mimeType);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'private, max-age=60');
  headers.set('ETag', object.httpEtag || object.etag);
  headers.set('Content-Disposition', `${getDisposition(url)}; filename="${downloadFilename(submission)}"`);

  if (parsedRange) {
    headers.set('Content-Range', `bytes ${parsedRange.start}-${parsedRange.end}/${totalSize}`);
    headers.set('Content-Length', String(parsedRange.length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(totalSize || object.size || 0));
  return new Response(object.body, { status: 200, headers });
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

async function createAdminEvent(request, env, corsHeaders) {
  const body = await request.json();
  const name = cleanText(body.name, 120);

  if (!name) {
    return json({ ok: false, message: 'Event name is required.' }, 400, corsHeaders);
  }

  const now = new Date().toISOString();
  const eventDate = cleanText(body.eventDate, 20);
  const id = crypto.randomUUID();
  const hostToken = randomToken();
  const adminToken = randomToken();
  const retentionExpiresAt = getRetentionExpiresAt(eventDate);

  await env.MOMENTS_DB.prepare(`
    INSERT INTO events (
      id, name, event_date, host_name, host_email, host_token, admin_token,
      status, retention_expires_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
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
    now
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
      hostUrl: `${getSiteUrl(env)}/moments/host/?event=${encodeURIComponent(id)}&token=${encodeURIComponent(hostToken)}`
    }
  }, 201, corsHeaders);
}

async function updateAdminEvent(request, env, corsHeaders, eventId) {
  const current = await getEventById(env, eventId);
  if (!current) return json({ ok: false, message: 'Event not found.' }, 404, corsHeaders);

  const body = await request.json();
  const nextEventDate = body.eventDate === undefined ? current.eventDate : cleanText(body.eventDate, 20);
  const next = {
    name: body.name === undefined ? current.name : cleanText(body.name, 120),
    eventDate: nextEventDate || null,
    hostName: body.hostName === undefined ? current.hostName : cleanText(body.hostName, 90),
    hostEmail: body.hostEmail === undefined ? current.hostEmail : cleanText(body.hostEmail, 140),
    status: body.status === undefined ? current.status : normalizeStatus(body.status, ['active', 'inactive', 'archived']),
    retentionExpiresAt: body.retentionExpiresAt || (body.eventDate === undefined ? current.retentionExpiresAt : getRetentionExpiresAt(nextEventDate))
  };

  if (!next.name) {
    return json({ ok: false, message: 'Event name is required.' }, 400, corsHeaders);
  }

  await env.MOMENTS_DB.prepare(`
    UPDATE events
    SET name = ?, event_date = ?, host_name = ?, host_email = ?, status = ?, retention_expires_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    next.name,
    next.eventDate,
    next.hostName,
    next.hostEmail,
    next.status,
    next.retentionExpiresAt,
    new Date().toISOString(),
    eventId
  ).run();

  return json({ ok: true, event: { id: eventId, ...next } }, 200, corsHeaders);
}

async function createAdminTag(request, env, corsHeaders) {
  const body = await request.json();
  const publicCode = normalizeTagCode(body.publicCode);
  const label = cleanText(body.label, 100);

  if (!publicCode || !label) {
    return json({ ok: false, message: 'Public tag code and label are required.' }, 400, corsHeaders);
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
    'Vary': 'Origin'
  };
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
    .map(([key, label]) => `${label}: ${submission[key]}`)
    .join('\n\n');
}

function buildApplicantConfirmation(submission) {
  return `Hi ${getFirstName(submission.name)},

Thanks for reaching out to Williamson Wallflowers.

We received your event inquiry and Jami will review the details soon.

Quick summary:
Event Date: ${submission['event-date'] || 'Not provided'}
Event Type: ${submission['event-type'] || 'Not provided'}
Venue / Location: ${submission.venue || 'Not provided'}
Preferred Wall: ${submission['preferred-wall'] || 'Not provided'}

Williamson Wallflowers
Luxury flower wall rentals for Nashville, Williamson County, and Middle Tennessee
jamicarswell@gmail.com`;
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
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM events
    WHERE id = ? AND host_token = ?
  `).bind(eventId, token).first();

  return row || null;
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

function randomToken(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function getRetentionExpiresAt(eventDate) {
  const base = eventDate ? new Date(`${eventDate}T23:59:59Z`) : new Date();
  if (Number.isNaN(base.getTime())) base.setTime(Date.now());
  base.setUTCDate(base.getUTCDate() + 90);
  return base.toISOString();
}

function toEventClient(row) {
  return {
    id: row.id,
    name: row.name,
    eventDate: row.eventDate,
    hostName: row.hostName,
    status: row.status,
    retentionExpiresAt: row.retentionExpiresAt
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
    pendingCount: row.pending_count,
    approvedCount: row.approved_count,
    rejectedCount: row.rejected_count,
    hostUrl: `${getSiteUrl(env)}/moments/host/?event=${encodeURIComponent(row.id)}&token=${encodeURIComponent(row.host_token)}`
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

function toSubmissionClient(row, request, env, token) {
  const mediaUrl = `${getApiOrigin(request, env)}/moments-api/media/${encodeURIComponent(row.id)}?token=${encodeURIComponent(token)}`;

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
