/**
 * Unit checks for latin-covering unicode-range scoring — the wallofportfolios
 * invisible-text failure mode (Google Fonts Inter cyrillic-ext vs latin).
 */
import assert from "node:assert/strict";

function unicodeRangeCoversBasicLatin(range) {
  const s = String(range || "").trim();
  if (!s) return true;
  const upper = s.toUpperCase();
  const re = /U\+([0-9A-F]{1,6})(?:-([0-9A-F]{1,6}))?/g;
  let m;
  while ((m = re.exec(upper)) !== null) {
    const start = parseInt(m[1], 16);
    const end = m[2] ? parseInt(m[2], 16) : start;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start <= 0x20 && end >= 0x20) return true;
    if (start <= 0x30 && end >= 0x39) return true;
    if (start <= 0x41 && end >= 0x41) return true;
    if (start <= 0x61 && end >= 0x61) return true;
  }
  return false;
}

assert.equal(unicodeRangeCoversBasicLatin(""), true);
assert.equal(unicodeRangeCoversBasicLatin("U+0000-00FF"), true);
assert.equal(
  unicodeRangeCoversBasicLatin("U+0000-00FF, U+0131, U+0152-0153"),
  true
);
assert.equal(
  unicodeRangeCoversBasicLatin(
    "U+0460-052F, U+1C80-1C88, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F"
  ),
  false,
  "cyrillic-ext must NOT cover basic Latin"
);
assert.equal(unicodeRangeCoversBasicLatin("U+0370-03FF"), false);

console.log("verify-font-latin-subset: ok");
