import type { ReactNode } from "react";

/**
 * A small, safe Markdown view for Coey's general answers: headings, bullet
 * and numbered lists, tables, bold and italics. Text only — never HTML.
 */
function inline(text: string): ReactNode[] {
  return plainMath(text).split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>
      : part.length > 2 && part.startsWith("*") && part.endsWith("*") ? <em key={i}>{part.slice(1, -1)}</em>
        : part,
  );
}

const SYMBOLS: Record<string, string> = {
  times: "×", div: "÷", cdot: "·", approx: "≈", neq: "≠", leq: "≤", geq: "≥", pm: "±", rightarrow: "→", to: "→", infty: "∞", sqrt: "√",
};

/** Index of the brace that closes the one opened at `open`, or -1. */
function closeBrace(src: string, open: number): number {
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}" && --depth === 0) return k;
  }
  return -1;
}

/** Reads one LaTeX argument: a {group} or a single character. */
function readArg(src: string, at: number): [string, number] {
  let k = at;
  while (src[k] === " ") k++;
  if (src[k] === "{") {
    const end = closeBrace(src, k);
    if (end > 0) return [src.slice(k + 1, end), end + 1];
  }
  return [src[k] ?? "", k + 1];
}

/** A small, safe subset of LaTeX (fractions, powers, common symbols) as React nodes. */
function math(src: string, keyBase = "m"): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = "";
  const flush = () => { if (buf) { out.push(buf); buf = ""; } };
  let k = 0;
  while (k < src.length) {
    const ch = src[k]!;
    if (ch === "\\") {
      const m = /^\\([a-zA-Z]+)/.exec(src.slice(k));
      if (!m) { buf += src[k + 1] ?? ""; k += 2; continue; }
      const cmd = m[1]!;
      k += m[0].length;
      if (cmd === "frac") {
        const [a, n1] = readArg(src, k);
        const [b, n2] = readArg(src, n1);
        k = n2;
        flush();
        out.push(
          <span key={`${keyBase}${k}`} className="mx-1 inline-flex flex-col items-center align-middle text-[0.92em] leading-tight">
            <span className="border-b border-slate-500 px-1">{math(a, `${keyBase}a${k}`)}</span>
            <span className="px-1">{math(b, `${keyBase}b${k}`)}</span>
          </span>,
        );
      } else if (cmd === "text" || cmd === "mathrm" || cmd === "mathbf") {
        const [a, n1] = readArg(src, k);
        k = n1;
        buf += a;
      } else if (cmd === "left" || cmd === "right") {
        if (src[k] === ".") k++;
      } else if (SYMBOLS[cmd]) buf += ` ${SYMBOLS[cmd]} `;
      else buf += cmd;
      continue;
    }
    if (ch === "^" || ch === "_") {
      const [a, n1] = readArg(src, k + 1);
      k = n1;
      flush();
      out.push(ch === "^" ? <sup key={`${keyBase}s${k}`}>{math(a, `${keyBase}p${k}`)}</sup> : <sub key={`${keyBase}s${k}`}>{math(a, `${keyBase}p${k}`)}</sub>);
      continue;
    }
    if (ch === "{" || ch === "}") { k++; continue; }
    buf += ch;
    k++;
  }
  flush();
  return out;
}

/** Strips inline math delimiters (\( … \) and $ … $) and renders the contents as plain text. */
function plainMath(text: string): string {
  return text
    .replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, "$1")
    .replace(/\$([^$\n]+)\$/g, "$1")
    .replace(/\\times/g, "×").replace(/\\approx/g, "≈").replace(/\\div/g, "÷").replace(/\\cdot/g, "·");
}

const FORMULA_OPEN = /^(\\\[|\$\$)\s*/;

export function CoeyMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const t = line.trim();
    if (!t) { i++; continue; }
    const open = FORMULA_OPEN.exec(t);
    if (open) {
      const close = open[1] === "$$" ? "$$" : "\\]";
      let body = t.slice(open[0].length);
      let j = i;
      while (!body.includes(close) && j + 1 < lines.length) { j++; body += ` ${lines[j]!.trim()}`; }
      const end = body.indexOf(close);
      const formula = (end >= 0 ? body.slice(0, end) : body).trim();
      out.push(
        <div key={`f${i}`} className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-center font-serif text-[15px] text-slate-900">
          {math(formula, `f${i}`)}
        </div>,
      );
      i = j + 1;
      continue;
    }
    if (/^#{1,4}\s/.test(t)) { out.push(<p key={i} className="mt-2 text-[13.5px] font-semibold text-slate-900">{inline(t.replace(/^#+\s*/, ""))}</p>); i++; continue; }
    if (t.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        const cells = lines[i]!.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <div key={`t${i}`} className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-xs">
            {head ? <thead className="bg-slate-50 text-slate-600"><tr>{head.map((c, j) => <th key={j} className="px-2.5 py-1.5 font-semibold">{inline(c)}</th>)}</tr></thead> : null}
            <tbody className="divide-y divide-slate-100">{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} className="px-2.5 py-1.5 text-slate-700">{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^([-*•]|\d+[.)])\s/.test(t)) {
      const ordered = /^\d/.test(t);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s/.test(lines[i]!)) { items.push(lines[i]!.trim().replace(/^([-*•]|\d+[.)])\s+/, "")); i++; }
      const List = ordered ? "ol" : "ul";
      out.push(<List key={`l${i}`} className={ordered ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5"}>{items.map((it, k) => <li key={k}>{inline(it)}</li>)}</List>);
      continue;
    }
    out.push(<p key={i}>{inline(t)}</p>);
    i++;
  }
  return <div className="space-y-2 text-sm leading-relaxed text-slate-700">{out}</div>;
}
