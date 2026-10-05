import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const feed = JSON.parse(readFileSync(new URL('../assets/reviews-public.json', import.meta.url), 'utf8'));
assert.equal(feed.source, 'google-public-snapshot');
assert.equal(feed.complete, true);
assert.ok(Number.isInteger(feed.totalReviewCount) && feed.totalReviewCount >= 0);
assert.equal(feed.reviews.length, feed.totalReviewCount);
assert.ok(feed.reviews.length <= 50);
assert.ok(Number.isFinite(feed.averageRating) && feed.averageRating >= (feed.totalReviewCount ? 1 : 0) && feed.averageRating <= 5);
assert.ok(Number.isFinite(Date.parse(feed.fetchedAt)) && Date.parse(feed.fetchedAt) <= Date.now() + 60000);
assert.ok(feed.mapsUrl.startsWith('https://www.google.com/maps/place/Williamson+Wallflowers/'));
assert.equal(new Set(feed.reviews.map(r => r.id)).size, feed.reviews.length);
for (const review of feed.reviews) {
  assert.ok(typeof review.id === 'string' && review.id.startsWith('public-'));
  assert.ok(typeof review.author === 'string' && review.author.trim());
  assert.ok(Number.isInteger(review.rating) && review.rating >= 1 && review.rating <= 5);
  assert.equal(typeof review.text, 'string');
  assert.ok(review.text.trim().split(/\s+/).length <= 25, `${review.author}: excerpt must be at most 25 words`);
  assert.equal(review.excerpt, true);
  assert.equal(review.createdAt, '', 'Do not infer exact dates from relative Google labels');
}
console.log(`Validated ${feed.reviews.length} public Google review excerpts; checked ${feed.fetchedAt}`);
