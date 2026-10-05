(() => {
  'use strict';
  const section = document.querySelector('#reviews');
  if (!section) return;
  const carousel = section.querySelector('.reviews-carousel');
  const stage = section.querySelector('.reviews-stage');
  const controls = section.querySelector('.reviews-controls');
  const toggle = controls.querySelector('[data-review-action="toggle"]');
  const position = controls.querySelector('.reviews-position');
  const announcement = section.querySelector('.reviews-announcement');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let cards = [...stage.children];
  let index = 0, paused = reduced.matches, hovered = false, visible = false, timer;
  let pendingFeed, appliedFeed, appliedAt = 0, appliedLifetime = 86400000, pointerPaused;
  const originalCards = cards.map(card => card.cloneNode(true));
  const originalDescription = section.querySelector('#reviews-description').textContent;

  function schedule() {
    clearTimeout(timer);
    if (paused || hovered || !visible || document.hidden || cards.length < 2) return;
    // Allow enough time to read; longer reviews get proportionally longer dwell time.
    const words = cards[index].querySelector('blockquote').textContent.split(/\s+/).length;
    timer = setTimeout(() => show(index + 1), Math.max(9000, Math.min(30000, words * 300)));
  }
  function show(next, manual = false) {
    if (!cards.length) { clearTimeout(timer); return; }
    index = (next + cards.length) % cards.length;
    cards.forEach((card, i) => {
      card.classList.toggle('is-active', i === index);
      card.inert = i !== index;
      card.setAttribute('aria-hidden', String(i !== index));
      card.setAttribute('role', 'group');
      card.setAttribute('aria-roledescription', 'slide');
      card.setAttribute('aria-label', `${i + 1} of ${cards.length}`);
    });
    position.textContent = `${index + 1} / ${cards.length}`;
    if (manual) announcement.textContent = `Review ${index + 1} of ${cards.length}, ${cards[index].querySelector('strong').textContent}`;
    schedule();
  }
  function setPaused(value) {
    paused = value;
    toggle.textContent = paused ? 'Play' : 'Pause';
    toggle.setAttribute('aria-label', `${paused ? 'Start' : 'Pause'} automatic review rotation`);
    schedule();
  }
  carousel.classList.add('is-ready');
  controls.hidden = cards.length < 2;
  show(0);
  setPaused(paused);
  toggle.addEventListener('pointerdown', () => { pointerPaused = paused; });
  controls.addEventListener('click', (event) => {
    const action = event.target.closest('button')?.dataset.reviewAction;
    if (action === 'toggle') { setPaused(!(pointerPaused ?? paused)); pointerPaused = undefined; }
    if (action === 'previous' || action === 'next') { setPaused(true); show(index + (action === 'next' ? 1 : -1), true); }
  });
  // Keyboard focus stops rotation until the visitor explicitly starts it again.
  carousel.addEventListener('focusin', () => setPaused(true));
  carousel.addEventListener('mouseenter', () => { hovered = true; schedule(); });
  carousel.addEventListener('mouseleave', () => { hovered = false; schedule(); });
  document.addEventListener('visibilitychange', schedule);
  reduced.addEventListener('change', () => { if (reduced.matches) setPaused(true); });
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (!visible && pendingFeed && !carousel.contains(document.activeElement)) applyFeed(pendingFeed);
    schedule();
  }, { threshold: 0.15 }).observe(carousel);

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function makeCard(review, mapsUrl) {
    const card = element('figure', '', 'review-card');
    const stars = element('div', '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating), 'review-stars');
    stars.setAttribute('role', 'img');
    stars.setAttribute('aria-label', `${review.rating} out of 5 stars`);
    const quote = element('blockquote', review.text || '');
    // Never invent prose for a rating-only review.
    if (!review.text) quote.append(element('span', 'This customer left a star rating.', 'muted'));
    card.append(stars, quote);
    if (review.text.length > 300) {
      const excerpt = review.text.slice(0, 300).replace(/\s+\S*$/, '') + '…';
      quote.textContent = excerpt;
      const expand = element('button', 'Read full review', 'review-expand');
      expand.type = 'button';
      expand.setAttribute('aria-expanded', 'false');
      expand.addEventListener('click', () => {
        const expanded = expand.getAttribute('aria-expanded') !== 'true';
        quote.textContent = expanded ? review.text : excerpt;
        expand.textContent = expanded ? 'Show less' : 'Read full review';
        expand.setAttribute('aria-expanded', String(expanded));
        setPaused(true);
      });
      card.append(expand);
    }
    const caption = element('figcaption');
    caption.append(element('strong', review.author));
    const date = new Date(review.createdAt);
    caption.append(element('span', `Google review${review.excerpt ? ' excerpt' : ''}${Number.isNaN(date.getTime()) ? '' : ' · ' + date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`, 'muted'));
    const link = element('a', 'View our reviews on Google ↗', 'inline-link');
    link.href = mapsUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
    card.append(caption, link);
    return card;
  }
  function validFeed(feed) {
    const publicSnapshot = feed?.source === 'google-public-snapshot';
    return (publicSnapshot || feed?.source === 'google-business-profile') && Array.isArray(feed.reviews) && feed.reviews.length <= 50
      && (!publicSnapshot || (feed.complete === true && feed.reviews.length === feed.totalReviewCount))
      && typeof feed.mapsUrl === 'string' && /^https:\/\/www\.google\.com\/maps\//.test(feed.mapsUrl)
      && Number.isFinite(feed.averageRating) && (feed.averageRating >= 1 || (feed.averageRating === 0 && feed.totalReviewCount === 0)) && feed.averageRating <= 5
      && Number.isInteger(feed.totalReviewCount) && feed.totalReviewCount >= feed.reviews.length
      && Number.isFinite(Date.parse(feed.fetchedAt)) && Math.abs(Date.now() - Date.parse(feed.fetchedAt)) < (publicSnapshot ? 604800000 : 86400000)
      && feed.reviews.every(r => typeof r.id === 'string' && typeof r.author === 'string' && typeof r.text === 'string' && r.text.length <= 20000 && Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5);
  }
  function applyFeed(feed) {
    stage.replaceChildren(...feed.reviews.map(review => makeCard(review, feed.mapsUrl)));
    cards = [...stage.children];
    controls.hidden = cards.length < 2;
    const publicSnapshot = feed.source === 'google-public-snapshot';
    section.querySelector('#reviews-description').textContent = publicSnapshot
      ? 'A little love from our customers. Excerpts from their Google reviews, in their own words.'
      : 'Recent customer reviews from Google. Real experiences, in their own words.';
    const summary = section.querySelector('#reviews-summary');
    summary.textContent = `${feed.averageRating.toFixed(1)} / 5 on Google · ${feed.totalReviewCount} ${feed.totalReviewCount === 1 ? 'review' : 'reviews'}`;
    if (publicSnapshot) {
      const checked = element('span', 'Checked ' + new Date(feed.fetchedAt).toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric',timeZone:'America/Chicago'}), 'reviews-checked');
      summary.append(checked);
    }
    summary.hidden = false;
    if (!cards.length) {
      stage.append(element('p', 'Visit our Google profile to see the latest customer feedback.', 'muted'));
      summary.hidden = true;
    }
    appliedFeed = JSON.stringify(feed);
    appliedAt = Date.parse(feed.fetchedAt);
    appliedLifetime = publicSnapshot ? 604800000 : 86400000;
    pendingFeed = null;
    show(0);
  }
  async function refresh() {
    if (!section.dataset.reviewsEndpoint || document.hidden) return;
    // Do not keep API content indefinitely in a long-open tab after an outage.
    if (appliedFeed && Date.now() - appliedAt >= appliedLifetime && !carousel.contains(document.activeElement)) {
      stage.replaceChildren(...originalCards.map(card => card.cloneNode(true)));
      cards = [...stage.children];
      controls.hidden = cards.length < 2;
      section.querySelector('#reviews-description').textContent = originalDescription;
      section.querySelector('#reviews-summary').hidden = true;
      appliedFeed = undefined; pendingFeed = null;
      show(0);
    }
    try {
      const response = await fetch(section.dataset.reviewsEndpoint, { signal: AbortSignal.timeout(8000), credentials: 'omit' });
      if (!response.ok) return;
      const feed = await response.json();
      if (!validFeed(feed) || JSON.stringify(feed) === appliedFeed) return;
      // Do not replace a review under someone's cursor or keyboard focus.
      if (hovered || carousel.contains(document.activeElement) || (appliedFeed && visible)) pendingFeed = feed;
      else applyFeed(feed);
    } catch { /* The original attributed reviews remain usable during outages. */ }
  }
  refresh();
  setInterval(refresh, 300000);
})();
