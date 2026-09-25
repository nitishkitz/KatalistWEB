/**
 * D03/T08: WCAG contrast measurement for this app's OKLCH design tokens.
 * Everything here is pure math (OKLCH -> linear sRGB -> WCAG relative
 * luminance -> contrast ratio) so it can be asserted on in a plain
 * node:test, rather than inferred from a screenshot or from font size
 * alone (the plan explicitly warns against both).
 *
 * OKLab/OKLCH -> linear sRGB matrices are Björn Ottosson's published
 * constants (https://bottosson.github.io/posts/oklab/). WCAG relative
 * luminance (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance) is
 * defined directly in terms of *linear* RGB -- the matrices below already
 * produce linear values, so no separate sRGB gamma decode step is needed.
 */

/** Parses "oklch(L C H)" or "oklch(L C H / A%)" -- this codebase's only
 *  token format in styles.css. Alpha is ignored: every measured pair here
 *  is an opaque foreground against an opaque background. */
export function parseOklch(value) {
  const m = value.trim().match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!m) throw new Error(`Not a recognized oklch() value: ${value}`);
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) };
}

function oklchToLinearSrgb({ l, c, h }) {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b;

  const l3 = l_ ** 3;
  const m3 = m_ ** 3;
  const s3 = s_ ** 3;

  return {
    r: +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3,
  };
}

/** WCAG relative luminance, computed straight from linear RGB (clamped to
 *  the physically valid [0, 1] range -- an out-of-gamut OKLCH value can
 *  otherwise produce a negative or >1 channel). */
function relativeLuminance(linear) {
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const r = clamp(linear.r);
  const g = clamp(linear.g);
  const b = clamp(linear.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function oklchLuminance(value) {
  return relativeLuminance(oklchToLinearSrgb(parseOklch(value)));
}

/** WCAG contrast ratio between two oklch() color strings, in the standard
 *  1:1 to 21:1 range (lighter over darker). */
export function contrastRatio(colorA, colorB) {
  const lA = oklchLuminance(colorA);
  const lB = oklchLuminance(colorB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

export const WCAG_AA_NORMAL_TEXT = 4.5;
export const WCAG_AA_LARGE_TEXT = 3.0;
/** Non-text UI components / graphical objects (WCAG 1.4.11). */
export const WCAG_AA_UI_COMPONENT = 3.0;
