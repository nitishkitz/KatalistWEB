import type { ReactNode } from "react";

/**
 * A small, safe Markdown view for Coey's general answers: headings, bullet
 * and numbered lists, tables, bold and italics. Text only — never HTML.
 */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>
      : part.length > 2 && part.startsWith("*") && part.endsWith("*") ? <em key={i}>{part.slice(1, -1)}</em>
        : part,
  );
}

export function CoeyMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const t = line.trim();
    if (!t) { i++; continue; }
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
