import assert from "node:assert/strict";
import test from "node:test";
import { validateKatalistSvg } from "@/features/court/katalist-icon-contract";

const validSvg = `
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 12h18" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
`;

test("the approved SVG constitution accepts a monochrome 24px rounded-stroke icon", () => {
  assert.deepEqual(validateKatalistSvg(validSvg), []);
});

test("the SVG constitution rejects hard-coded colors, wrong geometry, and embedded content", () => {
  const invalid = `
    <svg viewBox="0 0 32 32">
      <path stroke="#5B4CF0" stroke-width="2" stroke-linecap="square" d="M0 0h3" />
      <image href="icon.png" />
      <text>!</text>
    </svg>
  `;
  assert.deepEqual(validateKatalistSvg(invalid), [
    "viewBox must be 0 0 24 24",
    "strokes must use currentColor",
    "stroke-width must be 1.75",
    "stroke-linecap must be round",
    "stroke-linejoin must be round",
    "external references are not allowed",
    "embedded raster images are not allowed",
    "text elements are not allowed",
  ]);
});

test("the SVG constitution rejects a mixed hard-coded path and unsafe executable markup", () => {
  const mixed = `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 12h18" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M12 3v18" stroke="#ff0000" fill="#ffffff" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" onclick="alert(1)" />
      <script>alert(1)</script>
    </svg>
  `;
  assert.deepEqual(validateKatalistSvg(mixed), [
    "strokes must use currentColor",
    "fills must use currentColor or none",
    "unsafe SVG elements are not allowed",
    "event handler attributes are not allowed",
  ]);
});

test("the SVG constitution rejects CSS-injected paint and external references", () => {
  const styled = `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 12h18" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
      <style>path { stroke: #ff0000; }</style>
      <use href="https://example.com/icons.svg#mark" />
    </svg>
  `;
  assert.deepEqual(validateKatalistSvg(styled), [
    "unsafe SVG elements are not allowed",
    "external references are not allowed",
  ]);
});
