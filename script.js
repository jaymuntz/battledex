// Battleground — Stage 1: static UI shell with mock data. No network calls yet.

const MAX_NAME_LENGTH = 60;
const FAKE_DELAY_MS = 1500;

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

// Stand-in for the real /api/fight call (Stage 3).
// Type "error" as either fighter to preview the error view.
function fakeFight(fighterA, fighterB) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if ([fighterA, fighterB].some((f) => f.toLowerCase() === "error")) {
        reject(new Error("Mock failure: the judges walked out."));
        return;
      }
      const winner = Math.random() < 0.5 ? "A" : "B";
      const winnerName = winner === "A" ? fighterA : fighterB;
      resolve({
        winner,
        reasoning: `Placeholder reasoning: ${winnerName} wins this mock fight. Real verdicts from the judge arrive in Stage 3.`,
        imageA: placeholderImage(fighterA, "#3b6fd9"),
        imageB: placeholderImage(fighterB, "#d93a2b"),
      });
    }, FAKE_DELAY_MS);
  });
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
    const result = await fakeFight(fighterA, fighterB);
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
