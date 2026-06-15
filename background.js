const STATE_KEY = "usageIconState";
const UPDATE_ALARM = "usageIconUpdate";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ICON_SIZES = [16, 32, 48, 128];
const BADGE_BACKGROUND = "#1558B0";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatBadge(ms) {
  const minutes = Math.max(Math.floor(ms / 60000), 0);
  return `${Math.min(minutes, 9999)}`;
}

function formatTitleDuration(ms) {
  const totalMinutes = Math.max(Math.ceil(ms / 60000), 0);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function pathRoundRect(ctx, x, y, width, height, radius) {
  const right = x + width;
  const bottom = y + height;

  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(right - radius, y);
  ctx.quadraticCurveTo(right, y, right, y + radius);
  ctx.lineTo(right, bottom - radius);
  ctx.quadraticCurveTo(right, bottom, right - radius, bottom);
  ctx.lineTo(x + radius, bottom);
  ctx.quadraticCurveTo(x, bottom, x, bottom - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawIconBadge(ctx, size, badgeText) {
  if (!badgeText) return;

  const scale = size / 128;
  const x = 2 * scale;
  const y = 38 * scale;
  const width = 124 * scale;
  const height = 86 * scale;
  const radius = 18 * scale;
  const fontSize = (badgeText.length > 3 ? 46 : 58) * scale;

  ctx.fillStyle = BADGE_BACKGROUND;
  pathRoundRect(ctx, x, y, width, height, radius);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(badgeText, x + width / 2, y + height / 2 + 3 * scale);
}

function drawTimerIcon(size, remainingPercent, badgeText) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const scale = size / 128;
  const center = size / 2;
  const radius = 38 * scale;
  const stroke = Math.max(2, 10 * scale);
  const knobHeight = 12 * scale;
  const knobWidth = 24 * scale;
  const arcStart = -Math.PI / 2;
  const progress = clamp(remainingPercent / 100, 0, 1);

  if (badgeText) {
    pathRoundRect(ctx, 0, 0, size, size, 24 * scale);
    ctx.fillStyle = BADGE_BACKGROUND;
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = `800 ${badgeText.length > 3 ? 46 * scale : 62 * scale}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(badgeText, center, center + 4 * scale);

    return ctx.getImageData(0, 0, size, size);
  }

  pathRoundRect(ctx, 0, 0, size, size, 28 * scale);
  ctx.fillStyle = "#171717";
  ctx.fill();

  ctx.fillStyle = "#e8e3d5";
  pathRoundRect(ctx, center - knobWidth / 2, 13 * scale, knobWidth, knobHeight, 5 * scale);
  ctx.fill();

  ctx.strokeStyle = "#e8e3d5";
  ctx.lineWidth = stroke;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(center, 70 * scale, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "#d97757";
  ctx.beginPath();
  ctx.arc(center, 70 * scale, radius, arcStart, arcStart + Math.PI * 2 * progress);
  ctx.stroke();

  ctx.strokeStyle = "#e8e3d5";
  ctx.lineWidth = Math.max(2, 7 * scale);
  ctx.beginPath();
  ctx.moveTo(center, 70 * scale);
  ctx.lineTo(center, 45 * scale);
  ctx.moveTo(center, 70 * scale);
  ctx.lineTo(center + 20 * scale, 78 * scale);
  ctx.stroke();

  drawIconBadge(ctx, size, badgeText);

  return ctx.getImageData(0, 0, size, size);
}

function buildIconImageData(remainingPercent, badgeText) {
  return Object.fromEntries(ICON_SIZES.map((size) => [size, drawTimerIcon(size, remainingPercent, badgeText)]));
}

async function getState() {
  const result = await chrome.storage.local.get(STATE_KEY);
  return result[STATE_KEY] || null;
}

async function saveState(state) {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

async function clearAction() {
  await chrome.action.setBadgeText({ text: "" });
  await chrome.action.setTitle({ title: "Usage time remaining" });
}

async function updateAction(state) {
  if (!state?.resetAt) {
    await clearAction();
    return;
  }

  const remainingMs = state.resetAt - Date.now();
  if (remainingMs <= 0 || Date.now() - state.updatedAt > WEEK_MS + 60 * 60 * 1000) {
    await clearAction();
    return;
  }

  const remainingPercent = clamp((remainingMs / WEEK_MS) * 100, 0, 100);
  const badgeText = formatBadge(remainingMs);
  const titleProvider =
    state.provider === "claude-session" ? "Claude session" : state.provider === "claude" ? "Claude" : "ChatGPT";

  await chrome.action.setBadgeText({ text: "" });
  await chrome.action.setTitle({
    title: `${titleProvider}: resets in ${formatTitleDuration(remainingMs)}`
  });

  if (typeof OffscreenCanvas !== "undefined") {
    try {
      await chrome.action.setIcon({ imageData: buildIconImageData(remainingPercent, badgeText) });
      return;
    } catch {
      // Fall through to the native badge if dynamic icon drawing is unavailable.
    }
  }

  await chrome.action.setBadgeBackgroundColor({ color: BADGE_BACKGROUND });
  if (chrome.action.setBadgeTextColor) {
    await chrome.action.setBadgeTextColor({ color: "#ffffff" });
  }
  await chrome.action.setBadgeText({ text: badgeText });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "usage-time-update") return false;

  const state = {
    provider: message.provider,
    resetAt: message.resetAt,
    quotaPercent: message.quotaPercent,
    updatedAt: Date.now()
  };

  saveState(state).then(() => updateAction(state));
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 1 });
  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== UPDATE_ALARM) return;
  getState().then(updateAction);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 1 });
  getState().then(updateAction);
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 1 });
  getState().then(updateAction);
});
