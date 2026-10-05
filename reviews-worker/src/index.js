const MAPS_URL = 'https://www.google.com/maps/place/Williamson+Wallflowers/data=!4m2!3m1!1s0x2311120effec6b11:0x7688aa111b7e9329';
const RATINGS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export function normalizeReviews(data, now = new Date()) {
  if (data.totalReviewCount === 0) data = { ...data, reviews: data.reviews || [], averageRating: 0 };
  if (!Array.isArray(data.reviews) || !Number.isInteger(data.totalReviewCount) || data.totalReviewCount < data.reviews.length
      || !Number.isFinite(data.averageRating) || (data.averageRating < 1 && data.totalReviewCount !== 0) || data.averageRating > 5) throw new Error('Invalid Google response');
  const reviews = data.reviews.map(review => {
    if (!review.reviewId || !RATINGS[review.starRating]) throw new Error('Invalid Google review');
    return {
      id: review.reviewId,
      author: review.reviewer?.displayName || 'Google reviewer',
      text: review.comment || '',
      rating: RATINGS[review.starRating],
      createdAt: review.createTime || '',
      updatedAt: review.updateTime || ''
    };
  });
  return { source: 'google-business-profile', fetchedAt: now.toISOString(), mapsUrl: MAPS_URL,
    averageRating: data.averageRating, totalReviewCount: data.totalReviewCount, reviews };
}

export async function loadReviews(env, request = fetch) {
  const tokenResponse = await request('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(8000)
  });
  if (!tokenResponse.ok) throw new Error(`Google authorization failed (${tokenResponse.status})`);
  const token = await tokenResponse.json();
  if (!token.access_token) throw new Error('Google authorization returned no access token');
  const url = `https://mybusiness.googleapis.com/v4/${env.GOOGLE_LOCATION_NAME}/reviews?pageSize=50&orderBy=updateTime%20desc`;
  const response = await request(url, { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Google reviews unavailable (${response.status})`);
  return normalizeReviews(await response.json());
}

export function configured(env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN
    && /^accounts\/[\w-]+\/locations\/[\w-]+$/.test(env.GOOGLE_LOCATION_NAME || ''));
}

export async function handleRequest(request, env, ctx, cache, upstream = fetch) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',');
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Vary': 'Origin', 'Cache-Control': 'no-store' };
  if (origin && !allowed.includes(origin)) return new Response('Forbidden', { status: 403, headers });
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
  if (url.pathname !== '/reviews') return new Response('Not found', { status: 404, headers });
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { ...headers, Allow: 'GET, OPTIONS' } });
  if (!configured(env)) return new Response(JSON.stringify({ error: 'Reviews connection not configured' }), { status: 503, headers });
  // One canonical cache entry per edge location; query strings cannot force a refresh.
  const cacheKey = new Request(`${url.origin}/reviews`);
  const cached = await cache.match(cacheKey);
  if (cached) return new Response(cached.body, { headers: { ...headers, 'Cache-Control': 'public, max-age=300' } });
  try {
    const feed = await loadReviews(env, upstream);
    const body = JSON.stringify(feed);
    ctx.waitUntil(cache.put(cacheKey, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } })));
    return new Response(body, { headers: { ...headers, 'Cache-Control': 'public, max-age=300' } });
  } catch (error) {
    // Never log tokens or Google's raw response, or return them to a visitor.
    console.error(error.message);
    return new Response(JSON.stringify({ error: 'Reviews temporarily unavailable' }), { status: 502, headers });
  }
}

export default { fetch: (request, env, ctx) => handleRequest(request, env, ctx, caches.default) };
