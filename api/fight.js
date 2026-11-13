// POST /api/fight  { fighterA, fighterB }
//   -> { winner: "A"|"B", reasoning, imageA, imageB }
//
// Stage 3: rate limit by IP, then run the Claude verdict and both OpenAI
// images in parallel. The verdict's output shape is enforced by a zod schema
// via structured outputs. Images come back as data URLs.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import OpenAI from "openai";
import { z } from "zod";
import {
  JUDGE_SYSTEM_PROMPT,
  buildJudgeUserMessage,
  sanitizeFighter,
} from "./_lib/judge-prompt.js";
import { buildImagePrompt } from "./_lib/image-prompt.js";
import { checkRateLimit, getClientIp } from "./_lib/rate-limit.js";

const VERDICT_MODEL = "claude-sonnet-5-5";
const IMAGE_MODEL = "gpt-image-2";

const VerdictSchema = z.object({
  winner: z.enum(["A", "B"]),
  reasoning: z.string(),
});

// Both clients read their keys from the environment (.env locally):
// ANTHROPIC_API_KEY and OPENAI_API_KEY.
const anthropic = new Anthropic();
const openai = new OpenAI();

// Error codes the frontend maps to distinct messages.
function sendError(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

class ImageModerationError extends Error {}

async function getVerdict(fighterA, fighterB) {
  const response = await anthropic.beta.messages.parse({
    model: VERDICT_MODEL,
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

// One image per fighter, returned as a data URL.
async function getImage(fighter) {
  try {
    const result = await openai.images.generate({
      model: IMAGE_MODEL,
      prompt: buildImagePrompt(fighter),
      n: 1,
      size: "1024x1024",
      quality: "medium",
      output_format: "webp",
      output_compression: 80,
    });
    const b64 = result.data?.[0]?.b64_json;
    if (!b64) throw new Error("Image response had no image data");
    return `data:image/webp;base64,${b64}`;
  } catch (err) {
    // OpenAI rejects prompts its safety system blocks with a 400 and one of
    // these codes; surface that separately from a generic image failure.
    if (
      err instanceof OpenAI.BadRequestError &&
      (err.code === "moderation_blocked" || err.code === "content_policy_violation")
    ) {
      throw new ImageModerationError(err.message);
    }
    throw err;
  }
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

  // All three calls are independent, so run them together.
  const [verdict, imageA, imageB] = await Promise.allSettled([
    getVerdict(fighterA, fighterB),
    getImage(fighterA),
    getImage(fighterB),
  ]);

  if (verdict.status === "rejected") {
    console.error("[fight] verdict failed:", verdict.reason);
    return sendError(
      res,
      502,
      "verdict_failed",
      "The judges couldn't reach a verdict. Please try again.",
    );
  }

  const failedImages = [imageA, imageB].filter((r) => r.status === "rejected");
  if (failedImages.length > 0) {
    for (const r of failedImages) console.error("[fight] image failed:", r.reason);
    if (failedImages.some((r) => r.reason instanceof ImageModerationError)) {
      return sendError(
        res,
        422,
        "moderation_blocked",
        "The art department refused to draw one of these fighters. Try different fighters.",
      );
    }
    return sendError(
      res,
      502,
      "image_failed",
      "The fighters' portraits couldn't be painted. Please try again.",
    );
  }

  return res.status(200).json({
    winner: verdict.value.winner,
    reasoning: verdict.value.reasoning,
    imageA: imageA.value,
    imageB: imageB.value,
  });
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
