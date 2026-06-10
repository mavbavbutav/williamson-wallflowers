import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';

import { readBridgeConfig, runBridgeLoop } from './wallflower-bridge.mjs';

const DEFAULT_ENV_PATH = join(os.homedir(), '.wallflower', 'bridge.env');
const DEFAULT_WLED_NAME = 'dig2go';
const PROBE_TIMEOUT_MS = 1500;
const PROBE_CONCURRENCY = 64;

export function parseEnvFile(text) {
  const values = {};

  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    values[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }

  return values;
}

export function replaceEnvValue(text, key, value) {
  const lines = String(text).split(/\r?\n/);
  let replaced = false;

  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('#') && trimmed.startsWith(`${key}=`)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!replaced) next.push(`${key}=${value}`);
  return next.join('\n');
}

async function probeWled(baseUrl, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${baseUrl}/json/info`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    });
    if (!response.ok) return null;
    const info = await response.json();
    if (typeof info?.ver !== 'string') return null;
    return { baseUrl, name: String(info.name || '') };
  } catch {
    return null;
  }
}

function listLocalSubnets() {
  const subnets = new Set();

  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      if (address.address.startsWith('169.254.')) continue;
      subnets.add(address.address.split('.').slice(0, 3).join('.'));
    }
  }

  return [...subnets];
}

async function discoverWled(preferredName) {
  const candidates = [];
  for (const subnet of listLocalSubnets()) {
    for (let host = 1; host <= 254; host += 1) {
      candidates.push(`http://${subnet}.${host}`);
    }
  }

  const found = [];
  let nextIndex = 0;

  await Promise.all(Array.from({ length: PROBE_CONCURRENCY }, async () => {
    while (nextIndex < candidates.length) {
      const candidate = candidates[nextIndex++];
      const device = await probeWled(candidate);
      if (device) found.push(device);
    }
  }));

  if (!found.length) return null;
  return found.find((device) => device.name === preferredName) || found[0];
}

async function main() {
  const envPath = process.argv[2] || DEFAULT_ENV_PATH;
  const envText = readFileSync(envPath, 'utf8');
  const values = parseEnvFile(envText);

  const configuredBase = (values.WLED_BASE_URL || '').replace(/\/$/, '');
  const hasUsableBase = configuredBase && !configuredBase.includes('REPLACE-WITH');
  const reachable = hasUsableBase ? await probeWled(configuredBase) : null;

  if (!reachable) {
    console.log(`WLED is not reachable at ${hasUsableBase ? configuredBase : '(unset)'}. Scanning the local network...`);
    const found = await discoverWled(values.WLED_DEVICE_NAME || DEFAULT_WLED_NAME);

    if (!found) {
      console.error('No WLED controller found on this network. Check that it is powered on and joined to this Wi-Fi (if it lost Wi-Fi, connect a phone to its WLED-AP hotspot and update the credentials).');
      process.exit(1);
    }

    console.log(`Found WLED "${found.name}" at ${found.baseUrl}. Updating ${envPath}.`);
    writeFileSync(envPath, replaceEnvValue(envText, 'WLED_BASE_URL', found.baseUrl));
    values.WLED_BASE_URL = found.baseUrl;
  }

  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  await runBridgeLoop(readBridgeConfig());
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((error) => {
    console.error(`Fatal bridge launcher error: ${String(error?.message || error)}`);
    process.exit(1);
  });
}
