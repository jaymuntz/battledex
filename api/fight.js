// POST /api/fight  { fighterA, fighterB }  ->  { winner: "A"|"B", reasoning }
//
// Stage 3 (verdict path only): rate limit by IP, then ask Claude for the
// verdict with the output shape enforced by a zod schema via structured
// outputs. Image generation is added later.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  JUDGE_SYSTEM_PROMPT,
  buildJudgeUserMessage,
  sanitizeFighter,
} from "./_lib/judge-prompt.js";
import { checkRateLimit, getClientIp } from "./_lib/rate-limit.js";

const MODEL = "claude-sonnet-5-5";

const VerdictSchema = z.object({
  winner: z.enum(["A", "B"]),
  reasoning: z.string(),
});

// Reads ANTHROPIC_API_KEY from the environment (.env locally).
const anthropic = new Anthropic();

// Error codes the frontend maps to distinct messages.
function sendError(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

async function getVerdict(fighterA, fighterB) {
  const response = await anthropic.beta.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    system: JUDGE_SYSTEM_PROMPT,
    messages: [
      { role: "user", content: buildJudgeUserMessage(fighterA, fighterB) },
    ],
    output_config: {
      effort: "low",
      format: betaZodOutputFormat(VerdictSchema),
    },
    // If a safety classifier declines, the API retries on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`Verdict refused (${response.stop_details?.category ?? "unknown"})`);
  }
  if (!response.parsed_output) {
    throw new Error(`Verdict did not match schema (stop_reason: ${response.stop_reason})`);
  }
  return response.parsed_output;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendError(res, 405, "method_not_allowed", "Use POST.");
  }

  // Rate limit first, before any paid API call.
  const limit = checkRateLimit(getClientIp(req));
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfterSeconds));
    return sendError(
      res,
      429,
      "rate_limited",
      `Too many fights. Try again in ${limit.retryAfterSeconds} seconds.`,
    );
  }

  const body = typeof req.body === "string" ? safeJson(req.body) : req.body;
  const fighterA = sanitizeFighter(body?.fighterA);
  const fighterB = sanitizeFighter(body?.fighterB);
  if (!fighterA || !fighterB) {
    return sendError(res, 400, "invalid_input", "Enter a fighter on both sides.");
  }

  try {
    const verdict = await getVerdict(fighterA, fighterB);
    return res.status(200).json(verdict);
  } catch (err) {
    console.error("[fight] verdict failed:", err);
    return sendError(
      res,
      502,
      "verdict_failed",
      "The judges couldn't reach a verdict. Please try again.",
    );
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
