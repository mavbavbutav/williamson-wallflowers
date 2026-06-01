const VIDEO_THUMBNAIL_QUALITY = 0.82;
const VIDEO_THUMBNAIL_WIDTH = 720;

export async function createVideoThumbnailFile(file, filename = "wallflower-video-thumbnail.jpg") {
  if (!file) return null;

  const objectUrl = URL.createObjectURL(file);
  try {
    const dataUrl = await captureVideoThumbnailDataUrl(objectUrl);
    if (!dataUrl) return null;

    const blob = dataUrlToBlob(dataUrl);
    return new File([blob], filename, { type: blob.type || "image/jpeg" });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function captureVideoThumbnailDataUrl(sourceUrl) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = sourceUrl;

  try {
    await waitForMediaEvent(video, "loadedmetadata", 5000);
    await waitForMediaEvent(video, "loadeddata", 5000).catch(() => undefined);

    let bestFrame = null;
    for (const time of thumbnailSampleTimes(video.duration)) {
      await seekVideo(video, time);
      const frame = captureVideoFrame(video);
      if (!frame) continue;

      if (!bestFrame || frame.score > bestFrame.score) bestFrame = frame;
      if (frame.score >= 34) break;
    }

    return bestFrame && bestFrame.score >= 14 ? bestFrame.dataUrl : "";
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

export function dataUrlToBlob(dataUrl) {
  const [meta, payload] = String(dataUrl || "").split(",");
  const mimeType = /data:([^;]+)/.exec(meta || "")?.[1] || "image/jpeg";
  const binary = atob(payload || "");
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function thumbnailSampleTimes(duration) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 3;
  const latestSample = Math.max(0.08, Math.min(safeDuration - 0.08, 8));
  const relativeSamples = [0.08, 0.18, 0.32, 0.48].map((ratio) => safeDuration * ratio);
  return [0.12, 0.35, 0.75, 1.25, 2, 3.5, 5, latestSample, ...relativeSamples]
    .map((time) => Math.min(Math.max(0.08, time), latestSample))
    .sort((left, right) => left - right)
    .filter((time, index, times) => index === 0 || Math.abs(time - times[index - 1]) > 0.04);
}

async function seekVideo(video, time) {
  const targetTime = Math.max(0, Number(time) || 0);
  if (video.readyState >= 2 && Math.abs(video.currentTime - targetTime) < 0.04) {
    await waitForVideoFrame(video);
    return;
  }

  const seeked = waitForMediaEvent(video, "seeked", 1800);
  video.currentTime = targetTime;
  await seeked.catch(() => undefined);
  if (video.readyState < 2) {
    await waitForMediaEvent(video, "loadeddata", 1200).catch(() => undefined);
  }
  if (targetTime > 0.08 && Math.abs(video.currentTime - targetTime) > 0.12) {
    await playVideoUntil(video, targetTime);
  }
  await waitForVideoFrame(video);
}

function captureVideoFrame(video) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return null;

  const canvas = document.createElement("canvas");
  const width = Math.min(VIDEO_THUMBNAIL_WIDTH, sourceWidth);
  const height = Math.max(1, Math.round(sourceHeight * (width / sourceWidth)));
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(video, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  return {
    dataUrl: canvas.toDataURL("image/jpeg", VIDEO_THUMBNAIL_QUALITY),
    score: scoreVideoFrame(imageData.data)
  };
}

function scoreVideoFrame(data) {
  let luminanceTotal = 0;
  let brightPixels = 0;
  let saturatedPixels = 0;
  const pixelCount = Math.max(1, data.length / 4);

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    luminanceTotal += luminance;
    if (luminance > 42) brightPixels += 1;
    if (Math.max(red, green, blue) - Math.min(red, green, blue) > 28) saturatedPixels += 1;
  }

  return (luminanceTotal / pixelCount) + (brightPixels / pixelCount) * 38 + (saturatedPixels / pixelCount) * 24;
}

function waitForMediaEvent(element, eventName, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`${eventName} timed out`));
    }, timeoutMs);
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`${eventName} failed`));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      element.removeEventListener(eventName, onEvent);
      element.removeEventListener("error", onError);
    };

    element.addEventListener(eventName, onEvent, { once: true });
    element.addEventListener("error", onError, { once: true });
  });
}

function waitForVideoFrame(video, timeoutMs = 1200) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(finish, timeoutMs);

    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(finish);
      return;
    }

    window.requestAnimationFrame(() => window.requestAnimationFrame(finish));
  });
}

async function playVideoUntil(video, targetTime, timeoutMs = 2800) {
  if (typeof video.play !== "function") return;

  try {
    await video.play();
    await waitForVideoTime(video, targetTime, timeoutMs);
  } catch {
    // Some mobile browsers still block hidden muted playback; seeking remains the main path.
  } finally {
    if (typeof video.pause === "function") video.pause();
  }
}

function waitForVideoTime(video, targetTime, timeoutMs) {
  const target = Math.max(0, Number(targetTime) || 0);
  return new Promise((resolve) => {
    let frameRequest = 0;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.cancelAnimationFrame(frameRequest);
      video.removeEventListener("timeupdate", check);
      video.removeEventListener("ended", finish);
      resolve();
    };
    const check = () => {
      if (video.currentTime + 0.05 >= target || video.ended) {
        finish();
        return;
      }
      frameRequest = window.requestAnimationFrame(check);
    };
    const timeout = window.setTimeout(finish, timeoutMs);

    video.addEventListener("timeupdate", check);
    video.addEventListener("ended", finish, { once: true });
    check();
  });
}
