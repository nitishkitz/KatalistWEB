function attributeValues(svg: string, name: string) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "gi");
  return [...svg.matchAll(pattern)].map((match) => match[1]!.trim());
}

export function validateKatalistSvg(svg: string) {
  const errors: string[] = [];
  const root = svg.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const strokes = attributeValues(svg, "stroke");
  const fills = attributeValues(svg, "fill");
  const widths = attributeValues(svg, "stroke-width");
  const caps = attributeValues(svg, "stroke-linecap");
  const joins = attributeValues(svg, "stroke-linejoin");

  if (attributeValues(root, "viewBox")[0] !== "0 0 24 24") errors.push("viewBox must be 0 0 24 24");
  if (strokes.length === 0 || strokes.some((value) => value.toLowerCase() !== "currentcolor")) {
    errors.push("strokes must use currentColor");
  }
  if (fills.some((value) => !["currentcolor", "none"].includes(value.toLowerCase()))) {
    errors.push("fills must use currentColor or none");
  }
  if (widths.length === 0 || widths.some((value) => value !== "1.75"))
    errors.push("stroke-width must be 1.75");
  if (caps.length === 0 || caps.some((value) => value.toLowerCase() !== "round")) {
    errors.push("stroke-linecap must be round");
  }
  if (joins.length === 0 || joins.some((value) => value.toLowerCase() !== "round")) {
    errors.push("stroke-linejoin must be round");
  }
  if (/<(?:script|style|use|foreignObject|iframe|object|embed)\b/i.test(svg)) {
    errors.push("unsafe SVG elements are not allowed");
  }
  if (/\b(?:href|xlink:href)\s*=/i.test(svg)) errors.push("external references are not allowed");
  if (/\son[a-z]+\s*=/i.test(svg)) errors.push("event handler attributes are not allowed");
  if (/\sstyle\s*=/i.test(svg)) errors.push("style attributes are not allowed");
  if (/<image\b/i.test(svg)) errors.push("embedded raster images are not allowed");
  if (/<text\b/i.test(svg)) errors.push("text elements are not allowed");
  return errors;
}
