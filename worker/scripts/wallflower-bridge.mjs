import { pathToFileURL } from 'node:url';

const DEFAULT_POLL_MS = 1500;
const DEFAULT_WLED_TIMEOUT_MS = 5000;

export function buildWledPayload(trigger) {
  return {
    on: true,
    bri: Number(trigger.brightness || 180),
    ps: Number(trigger.presetId)
  };
}

export function readBridgeConfig(env = process.env) {
  const apiBase = normalizeApiBase(requireEnv(env, 'WALLFLOWER_API_BASE'));

  return {
    apiBase,
    deviceId: requireEnv(env, 'WALL_DEVICE_ID'),
    bridgeToken: requireEnv(env, 'BRIDGE_TOKEN'),
    wledBaseUrl: requireEnv(env, 'WLED_BASE_URL').replace(/\/$/, ''),
    pollMs: normalizeNumber(env.BRIDGE_POLL_MS, DEFAULT_POLL_MS),
    wledTimeoutMs: normalizeNumber(env.WLED_TIMEOUT_MS, DEFAULT_WLED_TIMEOUT_MS)
  };
}

export async function fetchPendingTriggers(config, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.apiBase}/bridge/devices/${encodeURIComponent(config.deviceId)}/triggers`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${config.bridgeToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Trigger poll failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  return payload.triggers || [];
}

export async function triggerWled(config, trigger, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.wledBaseUrl}/json/state`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(buildWledPayload(trigger)),
    signal: AbortSignal.timeout(config.wledTimeoutMs)
  });

  if (!response.ok) {
    throw new Error(`WLED failed with HTTP ${response.status}`);
  }
}

export async function completeTrigger(config, triggerId, result, fetchImpl = fetch) {
  const body = result.success
    ? { success: true }
    : { success: false, errorMessage: cleanErrorMessage(result.errorMessage) };

  const response = await fetchImpl(`${config.apiBase}/bridge/triggers/${encodeURIComponent(triggerId)}/complete`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${config.bridgeToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Trigger completion failed with HTTP ${response.status}`);
  }
}

export async function runBridgeLoop(config = readBridgeConfig(), options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const sleepImpl = options.sleepImpl || sleep;
  const logger = options.logger || console;

  logger.log(`Wallflower bridge started for device ${config.deviceId}.`);

  while (true) {
    await runBridgeOnce(config, { fetchImpl, logger });
    await sleepImpl(config.pollMs);
  }
}

export async function runBridgeOnce(config, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const logger = options.logger || console;

  try {
    const triggers = await fetchPendingTriggers(config, fetchImpl);

    for (const trigger of triggers) {
      try {
        await triggerWled(config, trigger, fetchImpl);
        await completeTrigger(config, trigger.id, { success: true }, fetchImpl);
        logger.log(`Completed light trigger ${trigger.id}.`);
      } catch (error) {
        const message = cleanErrorMessage(error?.message || error);
        await completeTrigger(config, trigger.id, { success: false, errorMessage: message }, fetchImpl);
        logger.error(`Light trigger ${trigger.id} failed: ${message}`);
      }
    }
  } catch (error) {
    logger.error(`Bridge polling failed: ${cleanErrorMessage(error?.message || error)}`);
  }
}

function normalizeApiBase(value) {
  const base = value.replace(/\/$/, '');
  return base.endsWith('/moments-api') ? base : `${base}/moments-api`;
}

function requireEnv(env, key) {
  const value = String(env[key] || '').trim();
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function normalizeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function cleanErrorMessage(value) {
  return String(value || 'Unknown bridge error').replace(/\s+/g, ' ').slice(0, 500);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runBridgeLoop().catch((error) => {
    console.error(`Fatal bridge error: ${cleanErrorMessage(error?.message || error)}`);
    process.exit(1);
  });
}
