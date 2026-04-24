(() => {
  const TARGET_PATH = "/codex/cloud/settings/analytics";
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const BAR_CLASS = "codex-usage-bar-with-time";
  const QUOTA_FILL_CLASS = "codex-usage-original-fill";
  const TIME_TRACK_CLASS = "codex-usage-time-track";
  const TIME_FILL_CLASS = "codex-usage-time-fill";
  const UPDATE_INTERVAL_MS = 30 * 1000;

  let updateTimer = 0;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  function isTargetPage() {
    const normalizedPath = window.location.pathname.replace(/\/$/, "");
    return window.location.hostname === "chatgpt.com" && normalizedPath === TARGET_PATH;
  }

  function scheduleRender() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(render, 150);
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

  function createNode(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function findQuotaFill(card, quotaPercent) {
    const fills = Array.from(card.querySelectorAll("div")).filter((node) => {
      const className = String(node.className || "");
      const width = Number.parseFloat(node.style.width || "");

      return className.includes("bg-[#22c55e]") && Number.isFinite(width);
    });

    if (quotaPercent == null) return fills[0] || null;

    return fills.find((node) => Math.abs(Number.parseFloat(node.style.width) - quotaPercent) < 0.5) || fills[0] || null;
  }

  function findTrack(bar) {
    return (
      Array.from(bar.children).find((node) => {
        const className = String(node.className || "");
        return className.includes("bg-[#ebebf0]") && className.includes("w-full");
      }) || null
    );
  }

  function setBarLayerLayout(layer, top) {
    layer.style.top = `${top}px`;
    layer.style.height = "12px";
    layer.style.borderRadius = "999px";
  }

  function upsertTimeFill(card, values) {
    const quotaFill = findQuotaFill(card, values.quotaPercent);
    const bar = quotaFill?.parentElement;

    if (!quotaFill || !bar) return;

    bar.classList.add(BAR_CLASS);
    bar.style.height = "28px";
    bar.setAttribute("aria-label", `Limit ${values.quotaPercent}% remaining, time ${values.timePercent}% remaining`);

    const track = findTrack(bar);
    if (track) setBarLayerLayout(track, 0);

    quotaFill.classList.add(QUOTA_FILL_CLASS);
    setBarLayerLayout(quotaFill, 0);

    let timeTrack = bar.querySelector(`.${TIME_TRACK_CLASS}`);
    if (!timeTrack) {
      timeTrack = createNode("div", TIME_TRACK_CLASS);
      bar.append(timeTrack);
    }

    setBarLayerLayout(timeTrack, 16);

    let timeFill = bar.querySelector(`.${TIME_FILL_CLASS}`);
    if (!timeFill) {
      timeFill = createNode("div", TIME_FILL_CLASS);
      bar.append(timeFill);
    }

    timeFill.style.width = `${values.timePercentPrecise}%`;
    timeFill.setAttribute("title", `Time remaining: ${values.timePercent}%`);
    setBarLayerLayout(timeFill, 16);
  }

  function render() {
    if (!isTargetPage()) return;

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
      timePercentPrecise: Number(timePercentPrecise.toFixed(2))
    });
  }

  function boot() {
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
