const MAX_AGE = 7 * 86400000;
export function validSnapshot(feed, now = Date.now()) {
  if (!feed || feed.source !== 'google-public-snapshot' || feed.complete !== true ||
      !Number.isInteger(feed.totalReviewCount) || feed.totalReviewCount < 0 || feed.totalReviewCount > 50 ||
      !Array.isArray(feed.reviews) || feed.reviews.length !== feed.totalReviewCount ||
      !Number.isFinite(feed.averageRating) || feed.averageRating < (feed.totalReviewCount ? 1 : 0) || feed.averageRating > 5 ||
      typeof feed.mapsUrl !== 'string' || !feed.mapsUrl.startsWith('https://www.google.com/maps/place/Williamson+Wallflowers/')) return false;
  const checked = Date.parse(feed.fetchedAt);
  if (!Number.isFinite(checked) || checked > now + 60000 || now - checked >= MAX_AGE) return false;
  const ids = new Set();
  return feed.reviews.every(r => {
    if (!r || typeof r.id !== 'string' || !r.id.startsWith('public-') || ids.has(r.id) ||
        typeof r.author !== 'string' || !r.author.trim() || !Number.isInteger(r.rating) || r.rating < 1 || r.rating > 5 ||
        typeof r.text !== 'string' || r.text.trim().split(/\s+/).length > 25 || r.excerpt !== true || r.createdAt !== '') return false;
    ids.add(r.id); return true;
  });
}

if (typeof document !== 'undefined') {
  const section = document.querySelector('.testimonial-loop[data-reviews-endpoint]');
  const track = section?.querySelector('.review-loop-track');
  if (track) {
    const original = track.querySelector('.review-loop-group').cloneNode(true);
    const summary = document.createElement('p');
    summary.className = 'reviews-summary'; summary.hidden = true;
    section.querySelector('.testimonial-loop-heading > div').append(summary);
    let applied = null, pending = null, busy = false;
    const interacting = () => section.matches(':hover') || section.contains(document.activeElement) || section.classList.contains('is-paused');
    function replace(group) {
      const copy = group.cloneNode(true);
      copy.classList.add('review-loop-copy'); copy.setAttribute('aria-hidden','true'); copy.inert = true;
      track.replaceChildren(group, copy);
    }
    function apply(feed) {
      const group = original.cloneNode(true);
      // Keep the separately attributed Facebook recommendation; replace only Google cards.
      group.querySelectorAll('.scroll-review').forEach(card => {
        if (card.querySelector('a[href^="https://www.google.com/maps/"]')) card.remove();
      });
      for (const review of feed.reviews) {
        const card = document.createElement('article'); card.className = 'scroll-review';
        const stars = document.createElement('div'); stars.className = 'scroll-stars';
        stars.textContent = '★'.repeat(review.rating) + '☆'.repeat(5-review.rating);
        stars.setAttribute('aria-label',`${review.rating} out of 5 stars`);
        const quote = document.createElement('blockquote'); quote.textContent = review.text ? `“${review.text}”` : 'Rating only — no written review.';
        const author = document.createElement('p'); author.className = 'scroll-review-author'; author.textContent = review.author;
        const link = document.createElement('a'); link.href = feed.mapsUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Google review excerpt ↗';
        card.append(stars,quote,author,link); group.append(card);
      }
      replace(group);
      summary.textContent = `${feed.averageRating.toFixed(1)} on Google · ${feed.totalReviewCount} reviews · Checked ${new Date(feed.fetchedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'America/Chicago'})}`;
      summary.hidden = false; applied = feed;
    }
    function reconcile() {
      if (interacting()) return;
      if (pending && validSnapshot(pending)) { apply(pending); pending = null; }
      if (applied && !validSnapshot(applied)) { replace(original.cloneNode(true)); summary.hidden = true; applied = null; }
    }
    async function refresh() {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const response = await fetch(section.dataset.reviewsEndpoint,{cache:'no-cache',credentials:'omit',signal:AbortSignal.timeout(8000)});
        if (!response.ok) throw new Error('Review feed unavailable');
        const feed = await response.json();
        if (validSnapshot(feed) && JSON.stringify(feed) !== JSON.stringify(applied)) pending = feed;
      } catch { /* Keep attributed fallback excerpts; never invent fresh data. */ }
      finally { busy = false; reconcile(); }
    }
    section.addEventListener('pointerleave',reconcile);
    section.addEventListener('focusout',()=>setTimeout(reconcile,0));
    section.querySelector('.review-loop-toggle')?.addEventListener('click',()=>setTimeout(reconcile,0));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
    setInterval(refresh,300000); refresh();
  }
}

