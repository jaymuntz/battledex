// Image prompt for each fighter's art (Stage 3).
// Every prompt ends with the shared art-style template from project-build.md
// so both sides look like they come from the same game.

import { sanitizeFighter } from "./judge-prompt.js";

export const ART_STYLE =
  "16-bit pixel art illustration, retro video game sprite style, bold outlined pixels, vibrant limited color palette, dynamic action pose. Depicted as one cohesive image, centered, filling most of the frame, isolated on a plain solid color background with no scenery. No text, words, letters, numbers, logos, watermarks, UI elements, borders, or frames.";

// Group fighters ("10 cows") get one image showing the whole group, handled
// here in the prompt rather than by generating several images.
export function buildImagePrompt(fighter) {
  return `A fighter in an arena battle game: ${sanitizeFighter(fighter)}. If this fighter is a group or a number of things, show the whole group together in this single image.

${ART_STYLE}`;
}
