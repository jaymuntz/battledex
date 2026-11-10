// Battleground: verdict and fighter art from /api/fight, plus the BattleDex
// (saved fighters in localStorage).

const MAX_NAME_LENGTH = 60;
// Verdict plus two images can take a while; give it room before giving up.
const FIGHT_TIMEOUT_MS = 120_000;

const views = {
  form: document.getElementById("view-form"),
  loading: document.getElementById("view-loading"),
  result: document.getElementById("view-result"),
  error: document.getElementById("view-error"),
  dex: document.getElementById("view-dex"),
};

const form = document.getElementById("fight-form");
const inputA = document.getElementById("fighter-a");
const inputB = document.getElementById("fighter-b");
const formMessage = document.getElementById("form-message");

const els = {
  nameA: document.getElementById("name-a"),
  nameB: document.getElementById("name-b"),
  imageA: document.getElementById("image-a"),
  imageB: document.getElementById("image-b"),
  winnerName: document.getElementById("winner-name"),
  reasoning: document.getElementById("reasoning"),
  errorMessage: document.getElementById("error-message"),
  saveMessage: document.getElementById("save-message"),
  saveButtons: document.querySelectorAll('[data-action="save"]'),
  dexGrid: document.getElementById("dex-grid"),
  dexEmpty: document.getElementById("dex-empty"),
  clearDex: document.querySelector('[data-action="clear-dex"]'),
  backToFight: document.getElementById("back-to-fight"),
};

// The most recent fight, kept in memory so the BattleDex can jump back to it.
// Shape: { fighterA, fighterB, result }. Not persisted across reloads.
let lastFight = null;

// Show exactly one view; hide all others.
function showView(name) {
  for (const [key, el] of Object.entries(views)) {
    el.hidden = key !== name;
  }
}

function validate(a, b) {
  inputA.removeAttribute("aria-invalid");
  inputB.removeAttribute("aria-invalid");

  if (!a || !b) {
    if (!a) inputA.setAttribute("aria-invalid", "true");
    if (!b) inputB.setAttribute("aria-invalid", "true");
    (!a ? inputA : inputB).focus();
    return "Enter a fighter on both sides.";
  }
  if (a.length > MAX_NAME_LENGTH || b.length > MAX_NAME_LENGTH) {
    return `Fighter names must be ${MAX_NAME_LENGTH} characters or fewer.`;
  }
  return "";
}

// Messages for each error code the API returns, so each failure type reads
// differently in the UI.
const ERROR_MESSAGES = {
  rate_limited: "Whoa, slow down! You've hit the limit of 5 fights per minute.",
  verdict_failed: "The judges couldn't reach a verdict. Please try again.",
  image_failed: "The fighters' portraits couldn't be painted. Please try again.",
  moderation_blocked: "The art department refused to draw one of these fighters. Try different fighters.",
  invalid_input: "Enter a fighter on both sides.",
  timeout: "The judges took too long to decide. Please try again.",
  network: "Couldn't reach the arena. Check your connection and try again.",
};

class FightError extends Error {
  constructor(code, message) {
    super(message || ERROR_MESSAGES[code] || "Something went wrong. Please try again.");
    this.code = code;
  }
}

// Calls the fight API. Resolves to { winner, reasoning, imageA, imageB }.
async function fight(fighterA, fighterB) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FIGHT_TIMEOUT_MS);

  let response;
  try {
    response = await fetch("/api/fight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fighterA, fighterB }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new FightError(err.name === "AbortError" ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const code = data?.error?.code || (response.status === 429 ? "rate_limited" : "verdict_failed");
    // Prefer the server's message for 429 since it includes the retry time.
    throw new FightError(code, code === "rate_limited" ? data?.error?.message : undefined);
  }
  if (!data || (data.winner !== "A" && data.winner !== "B") || typeof data.reasoning !== "string") {
    throw new FightError("verdict_failed");
  }
  if (typeof data.imageA !== "string" || typeof data.imageB !== "string") {
    throw new FightError("image_failed");
  }

  return {
    winner: data.winner,
    reasoning: data.reasoning,
    imageA: data.imageA,
    imageB: data.imageB,
  };
}

function renderResult(fighterA, fighterB, result) {
  els.nameA.textContent = fighterA;
  els.nameB.textContent = fighterB;
  els.imageA.src = result.imageA;
  els.imageA.alt = `Art of ${fighterA}`;
  els.imageB.src = result.imageB;
  els.imageB.alt = `Art of ${fighterB}`;
  els.winnerName.textContent = result.winner === "A" ? fighterA : fighterB;
  els.reasoning.textContent = result.reasoning;

  // Fresh fight: both fighters can be saved again.
  els.saveMessage.textContent = "";
  for (const btn of els.saveButtons) {
    btn.disabled = false;
    btn.textContent = "Save to BattleDex";
  }
}

// ---------- BattleDex (localStorage) ----------

const DEX_STORAGE_KEY = "battleground.battledex";

// Returns the saved fighters as an array of { label, image }. Bad or missing
// data reads as an empty BattleDex rather than breaking the page.
function loadDex() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DEX_STORAGE_KEY));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry) => entry && typeof entry.label === "string" && typeof entry.image === "string",
    );
  } catch {
    return [];
  }
}

// Throws if the browser refuses the write (usually the storage quota).
function writeDex(entries) {
  localStorage.setItem(DEX_STORAGE_KEY, JSON.stringify(entries));
}

// Saved images are shrunk before they go into localStorage (about 5MB per
// origin). The API returns 1024px images; cards show at ~140-200 CSS px, so
// 320px still looks sharp on high-DPI screens at a fraction of the size.
const DEX_IMAGE_SIZE = 320;
const DEX_IMAGE_QUALITY = 0.8;

// Draws the image to an off-screen canvas at DEX_IMAGE_SIZE and re-exports it
// as WebP (JPEG where the browser can't encode WebP). Resolves to a data URL.
async function compressImage(src) {
  const img = new Image();
  img.src = src;
  await img.decode();

  // Fit the longer side to DEX_IMAGE_SIZE; never upscale.
  const scale = Math.min(1, DEX_IMAGE_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // toDataURL silently falls back to PNG for unsupported types (Safari < 17
  // can't encode WebP), so check what came back.
  let compressed = canvas.toDataURL("image/webp", DEX_IMAGE_QUALITY);
  if (!compressed.startsWith("data:image/webp")) {
    compressed = canvas.toDataURL("image/jpeg", DEX_IMAGE_QUALITY);
  }

  // Very flat art can already be tiny; never store a bigger copy.
  return compressed.length < src.length ? compressed : src;
}

async function saveFighter(side) {
  if (!lastFight) return;
  const fight = lastFight;
  const label = side === "A" ? fight.fighterA : fight.fighterB;
  const original = side === "A" ? fight.result.imageA : fight.result.imageB;
  const button = document.querySelector(`[data-action="save"][data-side="${side}"]`);

  // Block double-clicks while compressing.
  button.disabled = true;
  button.textContent = "Saving…";

  let image;
  try {
    image = await compressImage(original);
  } catch (err) {
    console.error("[battledex] compression failed:", err);
    if (fight === lastFight) {
      button.disabled = false;
      button.textContent = "Save to BattleDex";
      els.saveMessage.textContent = "Couldn't save that fighter's art. Please try again.";
    }
    return;
  }

  try {
    writeDex([...loadDex(), { label, image }]);
  } catch (err) {
    console.error("[battledex] save failed:", err);
    if (fight === lastFight) {
      button.disabled = false;
      button.textContent = "Save to BattleDex";
      els.saveMessage.textContent = "Couldn't save: your BattleDex is full. Delete some fighters and try again.";
    }
    return;
  }

  // A new fight may have started while compressing; don't touch its buttons.
  if (fight !== lastFight) return;
  button.textContent = "Saved!";
  els.saveMessage.textContent = `${label} added to your BattleDex.`;
}

function deleteFighter(index) {
  const entries = loadDex();
  entries.splice(index, 1);
  writeDex(entries);
  renderDex();
}

function clearDex() {
  if (!confirm("Delete every fighter in your BattleDex?")) return;
  localStorage.removeItem(DEX_STORAGE_KEY);
  renderDex();
}

// Builds the card grid. Labels go in via textContent since they're user input.
function renderDex() {
  const entries = loadDex();
  els.dexGrid.replaceChildren(
    ...entries.map((entry, index) => {
      const card = document.createElement("li");
      card.className = "dex-card";

      const img = document.createElement("img");
      img.src = entry.image;
      img.alt = `Art of ${entry.label}`;
      img.loading = "lazy";

      const name = document.createElement("p");
      name.className = "dex-card-name";
      name.textContent = entry.label;

      const del = document.createElement("button");
      del.type = "button";
      del.className = "dex-card-delete";
      del.dataset.action = "delete-fighter";
      del.dataset.index = String(index);
      del.setAttribute("aria-label", `Delete ${entry.label}`);
      del.textContent = "×";

      card.append(img, name, del);
      return card;
    }),
  );

  els.dexEmpty.hidden = entries.length > 0;
  els.dexGrid.hidden = entries.length === 0;
  els.clearDex.hidden = entries.length === 0;
  els.backToFight.hidden = !lastFight;
}

function openDex() {
  renderDex();
  showView("dex");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const fighterA = inputA.value.trim();
  const fighterB = inputB.value.trim();

  const problem = validate(fighterA, fighterB);
  formMessage.textContent = problem;
  if (problem) return;

  showView("loading");

  try {
    const result = await fight(fighterA, fighterB);
    lastFight = { fighterA, fighterB, result };
    renderResult(fighterA, fighterB, result);
    showView("result");
  } catch (err) {
    els.errorMessage.textContent = err.message || "Something went wrong. Please try again.";
    showView("error");
  }
});

// All buttons are wired through their data-action attribute.
document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;

  switch (target.dataset.action) {
    case "new-fight":
      // Back to the form, keeping the typed names.
      showView("form");
      inputA.focus();
      break;
    case "open-dex":
      openDex();
      break;
    case "back-to-fight":
      // The result view's DOM still holds the last fight.
      if (lastFight) showView("result");
      break;
    case "save":
      saveFighter(target.dataset.side);
      break;
    case "delete-fighter":
      deleteFighter(Number(target.dataset.index));
      break;
    case "clear-dex":
      clearDex();
      break;
  }
});

showView("form");
