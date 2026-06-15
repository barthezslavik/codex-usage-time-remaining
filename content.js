(() => {
  const TARGET_PATH = "/codex/cloud/settings/analytics";
  const LEGACY_TARGET_PATH = "/codex/settings/usage";
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const BAR_CLASS = "codex-usage-bar-with-time";
  const QUOTA_TRACK_CLASS = "codex-usage-quota-track";
  const QUOTA_FILL_CLASS = "codex-usage-original-fill";
  const TIME_TRACK_CLASS = "codex-usage-time-track";
  const TIME_FILL_CLASS = "codex-usage-time-fill";
  const TIME_LABEL_CLASS = "codex-usage-time-label";
  const UPDATE_INTERVAL_MS = 30 * 1000;
  const WEEKDAYS = {
    sun: 0,
    sunday: 0,
    mon: 1,
    monday: 1,
    tue: 2,
    tuesday: 2,
    wed: 3,
    wednesday: 3,
    thu: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6
  };

  let updateTimer = 0;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  function isChatGPTTargetPage() {
    const normalizedPath = window.location.pathname.replace(/\/$/, "");
    return (
      window.location.hostname === "chatgpt.com" &&
      (normalizedPath === TARGET_PATH || normalizedPath === LEGACY_TARGET_PATH)
    );
  }

  function isClaudeTargetPage() {
    return window.location.hostname === "claude.ai";
  }

  function scheduleRender() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(render, 150);
  }

  function installNavigationHooks() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function pushState(...args) {
      const result = originalPushState.apply(this, args);
      scheduleRender();
      return result;
    };

    history.replaceState = function replaceState(...args) {
      const result = originalReplaceState.apply(this, args);
      scheduleRender();
      return result;
    };
  }

  function findUsageCard() {
    const articles = Array.from(document.querySelectorAll("article"));

    return articles.find((article) => {
      const text = article.innerText || "";
      return /Weekly usage limit/i.test(text) && /\d+(?:\.\d+)?%\s+remaining/i.test(text) && /Resets\s+/i.test(text);
    });
  }

  function extractQuotaPercent(card) {
    const match = (card.innerText || "").match(/(\d+(?:\.\d+)?)%\s+remaining/i);
    return match ? Number(match[1]) : null;
  }

  function extractResetDate(card) {
    const lines = (card.innerText || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    const resetLine = lines.find((line) => /^Resets\s+/i.test(line));
    if (!resetLine) return null;

    const rawDate = resetLine.replace(/^Resets\s+/i, "").trim();
    const timestamp = Date.parse(rawDate);

    return Number.isFinite(timestamp) ? new Date(timestamp) : null;
  }

  function formatBarDelta(ms) {
    const sign = ms >= 0 ? "+" : "-";
    const totalMinutes = Math.floor(Math.abs(ms) / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
      return `${sign}${hours} hour${hours !== 1 ? "s" : ""} ${minutes} minute${minutes !== 1 ? "s" : ""}`;
    }
    return `${sign}${minutes} minute${minutes !== 1 ? "s" : ""}`;
  }

  function formatDuration(ms) {
    const totalMinutes = Math.max(Math.floor(ms / 60000), 0);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
      return `${hours} hour${hours !== 1 ? "s" : ""} ${minutes} minute${minutes !== 1 ? "s" : ""}`;
    }
    return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  }

  function createNode(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function sendUsageUpdate(payload) {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;

    chrome.runtime.sendMessage({ type: "usage-time-update", ...payload }, () => {
      void chrome.runtime.lastError;
    });
  }

  function getPercentWidth(node) {
    if (!node) return null;
    const match = String(node.style.width || "").match(/^(\d+(?:\.\d+)?)%$/);
    return match ? Number(match[1]) : null;
  }

  function isExtensionLayer(node) {
    const className = String(node.className || "");
    return (
      className.includes(QUOTA_TRACK_CLASS) ||
      className.includes(TIME_TRACK_CLASS) ||
      className.includes(TIME_FILL_CLASS) ||
      className.includes(TIME_LABEL_CLASS)
    );
  }

  function findQuotaFill(card, quotaPercent) {
    const fills = Array.from(card.querySelectorAll("div.relative > div")).filter((node) => {
      return getPercentWidth(node) != null && !isExtensionLayer(node);
    });
    const fallbackFills = Array.from(card.querySelectorAll("div")).filter((node) => {
      const className = String(node.className || "");
      const width = getPercentWidth(node);

      return (
        (className.includes("bg-[#22c55e]") || className.includes("bg-[#f87171]") || className.includes("bg-[#facc15]")) &&
        width != null
      );
    });
    const candidates = fills.length > 0 ? fills : fallbackFills;

    if (quotaPercent == null) return candidates[0] || null;

    return candidates.find((node) => Math.abs(getPercentWidth(node) - quotaPercent) < 0.5) || candidates[0] || null;
  }

  function findTrack(bar) {
    return (
      Array.from(bar.children).find((node) => {
        const className = String(node.className || "");
        return !isExtensionLayer(node) && className.includes("w-full") && getPercentWidth(node) == null;
      }) || null
    );
  }

  function setBarLayerLayout(layer, top, height) {
    layer.style.position = "absolute";
    layer.style.insetInlineStart = "0";
    layer.style.top = `${top}px`;
    layer.style.height = `${height}px`;
    layer.style.borderRadius = "999px";
  }

  function upsertTimeFill(card, values) {
    const quotaFill = findQuotaFill(card, values.quotaPercent);
    const bar = quotaFill?.parentElement;

    if (!quotaFill || !bar) return;

    const barHeight = values.barHeight || 12;
    const barGap = 4;
    const timeTop = barHeight + barGap;
    const labelTop = timeTop + barHeight + 2;
    const barBackground = window.getComputedStyle(bar).backgroundColor;
    bar.classList.add(BAR_CLASS);
    bar.style.position = "relative";
    bar.style.height = `${labelTop + 12}px`;
    bar.style.overflow = "visible";
    bar.style.background = "transparent";
    bar.setAttribute("aria-label", `${values.quotaText || `Limit ${values.quotaPercent}% remaining`}, ${values.timeTitle || "Time remaining"} ${values.timePercent}%`);

    const track = findTrack(bar);
    if (track) {
      setBarLayerLayout(track, 0, barHeight);
    } else {
      let quotaTrack = bar.querySelector(`.${QUOTA_TRACK_CLASS}`);
      if (!quotaTrack) {
        quotaTrack = createNode("div", QUOTA_TRACK_CLASS);
        bar.prepend(quotaTrack);
        quotaTrack.style.background = barBackground && barBackground !== "rgba(0, 0, 0, 0)" ? barBackground : "#ebebf0";
      }
      quotaTrack.style.width = "100%";
      setBarLayerLayout(quotaTrack, 0, barHeight);
    }

    quotaFill.classList.add(QUOTA_FILL_CLASS);
    setBarLayerLayout(quotaFill, 0, barHeight);

    let timeTrack = bar.querySelector(`.${TIME_TRACK_CLASS}`);
    if (!timeTrack) {
      timeTrack = createNode("div", TIME_TRACK_CLASS);
      bar.append(timeTrack);
    }

    setBarLayerLayout(timeTrack, timeTop, barHeight);

    let timeFill = bar.querySelector(`.${TIME_FILL_CLASS}`);
    if (!timeFill) {
      timeFill = createNode("div", TIME_FILL_CLASS);
      bar.append(timeFill);
    }

    timeFill.style.width = `${values.timePercentPrecise}%`;
    timeFill.setAttribute("title", `${values.timeTitle || "Time remaining"}: ${values.timePercent}%`);
    setBarLayerLayout(timeFill, timeTop, barHeight);

    let timeLabel = bar.querySelector(`.${TIME_LABEL_CLASS}`);
    if (!timeLabel) {
      timeLabel = createNode("div", TIME_LABEL_CLASS);
      bar.append(timeLabel);
    }
    timeLabel.style.top = `${labelTop}px`;
    timeLabel.textContent = values.timeRemainingLabel;
  }

  function removeTimeFill(bar) {
    if (!bar?.classList.contains(BAR_CLASS)) return;

    bar.querySelector(`.${QUOTA_TRACK_CLASS}`)?.remove();
    bar.querySelector(`.${TIME_TRACK_CLASS}`)?.remove();
    bar.querySelector(`.${TIME_FILL_CLASS}`)?.remove();
    bar.querySelector(`.${TIME_LABEL_CLASS}`)?.remove();

    bar.classList.remove(BAR_CLASS);
    bar.style.position = "";
    bar.style.height = "";
    bar.style.overflow = "";
    bar.style.background = "";
    bar.setAttribute("aria-label", "Usage");

    Array.from(bar.children).forEach((child) => {
      child.classList.remove(QUOTA_FILL_CLASS);
      child.style.position = "";
      child.style.insetInlineStart = "";
      child.style.top = "";
      child.style.height = "";
      child.style.borderRadius = "";
    });
  }

  function renderChatGPT() {
    const card = findUsageCard();
    if (!card) return;

    const resetDate = extractResetDate(card);
    if (!resetDate) return;

    const quotaPercent = extractQuotaPercent(card);
    const remainingMs = resetDate.getTime() - Date.now();
    const timePercentPrecise = clamp((remainingMs / WEEK_MS) * 100, 0, 100);
    const timePercent = Math.round(timePercentPrecise);

    upsertTimeFill(card, {
      quotaPercent,
      timePercent,
      timePercentPrecise: Number(timePercentPrecise.toFixed(2)),
      timeTitle: "Time remaining",
      timeRemainingLabel: formatBarDelta((timePercentPrecise - (quotaPercent ?? 0)) / 100 * WEEK_MS)
    });

    sendUsageUpdate({
      provider: "chatgpt",
      resetAt: resetDate.getTime(),
      quotaPercent
    });
  }

  function findAncestor(node, predicate, maxDepth) {
    let current = node.parentElement;
    let depth = 0;

    while (current && depth < maxDepth) {
      if (predicate(current)) return current;
      current = current.parentElement;
      depth += 1;
    }

    return null;
  }

  function parseClaudeResetDate(rawDate) {
    const match = rawDate.match(/^([a-z]+)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (!match) return null;

    const resetDay = WEEKDAYS[match[1].toLowerCase()];
    if (resetDay == null) return null;

    let hours = Number(match[2]);
    const minutes = Number(match[3] || 0);
    const meridiem = match[4].toLowerCase();
    if (hours === 12) hours = 0;
    if (meridiem === "pm") hours += 12;

    const resetDate = new Date();
    resetDate.setHours(hours, minutes, 0, 0);
    resetDate.setDate(resetDate.getDate() + ((resetDay - resetDate.getDay() + 7) % 7));
    if (resetDate.getTime() <= Date.now()) resetDate.setDate(resetDate.getDate() + 7);

    return resetDate;
  }

  function parseClaudeResetDuration(rawDuration) {
    const hoursMatch = rawDuration.match(/(\d+)\s*(?:h|hr|hrs|hour|hours)\b/i);
    const minutesMatch = rawDuration.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/i);
    const hours = hoursMatch ? Number(hoursMatch[1]) : 0;
    const minutes = minutesMatch ? Number(minutesMatch[1]) : 0;
    const durationMs = (hours * 60 + minutes) * 60000;

    return durationMs > 0 ? new Date(Date.now() + durationMs) : null;
  }

  function parseClaudeResetTime(rawTime) {
    const match = rawTime.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (!match) return null;

    let hours = Number(match[1]);
    const minutes = Number(match[2] || 0);
    const meridiem = match[3].toLowerCase();
    if (hours === 12) hours = 0;
    if (meridiem === "pm") hours += 12;

    const resetDate = new Date();
    resetDate.setHours(hours, minutes, 0, 0);
    if (resetDate.getTime() <= Date.now()) resetDate.setDate(resetDate.getDate() + 1);

    return resetDate;
  }

  function extractClaudeResetDate(row) {
    const text = row.innerText || row.textContent || "";
    const dateMatch = text.match(/Resets\s+((?:sun|mon|tue|wed|thu|fri|sat)[a-z]*\s+\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
    if (dateMatch) return parseClaudeResetDate(dateMatch[1]);

    const durationMatch = text.match(/Resets\s+in\s+([^\n]+)/i);
    if (durationMatch) return parseClaudeResetDuration(durationMatch[1]);

    const timeMatch = text.match(/Resets\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
    return timeMatch ? parseClaudeResetTime(timeMatch[1]) : null;
  }

  function extractClaudeUsagePercent(row, progressBar) {
    const ariaValue = Number(progressBar.getAttribute("aria-valuenow"));
    if (Number.isFinite(ariaValue)) return ariaValue;

    const textMatch = (row.innerText || "").match(/(\d+(?:\.\d+)?)%\s+used/i);
    if (textMatch) return Number(textMatch[1]);

    return getPercentWidth(progressBar.querySelector("div"));
  }

  function findClaudeSessionResetDate() {
    const labels = Array.from(document.querySelectorAll("span, div")).filter((node) => {
      const text = (node.textContent || "").trim();
      return /^Current session$/i.test(text);
    });

    for (const label of labels) {
      const container = findAncestor(label, (node) => /Resets\s+in\s+/i.test(node.innerText || node.textContent || ""), 6);
      const resetDate = container ? extractClaudeResetDate(container) : null;
      if (resetDate) return resetDate;
    }

    const containers = Array.from(document.querySelectorAll("div")).filter((node) => {
      const text = (node.innerText || node.textContent || "").trim();
      return /^Current session\b/i.test(text) && /Resets\s+in\s+/i.test(text);
    });

    for (const container of containers) {
      const resetDate = extractClaudeResetDate(container);
      if (resetDate) return resetDate;
    }

    if (/Usage limit reached/i.test(document.body.innerText || document.body.textContent || "")) {
      return extractClaudeResetDate(document.body);
    }

    return null;
  }

  function getClaudeUsageLabel(row, progressBar) {
    return Array.from(row.children)
      .filter((child) => !child.contains(progressBar))
      .map((child) => child.innerText || "")
      .join("\n")
      .trim();
  }

  function findClaudeUsageRow(progressBar) {
    return findAncestor(progressBar, (node) => {
      const label = getClaudeUsageLabel(node, progressBar);
      return (
        /^(All models|Current session)\b/i.test(label) &&
        /Resets\s+/i.test(label) &&
        node.querySelectorAll('[role="progressbar"]').length === 1
      );
    }, 8);
  }

  function renderClaude() {
    const progressBars = Array.from(document.querySelectorAll('[role="progressbar"]'));
    const sessionResetDate = findClaudeSessionResetDate();
    let sentSessionUpdate = false;

    if (sessionResetDate) {
      sendUsageUpdate({
        provider: "claude-session",
        resetAt: sessionResetDate.getTime(),
        quotaPercent: null
      });
      sentSessionUpdate = true;
    }

    progressBars.forEach((progressBar) => {
      const row = findClaudeUsageRow(progressBar);
      const label = row ? getClaudeUsageLabel(row, progressBar) : "";
      const resetDate = row ? extractClaudeResetDate(row) : null;
      const usedPercent = row ? extractClaudeUsagePercent(row, progressBar) : null;

      if (!row || !/^All models\b/i.test(label)) {
        removeTimeFill(progressBar);
        return;
      }

      if (!resetDate) return;
      if (usedPercent == null) return;

      const remainingMs = resetDate.getTime() - Date.now();
      const timeRemainingPercent = clamp((remainingMs / WEEK_MS) * 100, 0, 100);
      const timeElapsedPercent = 100 - timeRemainingPercent;
      const timeElapsedRounded = Math.round(timeElapsedPercent);

      upsertTimeFill(row, {
        quotaPercent: usedPercent,
        quotaText: `Usage ${usedPercent}% used`,
        timePercent: timeElapsedRounded,
        timePercentPrecise: Number(timeElapsedPercent.toFixed(2)),
        timeTitle: "Time elapsed",
        timeRemainingLabel: `Resets in ${formatDuration(remainingMs)}`,
        barHeight: 8
      });

      if (!sentSessionUpdate) {
        sendUsageUpdate({
          provider: "claude",
          resetAt: resetDate.getTime(),
          quotaPercent: usedPercent
        });
      }
    });
  }

  function render() {
    if (isChatGPTTargetPage()) renderChatGPT();
    if (isClaudeTargetPage()) renderClaude();
  }

  function boot() {
    installNavigationHooks();
    render();

    const observer = new MutationObserver(scheduleRender);
    observer.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true
    });

    window.setInterval(render, UPDATE_INTERVAL_MS);
    window.addEventListener("hashchange", scheduleRender);
    window.addEventListener("popstate", scheduleRender);
  }

  boot();
})();
