/* ============================================================
   CONFIG — the only place the backend URL is defined.
   FastAPI serves this page itself, so "" (same origin) is right
   when deployed. If you ever host this frontend separately
   (Netlify, Vercel…), put your Render URL here, no trailing slash:
   const API_URL = "https://your-backend.onrender.com";
   ============================================================ */
const API_URL = window.location.protocol === "file:" ? "http://127.0.0.1:8000" : "";

const MAX_CHARS = 2000;           // matches max_length in the FastAPI schema
const PREDICT_TIMEOUT_MS = 60000; // Render free tier can take ~50s to wake up
const HEALTH_TIMEOUT_MS = 15000;
const HEALTH_INTERVAL_MS = 30000;
const IDLE_ACCENT = "#8fd8ff";

const EMOTIONS = {
  sadness:  { label: "Sadness",  emoji: "😢", color: "#60a5fa" },
  joy:      { label: "Joy",      emoji: "😄", color: "#facc15" },
  love:     { label: "Love",     emoji: "❤️", color: "#f472b6" },
  anger:    { label: "Anger",    emoji: "😡", color: "#f87171" },
  fear:     { label: "Fear",     emoji: "😨", color: "#a78bfa" },
  surprise: { label: "Surprise", emoji: "😲", color: "#22d3ee" },
};

/* ---------- Elements ---------- */
const $ = (id) => document.getElementById(id);
const input = $("textInput");
const counter = $("counter");
const analyzeBtn = $("analyzeBtn");
const clearBtn = $("clearBtn");
const spinner = $("spinner");
const analyzeLabel = $("analyzeLabel");
const errorBox = $("errorBox");
const errorText = $("errorText");
const slowNote = $("slowNote");
const stage = $("stage");
const stageLabel = $("stageLabel");
const stageName = $("stageName");
const stageConf = $("stageConf");
const stageNote = $("stageNote");
const gemEmoji = $("gemEmoji");
const spectrum = $("spectrum");
const barsList = $("bars");

let loading = false;
let slowTimer = null;

/* ---------- API ---------- */
async function apiFetch(path, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(API_URL + path, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("The AI server took too long to respond. Please try again in a moment.");
    }
    throw new Error("Unable to connect to the AI server. Please make sure the backend is running.");
  } finally {
    clearTimeout(timer);
  }
}

async function predictEmotion(text) {
  const res = await apiFetch(
    "/predict",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    },
    PREDICT_TIMEOUT_MS
  );

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch (_) { /* non-JSON error body */ }
    throw new Error(detail || `The server returned an error (${res.status}). Please try again.`);
  }

  const data = await res.json();
  // The API spells this key "all_probabilties"; accept the correct spelling too.
  const probabilities = data.all_probabilties || data.all_probabilities;
  if (!data.predicted_emotion || !probabilities) {
    throw new Error("The server sent an unexpected response.");
  }
  return {
    text: data.text,
    emotion: String(data.predicted_emotion).toLowerCase(),
    confidence: Number(data.confidence),
    probabilities,
  };
}

async function checkHealth() {
  const dot = $("apiDot");
  const label = $("apiText");
  let ok = false;
  try {
    const res = await apiFetch("/health", {}, HEALTH_TIMEOUT_MS);
    if (res.ok) {
      const data = await res.json();
      const loaded = data.Model_loaded !== undefined ? data.Model_loaded : data.model_loaded;
      ok = loaded !== false;
    }
  } catch (_) { ok = false; }
  dot.className = "dot " + (ok ? "online" : "offline");
  label.textContent = ok ? "AI API Online" : "API Offline";
}

/* ---------- Stage (the crystal) ---------- */
function setStage(state, r) {
  stage.dataset.state = state;

  if (state === "idle") {
    stage.style.setProperty("--accent", IDLE_ACCENT);
    stage.style.setProperty("--conf", "0");
    gemEmoji.textContent = "";
    stageLabel.textContent = "";
    stageName.textContent = "Awaiting your text";
    stageConf.textContent = "";
    stageNote.textContent = "Your result will form here.";
    spectrum.hidden = true;
  }

  if (state === "loading") {
    stage.style.setProperty("--accent", IDLE_ACCENT);
    stage.style.setProperty("--conf", "0");
    gemEmoji.textContent = "";
    stageLabel.textContent = "";
    stageName.textContent = "Reading emotional patterns…";
    stageConf.textContent = "";
    stageNote.textContent = "";
    spectrum.hidden = true;
  }

  if (state === "result") {
    const em = EMOTIONS[r.emotion] || { label: r.emotion, emoji: "🤔", color: "#a5b4fc" };
    const conf = Math.min(Math.max(r.confidence, 0), 1);

    gemEmoji.textContent = em.emoji;
    stageLabel.textContent = "Detected Emotion";
    stageName.textContent = em.label;
    stageConf.replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = (conf * 100).toFixed(2) + "%";
    stageConf.append(strong, "confidence");
    stageNote.textContent = `“${r.text}”`; // textContent keeps user text safe from XSS

    // let the "loading" frame paint first so colour + ring animate in
    requestAnimationFrame(() => requestAnimationFrame(() => {
      stage.style.setProperty("--accent", em.color);
      stage.style.setProperty("--conf", String(conf));
    }));

    renderBars(r);
  }
}

function renderBars(r) {
  const rows = Object.keys(EMOTIONS)
    .map((key) => ({ key, value: Number(r.probabilities[key] || 0), ...EMOTIONS[key] }))
    .sort((a, b) => b.value - a.value);

  const fills = [];
  const items = rows.map((row, i) => {
    const isTop = row.key === r.emotion;
    const p = Math.min(Math.max(row.value, 0), 1) * 100;

    const li = document.createElement("li");
    li.className = "bar-row" + (isTop ? " top" : "");
    if (isTop) li.style.borderColor = row.color + "55";

    const head = document.createElement("div");
    head.className = "bar-head";
    const name = document.createElement("span");
    name.textContent = `${row.emoji} ${row.label}`;
    const pct = document.createElement("span");
    pct.className = "pct";
    pct.textContent = p.toFixed(2) + "%";
    head.append(name, pct);

    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.background = `linear-gradient(90deg, ${row.color}99, ${row.color})`;
    fill.style.opacity = isTop ? "1" : "0.75";
    if (isTop) fill.style.boxShadow = `0 0 16px ${row.color}aa`;
    fill.style.transition = `width 1s cubic-bezier(0.22, 1, 0.36, 1) ${i * 80}ms`;
    track.appendChild(fill);
    li.append(head, track);
    fills.push([fill, Math.max(p, 0.6)]);
    return li;
  });

  barsList.replaceChildren(...items);
  spectrum.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fills.forEach(([fill, w]) => { fill.style.width = w + "%"; });
  }));
}

/* ---------- UI state ---------- */
function syncControls() {
  const hasText = input.value.trim().length > 0;
  analyzeBtn.disabled = !hasText || loading;
  clearBtn.disabled = loading || (!input.value && stage.dataset.state === "idle" && errorBox.hidden);
  counter.textContent = `${input.value.length} / ${MAX_CHARS}`;
}

function setLoading(on) {
  loading = on;
  spinner.hidden = !on;
  analyzeLabel.textContent = on ? "Analyzing…" : "✨ Analyze Emotion";
  clearTimeout(slowTimer);
  slowNote.hidden = true;
  if (on) slowTimer = setTimeout(() => { slowNote.hidden = false; }, 6000);
  syncControls();
}

function showError(msg) { errorText.textContent = msg; errorBox.hidden = false; }
function hideError() { errorBox.hidden = true; }

/* ---------- Actions ---------- */
async function analyze() {
  const text = input.value.trim();
  if (!text || loading) return;
  hideError();
  setLoading(true);
  setStage("loading");
  try {
    const result = await predictEmotion(text);
    setStage("result", result);
    stage.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    setStage("idle");
    showError(err.message);
  } finally {
    setLoading(false);
  }
}

function reset() {
  input.value = "";
  hideError();
  setStage("idle");
  syncControls();
  input.focus();
}

/* ---------- Events ---------- */
input.addEventListener("input", syncControls);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    analyze();
  }
});
analyzeBtn.addEventListener("click", analyze);
clearBtn.addEventListener("click", reset);

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    input.value = chip.textContent;
    hideError();
    syncControls();
    input.focus();
  });
});

// light that follows the pointer across crystal surfaces
document.addEventListener("pointermove", (e) => {
  const card = e.target.closest && e.target.closest(".crystal");
  if (!card) return;
  const rect = card.getBoundingClientRect();
  card.style.setProperty("--mx", e.clientX - rect.left + "px");
  card.style.setProperty("--my", e.clientY - rect.top + "px");
});

const menuBtn = $("menuBtn");
const navLinks = $("navLinks");
function closeMenu() {
  navLinks.classList.remove("open");
  menuBtn.setAttribute("aria-expanded", "false");
  menuBtn.textContent = "☰";
}
menuBtn.addEventListener("click", () => {
  const open = navLinks.classList.toggle("open");
  menuBtn.setAttribute("aria-expanded", String(open));
  menuBtn.textContent = open ? "✕" : "☰";
});
navLinks.addEventListener("click", (e) => { if (e.target.tagName === "A") closeMenu(); });

/* ---------- Init ---------- */
setStage("idle");
syncControls();
checkHealth();
setInterval(checkHealth, HEALTH_INTERVAL_MS);
