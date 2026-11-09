// Battleground — Stage 3: real verdict from /api/fight. Images are still
// placeholders until image generation is added.

const MAX_NAME_LENGTH = 60;
const FIGHT_TIMEOUT_MS = 60_000;

const views = {
  form: document.getElementById("view-form"),
  loading: document.getElementById("view-loading"),
  result: document.getElementById("view-result"),
  error: document.getElementById("view-error"),
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
};

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

// Simple SVG placeholder so the image slots have something to show.
function placeholderImage(label, color) {
  const text = label.slice(0, 18).replace(/[<>&"]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
    <rect width="100%" height="100%" fill="${color}"/>
    <text x="50%" y="50%" fill="#fff" font-family="sans-serif" font-size="18"
          text-anchor="middle" dominant-baseline="middle">${text}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// Messages for each error code the API returns, so each failure type reads
// differently in the UI.
const ERROR_MESSAGES = {
  rate_limited: "Whoa, slow down! You've hit the limit of 5 fights per minute.",
  verdict_failed: "The judges couldn't reach a verdict. Please try again.",
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

  return {
    winner: data.winner,
    reasoning: data.reasoning,
    // Image generation comes later; fall back to placeholders until then.
    imageA: data.imageA || placeholderImage(fighterA, "#3b6fd9"),
    imageB: data.imageB || placeholderImage(fighterB, "#d93a2b"),
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
    renderResult(fighterA, fighterB, result);
    showView("result");
  } catch (err) {
    els.errorMessage.textContent = err.message || "Something went wrong. Please try again.";
    showView("error");
  }
});

// "New fight" / "Try again" buttons return to the form, keeping the typed names.
document.addEventListener("click", (event) => {
  if (event.target.closest('[data-action="new-fight"]')) {
    showView("form");
    inputA.focus();
  }
});

showView("form");
