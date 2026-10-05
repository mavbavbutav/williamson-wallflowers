import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReviews, loadReviews, handleRequest } from '../src/index.js';
const data = { averageRating: 4, totalReviewCount: 2, reviews: [
  { reviewId: 'a', starRating: 'THREE', reviewer: { displayName: 'Example customer' }, comment: '<script>Not HTML</script>', createTime: '2026-10-01T00:00:00Z' },
  { reviewId: 'b', starRating: 'FIVE', reviewer: { isAnonymous: true } }
] };
const env = { GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', GOOGLE_REFRESH_TOKEN: 'test-refresh', GOOGLE_LOCATION_NAME: 'accounts/123/locations/456', ALLOWED_ORIGINS: 'https://williamsonwallflowers.com' };
test('preserves exact prose, lower ratings and rating-only reviews; no invented service label', () => {
  const feed = normalizeReviews(data);
  assert.equal(feed.reviews[0].text, data.reviews[0].comment);
  assert.equal(feed.reviews[0].rating, 3);
  assert.equal(feed.reviews[1].text, '');
  assert.equal(feed.reviews[1].author, 'Google reviewer');
  assert.equal(feed.averageRating, 4);
  assert.equal(JSON.stringify(feed).includes('test-secret'), false);
});
test('rejects malformed Google data', () => {
  assert.throws(() => normalizeReviews({ ...data, averageRating: undefined }));
  assert.throws(() => normalizeReviews({ ...data, reviews: [{ reviewId: 'a', starRating: 'BAD' }] }));
});
test('a business with no remaining reviews returns an empty feed', () => {
  const feed = normalizeReviews({ totalReviewCount: 0 });
  assert.deepEqual(feed.reviews, []);
  assert.equal(feed.averageRating, 0);
});
test('OAuth token stays server-side and requests newest updates without rating filtering', async () => {
  const calls = [];
  const feed = await loadReviews(env, async (url, options) => {
    calls.push({ url, options });
    return Response.json(calls.length === 1 ? { access_token: 'private-access-token' } : data);
  });
  assert.match(calls[1].url, /pageSize=50&orderBy=updateTime%20desc/);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer private-access-token');
  assert.equal(JSON.stringify(feed).includes('private-access-token'), false);
});
test('authorization failure never tries reviews endpoint', async () => {
  let calls = 0;
  await assert.rejects(loadReviews(env, async () => { calls++; return new Response('', { status: 401 }); }));
  assert.equal(calls, 1);
});
test('unconfigured source returns 503 without upstream request', async () => {
  const response = await handleRequest(new Request('https://example.com/reviews'), {}, {}, {});
  assert.equal(response.status, 503);
});
test('unknown origins and write methods are rejected', async () => {
  const denied = await handleRequest(new Request('https://example.com/reviews', { headers: { Origin: 'https://other.test' } }), env, {}, {});
  assert.equal(denied.status, 403);
  const post = await handleRequest(new Request('https://example.com/reviews', { method: 'POST' }), env, {}, {});
  assert.equal(post.status, 405);
});
test('cached feed uses canonical key and correct current CORS origin', async () => {
  const response = await handleRequest(new Request('https://example.com/reviews?force=1', { headers: { Origin: 'https://williamsonwallflowers.com' } }), env, {}, {
    match: async key => { assert.equal(key.url, 'https://example.com/reviews'); return Response.json(normalizeReviews(data)); }
  }, () => { throw new Error('Should not fetch'); });
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://williamsonwallflowers.com');
  assert.equal((await response.json()).reviews.length, 2);
});
test('successful refresh caches for only one hour and strips secrets', async () => {
  const writes = []; let calls = 0;
  const response = await handleRequest(new Request('https://example.com/reviews'), env, { waitUntil: promise => writes.push(promise) }, {
    match: async () => undefined,
    put: async (key, value) => { assert.equal(value.headers.get('Cache-Control'), 'public, max-age=3600'); }
  }, async () => Response.json(++calls === 1 ? { access_token: 'private' } : data));
  await Promise.all(writes);
  assert.equal(response.status, 200);
  assert.equal((await response.text()).includes('private'), false);
});
