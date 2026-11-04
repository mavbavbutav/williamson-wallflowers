import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import worker from '../src/index.js';

const ORIGIN = 'https://williamsonwallflowers.com';
const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

function inquiryRequest(fields) {
  return new Request('https://inquiry.example.workers.dev/', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.10' },
    body: new URLSearchParams(fields)
  });
}

function inquiryEnv() {
  return {
    ALLOWED_ORIGINS: ORIGIN,
    TURNSTILE_SECRET_KEY: 'test-secret',
    resend: 'test-resend-key',
    FROM_EMAIL: 'Williamson Wallflowers <noreply@example.com>',
    TO_EMAIL: 'owner@example.com'
  };
}

function validTurnstileAndEmailFetch(calls) {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/turnstile/v0/siteverify')) {
      return Response.json({ success: true, hostname: 'williamsonwallflowers.com', action: 'inquiry' });
    }
    if (String(url) === 'https://api.resend.com/emails') return Response.json({ id: 'email-test' });
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

test('rejects the November 4 suspicious inquiry date before any external calls', async () => {
  const calls = [];
  validTurnstileAndEmailFetch(calls);
  const response = await worker.fetch(inquiryRequest({
    name: 'Taylor Example',
    email: 'taylor@example.com',
    'event-date': '1987-07-06',
    venue: 'Georgia',
    details: 'Unrelated message in another language',
    'cf-turnstile-response': 'valid-test-token'
  }), inquiryEnv(), {});

  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /today or a future event date/);
  assert.equal(calls.length, 0);
});

test('accepts a future event with ordinary multilingual details and an out-of-area venue', async () => {
  const calls = [];
  validTurnstileAndEmailFetch(calls);
  const response = await worker.fetch(inquiryRequest({
    name: 'María García',
    email: 'maria.garcia@example.com',
    'event-date': '2027-06-12',
    'event-type': 'Wedding',
    venue: 'The Garden House, Savannah, Georgia',
    'preferred-wall': 'The Secret Garden',
    details: 'Hola Jami, nos gustaría saber si la pared floral está disponible. We expect about 70 guests.',
    'cf-turnstile-response': 'valid-test-token'
  }), inquiryEnv(), {});

  assert.equal(response.status, 200);
  assert.equal((await response.json()).message, 'Inquiry sent.');
  assert.equal(calls.filter((call) => call.url === 'https://api.resend.com/emails').length, 2);
});

test('allows a general inquiry when no event date is known yet', async () => {
  const calls = [];
  validTurnstileAndEmailFetch(calls);
  const response = await worker.fetch(inquiryRequest({
    name: 'Jordan Lee',
    email: 'jordan@example.com',
    'event-date': '',
    details: 'We are still choosing a date and would like pricing for a flower wall and 20 chairs.',
    'cf-turnstile-response': 'valid-test-token'
  }), inquiryEnv(), {});

  assert.equal(response.status, 200);
});

test('rejects impossible and malformed event dates', async () => {
  for (const eventDate of ['2027-02-30', '07/06/1987', '1987-7-6']) {
    const response = await worker.fetch(inquiryRequest({
      name: 'Taylor Example', email: 'taylor@example.com', 'event-date': eventDate,
      'cf-turnstile-response': 'valid-test-token'
    }), inquiryEnv(), {});
    assert.equal(response.status, 400, eventDate);
  }
});

test('requires a valid, single-use Turnstile verification before sending email', async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    return Response.json({ success: false, 'error-codes': ['invalid-input-response'] });
  };
  const response = await worker.fetch(inquiryRequest({
    name: 'Jordan Lee', email: 'jordan@example.com', 'event-date': '2027-02-30',
    'cf-turnstile-response': 'forged-token'
  }), inquiryEnv(), {});
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0, 'date validation runs before calling Siteverify');

  const validDateResponse = await worker.fetch(inquiryRequest({
    name: 'Jordan Lee', email: 'jordan@example.com', 'event-date': '2027-02-14',
    'cf-turnstile-response': 'forged-token'
  }), inquiryEnv(), {});
  assert.equal(validDateResponse.status, 400);
  assert.ok(calls.some((url) => url.includes('/turnstile/v0/siteverify')));
  assert.equal(calls.some((url) => url === 'https://api.resend.com/emails'), false);
});

test('rejects a submission without a Turnstile token', async () => {
  const calls = [];
  validTurnstileAndEmailFetch(calls);
  const response = await worker.fetch(inquiryRequest({
    name: 'Jordan Lee', email: 'jordan@example.com', 'event-date': '2027-02-14'
  }), inquiryEnv(), {});
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /complete the spam check/);
  assert.equal(calls.length, 0);
});

test('rate limits repeated submissions per edge IP before Turnstile or email calls', async () => {
  const calls = [];
  validTurnstileAndEmailFetch(calls);
  const env = inquiryEnv();
  env.INQUIRY_RATE_LIMITER = { limit: async ({ key }) => {
    assert.equal(key, '203.0.113.10');
    return { success: false };
  } };

  const response = await worker.fetch(inquiryRequest({
    name: 'Jordan Lee', email: 'jordan@example.com', 'event-date': '2027-02-14',
    'cf-turnstile-response': 'valid-test-token'
  }), env, {});

  assert.equal(response.status, 429);
  assert.equal(calls.length, 0);
});

test('form renders Turnstile and tells the visitor when the token is missing', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /class="cf-turnstile" data-sitekey="[^"]+" data-action="inquiry"/);
  assert.match(html, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/);
  assert.match(html, /Please complete the spam check before sending your inquiry/);
});
