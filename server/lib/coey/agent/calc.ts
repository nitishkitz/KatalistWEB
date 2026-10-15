import type { CalculationBlock } from "../../../../src/domain/coey/presentation";

/**
 * Exact arithmetic for the Ask agent. The model never does sums itself: it
 * calls these and quotes the figures, so the answer card and the text agree.
 */
const grouped = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 });
const money = (symbol: string, n: number) => `${symbol}${grouped.format(Math.round(n))}`;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

/** Reducing-balance loan EMI: P × r × (1+r)^n ÷ ((1+r)^n − 1). */
export function loanEmi(a: { principal: unknown; annual_rate_percent: unknown; years?: unknown; months?: unknown; currency?: unknown }): { block: CalculationBlock; facts: Record<string, unknown> } | { error: string } {
  const { principal, annual_rate_percent: rate } = a;
  const n = finite(a.months) && a.months > 0 ? Math.round(a.months) : finite(a.years) && a.years > 0 ? Math.round(a.years * 12) : 0;
  if (!finite(principal) || principal <= 0 || !finite(rate) || !n) return { error: "needs principal > 0, annual_rate_percent >= 0 and years or months > 0" };
  const symbol = typeof a.currency === "string" && a.currency.trim() ? a.currency.trim().slice(0, 3) : "₹";
  const r = rate / 12 / 100;
  const growth = (1 + r) ** n;
  const emi = r === 0 ? principal / n : (principal * r * growth) / (growth - 1);
  const total = emi * n;
  const interest = total - principal;
  const block: CalculationBlock = {
    type: "calculation",
    title: "Loan EMI",
    headline: { label: "Monthly EMI", value: money(symbol, emi) },
    split: { principal: Math.round(principal), interest: Math.round(interest), principal_label: money(symbol, principal), interest_label: money(symbol, interest) },
    stats: [
      { label: "Loan amount", value: money(symbol, principal) },
      { label: "Interest rate", value: `${decimal.format(rate)}% a year` },
      { label: "Tenure", value: n % 12 === 0 ? `${n / 12} years (${n} months)` : `${n} months` },
      { label: "Total interest", value: money(symbol, interest) },
      { label: "Total payment", value: money(symbol, total) },
    ],
    formula: "EMI = P × r × (1 + r)^n ÷ ((1 + r)^n − 1)",
    steps: [
      `P = ${money(symbol, principal)}`,
      `r = ${decimal.format(rate)}% ÷ 12 = ${decimal.format(r * 100)}% a month`,
      `n = ${n} months`,
      `(1 + r)^n = ${decimal.format(growth)}`,
      `EMI = ${money(symbol, emi)}`,
    ],
    note: "A bank may round the EMI slightly. Processing fees and insurance are extra.",
  };
  return { block, facts: { emi: Math.round(emi), total_payment: Math.round(total), total_interest: Math.round(interest), months: n, headline: `Your EMI is ${money(symbol, emi)} per month` } };
}

/** + − × ÷ ^ % and brackets only; no identifiers, so nothing can be executed. */
export function evaluate(expression: string): number | null {
  const src = expression.replace(/[×x]/g, "*").replace(/÷/g, "/").replace(/,/g, "").replace(/\s+/g, "");
  if (!src || !/^[0-9+\-*/().%^]+$/.test(src)) return null;
  let i = 0;
  const peek = () => src[i];
  const number = (): number => {
    if (peek() === "(") { i++; const v = sum(); if (peek() !== ")") throw new Error("bracket"); i++; return percent(v); }
    const m = /^\d*\.?\d+/.exec(src.slice(i));
    if (!m) throw new Error("number");
    i += m[0].length;
    return percent(Number(m[0]));
  };
  const percent = (v: number) => { while (peek() === "%") { i++; v /= 100; } return v; };
  const unary = (): number => { if (peek() === "-") { i++; return -unary(); } if (peek() === "+") { i++; return unary(); } return power(); };
  const power = (): number => { const b = number(); if (peek() === "^") { i++; return b ** unary(); } return b; };
  const product = (): number => { let v = unary(); while (peek() === "*" || peek() === "/") { const op = src[i++]; const r = unary(); v = op === "*" ? v * r : v / r; } return v; };
  const sum = (): number => { let v = product(); while (peek() === "+" || peek() === "-") { const op = src[i++]; const r = product(); v = op === "+" ? v + r : v - r; } return v; };
  try {
    const v = sum();
    return i === src.length && Number.isFinite(v) ? v : null;
  } catch { return null; }
}

export function calculate(expression: string): { block: CalculationBlock; facts: Record<string, unknown> } | { error: string } {
  const value = evaluate(expression);
  if (value === null) return { error: "could not evaluate; use numbers with + - × ÷ ^ % and brackets only" };
  const shown = decimal.format(value);
  return {
    block: { type: "calculation", title: "Calculation", headline: { label: "Result", value: shown }, stats: [], formula: expression.trim().slice(0, 200), steps: [], note: undefined },
    facts: { value, formatted: shown, headline: `${expression.trim().slice(0, 80)} = ${shown}` },
  };
}
