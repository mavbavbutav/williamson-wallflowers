import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const FAVICON_VERSION = 'ww-logo-favicon-2';

test('site favicons use Williamson Wallflowers logo assets', async () => {
  const htmlFiles = [
    '../../index.html',
    '../../moments/index.html',
    '../../moments/admin/index.html',
    '../../moments/host/index.html',
    '../../moments/capsule/index.html',
    '../../moments/capsule/cast/index.html'
  ];

  const htmlDocuments = await Promise.all(htmlFiles.map(readText));
  for (const html of htmlDocuments) {
    assert.match(html, new RegExp(`favicon-48\\.png\\?v=${FAVICON_VERSION}`));
    assert.doesNotMatch(html, /ww-logo-favicon-1/);
  }

  const faviconSvg = await readText('../../favicon.svg');
  assert.match(faviconSvg, /Williamson Wallflowers logo/);
  assert.match(faviconSvg, /data:image\/png;base64/);
  assert.doesNotMatch(faviconSvg, />W</);
  assert.doesNotMatch(faviconSvg, /font-size="20"/);

  const pngSignature = await readBinary('../../favicon-48.png');
  assert.equal(pngSignature.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

async function readText(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

async function readBinary(path) {
  return readFile(new URL(path, import.meta.url));
}
