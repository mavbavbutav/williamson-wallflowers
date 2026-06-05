import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const DIRECT_EMAIL_LINK = 'mailto:jamicarswell@gmail.com?subject=Williamson%20Wallflowers%20Inquiry';
const DIRECT_SMS_LINK = 'sms:+16155164341?&amp;body=Hi%20Jami%2C%20I%27d%20like%20to%20ask%20about%20renting%20a%20Williamson%20Wallflowers%20flower%20wall%20for%20my%20event.';

test('direct Jami contact link keeps desktop email and switches mobile to text', async () => {
  const html = await readText('../../index.html');

  assert.match(
    html,
    new RegExp(`<a class="inline-link" id="directContactLink" href="${escapeRegExp(DIRECT_EMAIL_LINK)}"[^>]*>Contact Jami directly</a>`)
  );
  assert.match(html, new RegExp(`data-email-link="${escapeRegExp(DIRECT_EMAIL_LINK)}"`));
  assert.match(html, new RegExp(`data-sms-link="${escapeRegExp(DIRECT_SMS_LINK)}"`));
  assert.match(html, /function isMobileTextDevice\(\)/);
  assert.match(html, /function configureDirectContactLink\(\)/);
  assert.match(html, /Android\|iPhone\|iPad\|iPod/);
});

async function readText(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
