# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Battleground: type two fighters, get a Claude-judged verdict (winner + reasoning) and OpenAI-generated pixel art for each side. Stack is plain HTML/CSS/vanilla JS on the frontend, Vercel serverless functions in `api/`, localStorage for the BattleDex. No framework, no bundler, no build step, no tests or linter yet.

- `project-brief.md`: scope, MVP, and decided details (rate limit 5 req/min per IP, one image per side even for groups, client-side image compression before saving).
- `project-build.md`: the staged build plan. Work one stage at a time and don't start stage N+1 until stage N works. Each stage's checklist is the spec for that stage. The checkboxes don't reliably show what is built (Stages 4–6 are ticked but not implemented), so check the code.
- Everything is built and tested locally. Deploying to Vercel happens only in Stage 7.

## Commands

- `npm start`: runs `vercel dev` (static site + `api/` functions, reads `.env`)
- `npm run serve:static`: static frontend only on port 3000, no API

API keys (Anthropic, OpenAI) go in `.env` (gitignored) and are only read inside `api/` functions, never in client code.

## Architecture

**Frontend (`index.html`, `script.js`, `style.css`).** One page with four `<section class="view">` elements: form, loading, result, error. `showView(name)` in `script.js` sets the `hidden` attribute so exactly one view is visible at a time, and new views (e.g. BattleDex) should follow the same pattern. Buttons are wired through delegated clicks on `data-action` attributes. `fight()` POSTs to `/api/fight` and maps the API's `error.code` (`rate_limited`, `verdict_failed`, `invalid_input`) plus client-side `timeout`/`network` to distinct messages via `ERROR_MESSAGES`. Its result shape `{ winner: "A"|"B", reasoning, imageA, imageB }` is the contract the UI renders. Images fall back to SVG placeholders until image generation is added.

**Backend (`api/`).** Vercel turns each file in `api/` into an endpoint, but skips underscore-prefixed paths, so shared modules live in `api/_lib/`. The planned single endpoint is `api/fight.js`, which does this per request: rate-limit check first (by IP), then the Claude verdict call and OpenAI image calls. Distinct error types (verdict failure, image failure, moderation block, 429) must reach the UI as different messages.

**Judge prompt (`api/_lib/judge-prompt.js`).** Exports `JUDGE_SYSTEM_PROMPT`, `buildJudgeUserMessage(a, b)`, and `sanitizeFighter()`. Fighter text is untrusted and is placed inside `<fighter_a>`/`<fighter_b>` tags, with `<`/`>` stripped, as a prompt-injection defence. The judge must always pick exactly one winner and returns `winner` as the side label `"A"`/`"B"`, not the name, so mirrored matchups (cow vs cow) stay unambiguous. Enforce the verdict output with a zod schema (`winner: z.enum(["A","B"])`, `reasoning: z.string()`), not JSON-format instructions in the prompt.

**Image prompts.** Every OpenAI image prompt must append the shared art-style template quoted in `project-build.md` Stage 3 (16-bit pixel art, plain solid background, no text). Group fighters ("10 cows") produce one image via the prompt, not by looping.

## Gotchas

- The rate limiter (`api/_lib/rate-limit.js`) keeps counts in memory, so on Vercel the limit is per warm instance, not global. Move it to a shared store before relying on it in production.
- Name length limits differ: the client caps names at 60 chars (`MAX_NAME_LENGTH` and the input `maxlength`), and the server truncates at 100 (`MAX_FIGHTER_LENGTH`). Keep the server limit at or above the client limit.
