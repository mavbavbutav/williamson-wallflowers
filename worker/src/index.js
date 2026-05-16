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

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = getCorsHeaders(origin, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return json({ ok: false, message: 'Method not allowed.' }, 405, corsHeaders);
    }

    if (!isAllowedOrigin(origin, env)) {
      return json({ ok: false, message: 'This inquiry cannot be submitted from that origin.' }, 403, corsHeaders);
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
};

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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
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

function json(payload, status, headers) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}
