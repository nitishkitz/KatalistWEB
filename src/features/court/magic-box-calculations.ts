/** Local calculation grammar. Full-input matches keep amounts in tasks from becoming calculations. */
export type Calculation = {
  title: string;
  result: string;
  detail: string;
  value?: number;
  error?: boolean;
};

const number = "([0-9]+(?:\\.[0-9]+)?)";
const amount = `${number}\\s*(lakh|lakhs|crore|crores|k)?`;
const money = (text: string) => /₹|\brs\.?\b|\binr\b/i.test(text);
const fmt = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 8 }).format(n);
const cash = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
const scaled = (n: string, unit?: string) => Number(n) * ({ lakh: 1e5, lakhs: 1e5, crore: 1e7, crores: 1e7, k: 1e3 }[unit ?? ""] ?? 1);
const failure = (detail: string): Calculation => ({ title: "Calculation", result: "Check the calculation", detail, error: true });
function answer(title: string, value: number, detail: string, currency = false): Calculation {
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) return failure("The result is outside the supported range.");
  return { title, value, result: currency ? cash(value) : fmt(value), detail };
}

/** Recursive descent, never eval/Function. Operators follow normal arithmetic precedence. */
function arithmetic(source: string): number {
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+\-*/^%]/g) ?? [];
  if (tokens.length > 180 || tokens.join("") !== source.replace(/\s/g, "")) throw new Error("Use numbers, brackets and + − × ÷ ^ % only.");
  let index = 0;
  function primary(): number {
    const token = tokens[index++];
    let value: number;
    if (token === "(") {
      value = sum();
      if (tokens[index++] !== ")") throw new Error("Close each bracket.");
    } else {
      if (!token || !/^(?:\d|\.)/.test(token)) throw new Error("Enter a complete expression.");
      value = Number(token);
    }
    while (tokens[index] === "%") { index++; value /= 100; }
    return value;
  }
  function power(): number {
    const value = primary();
    if (tokens[index] === "^") { index++; return value ** unary(); }
    return value;
  }
  function unary(): number {
    if (tokens[index] === "+") { index++; return unary(); }
    if (tokens[index] === "-") { index++; return -unary(); }
    return power();
  }
  function product(): number {
    let value = unary();
    while (tokens[index] === "*" || tokens[index] === "/") {
      const op = tokens[index++];
      const rhs = unary();
      if (op === "/" && rhs === 0) throw new Error("Cannot divide by zero.");
      value = op === "*" ? value * rhs : value / rhs;
    }
    return value;
  }
  function sum(): number {
    let value = product();
    while (tokens[index] === "+" || tokens[index] === "-") {
      const op = tokens[index++];
      const rhs = product();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }
  const value = sum();
  if (index !== tokens.length) throw new Error("Check the operators and brackets.");
  return value;
}

function readDate(text: string, now: Date): Date | null {
  if (/^(today|tomorrow)$/i.test(text)) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    if (/tomorrow/i.test(text)) d.setDate(d.getDate() + 1);
    return d;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const named = /^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/i.exec(text);
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  if (!iso && !named) return null;
  const year = iso ? Number(iso[1]) : Number(named![3] ?? now.getFullYear());
  const month = iso ? Number(iso[2]) - 1 : months.findIndex((m) => m === named![2] || m.slice(0, 3) === named![2]);
  const day = Number(iso ? iso[3] : named![1]);
  const date = new Date(year, month, day, 12);
  return month >= 0 && date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}
const dateLabel = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

export function calculateMagicBox(input: string, previous?: number, now = new Date()): Calculation | null {
  if (!input.trim() || input.length > 1500) return null;
  const currency = money(input);
  const text = input.toLowerCase().trim().replace(/^(?:calculate|calc|what is|what's)\s+/, "").replace(/[?=]\s*$/, "").replace(/₹|\brs\.?\s*|\binr\s*/g, "").replace(/(\d),(?=\d)/g, "$1").replace(/(\d),(?=\d)/g, "$1").replace(/[×]/g, "*").replace(/[÷]/g, "/").replace(/[−–]/g, "-").trim();
  let m: RegExpExecArray | null;

  // Follow-ups only refer to an explicit previous result, never an unrelated task.
  m = /^(?:now\s+)?(add|subtract|multiply|divide)(?:\s+(?:that|it))?(?:\s+by)?\s+([\d.]+)(%)?$/.exec(text);
  if (m && previous !== undefined) {
    const n = Number(m[2]);
    const operand = m[3] ? previous * n / 100 : n;
    if (m[1] === "divide" && operand === 0) return failure("Cannot divide by zero.");
    const value = m[1] === "add" ? previous + operand : m[1] === "subtract" ? previous - operand : m[1] === "multiply" ? previous * operand : previous / operand;
    return answer("Calculation", value, `Previous result: ${fmt(previous)}`);
  }

  m = new RegExp(`^${number}%\\s+of\\s+${amount}$`).exec(text);
  if (m) return answer("Percentage", Number(m[1]) / 100 * scaled(m[2], m[3]), `${m[1]}% of ${fmt(scaled(m[2], m[3]))}`, currency);
  m = new RegExp(`^${amount}\\s+(plus|minus)\\s+${number}%$`).exec(text);
  if (m) {
    const base = scaled(m[1], m[2]);
    return answer("Percentage", base * (1 + (m[3] === "plus" ? 1 : -1) * Number(m[4]) / 100), `${m[3] === "plus" ? "Increase" : "Discount"}: ${fmt(base * Number(m[4]) / 100)}`, currency);
  }
  m = new RegExp(`^(add|remove)\\s+${number}%\\s+(?:gst|tax)\\s+(?:to|from)\\s+${amount}$`).exec(text);
  if (m) {
    const base = scaled(m[3], m[4]);
    const result = m[1] === "add" ? base * (1 + Number(m[2]) / 100) : base / (1 + Number(m[2]) / 100);
    return answer("Tax calculation", result, `${m[2]}% supplied rate · Tax: ${cash(Math.abs(result - base))}`, true);
  }
  m = new RegExp(`^split\\s+${amount}\\s+(?:among|between|by)\\s+(\\d+)(?:\\s+people)?$`).exec(text);
  if (m) {
    const count = Number(m[3]);
    if (count < 1) return failure("Split between at least one person.");
    return answer("Per person", scaled(m[1], m[2]) / count, `${fmt(scaled(m[1], m[2]))} ÷ ${count} · Rounded shares may leave a small remainder.`, currency);
  }

  m = new RegExp(`^(?:(simple|compound)\\s+)?interest\\s+on\\s+${amount}\\s+at\\s+${number}%\\s*(annually|yearly|per annum|p\\.a\\.|monthly|per month)?\\s+for\\s+${number}\\s+(days?|months?|years?)(?:\\s+compounded\\s+(annually|yearly|monthly|quarterly|daily))?$`).exec(text);
  if (m) {
    if (m[1] === "simple" && m[8]) return failure("Choose simple interest or compound interest; simple interest does not compound.");
    const principal = scaled(m[2], m[3]);
    const rate = Number(m[4]) / 100;
    const years = Number(m[6]) / (m[7].startsWith("day") ? 365 : m[7].startsWith("month") ? 12 : 1);
    const annualRate = /month/.test(m[5] ?? "") ? rate * 12 : rate;
    const compound = m[1] === "compound" || Boolean(m[8]);
    const frequency = ({ monthly: 12, quarterly: 4, daily: 365 } as Record<string, number>)[m[8]] ?? 1;
    const total = compound ? principal * (1 + annualRate / frequency) ** (frequency * years) : principal * (1 + annualRate * years);
    return answer(compound ? "Compound interest" : "Simple interest", total - principal, `Principal: ${cash(principal)} · Total: ${cash(total)} · ${fmt(annualRate * 100)}% annual rate${m[5] ? "" : " (assumed)"} · ${compound ? `Compounded ${m[8] ?? "annually (assumed)"}` : "Simple interest"}${m[7].startsWith("day") ? " · 365-day year" : ""}`, true);
  }
  // Incomplete interest requests must ask for parameters instead of creating a Thing.
  if (/^(?:(?:simple|compound)\s+)?interest\s+on\s+[\d.]/.test(text) && /^[a-z\d.\s%/-]+$/.test(text)) {
    return failure("Try: simple interest on ₹50,000 at 12% annually for 6 months. For compound interest, add “compounded monthly” or “compounded annually”.");
  }

  m = new RegExp(`^emi\\s+(?:for|on)\\s+${amount}\\s+at\\s+${number}%(?:\\s+(?:annually|yearly))?\\s+(?:over|for)\\s+${number}\\s+(months?|years?)$`).exec(text);
  if (m) {
    const principal = scaled(m[1], m[2]);
    const rate = Number(m[3]) / 1200;
    const months = Number(m[4]) * (m[5].startsWith("year") ? 12 : 1);
    if (months <= 0 || !Number.isInteger(months)) return failure("Use a positive whole number of months.");
    const payment = rate === 0 ? principal / months : principal * rate / (-Math.expm1(-months * Math.log1p(rate)));
    return answer("Monthly EMI", payment, `${m[3]}% annual rate · ${months} months · Total interest: ${cash(payment * months - principal)} · Excludes fees.`, true);
  }

  m = /^(\d+)\s+days?\s+(after|before|from)\s+(.+)$/.exec(text);
  if (m) {
    const date = readDate(m[3], now);
    if (!date || Number(m[1]) > 365000) return failure("Use a valid date, such as 14 October 2026 or 2026-10-14.");
    const start = dateLabel(date);
    date.setDate(date.getDate() + Number(m[1]) * (m[2] === "before" ? -1 : 1));
    return { title: "Date calculation", result: dateLabel(date), detail: `${m[1]} calendar days ${m[2]} ${start}${/\d{4}/.test(m[3]) || /^(today|tomorrow)$/.test(m[3]) ? "" : " · Current year assumed"}` };
  }
  m = /^(?:days\s+)?between\s+(.+?)\s+and\s+(.+)$/.exec(text);
  if (m) {
    const start = readDate(m[1], now), end = readDate(m[2], now);
    if (!start || !end) return failure("Use two valid dates, such as: days between 2026-10-14 and 2026-11-01.");
    const utcDay = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    const days = Math.abs(utcDay(end) - utcDay(start)) / 86400000;
    return { title: "Date difference", result: `${days} days`, detail: `${dateLabel(start)} to ${dateLabel(end)} · Excludes the starting day`, value: days };
  }
  m = new RegExp(`^(?:(\\d+)\\s*h(?:ours?)?\\s*)?(?:(\\d+)\\s*m(?:in(?:utes?)?)?\\s*)?at\\s+${number}\\s+per\\s+hour$`).exec(text);
  if (m && (m[1] || m[2])) return answer("Time billing", (Number(m[1] ?? 0) + Number(m[2] ?? 0) / 60) * Number(m[3]), `${m[1] ?? 0}h ${m[2] ?? 0}m × ${fmt(Number(m[3]))}/hour`, currency);

  // Pure expressions only. A lone number/date/phone number is never intercepted.
  const expression = text.replace(/\bplus\b/g, "+").replace(/\bminus\b/g, "-").replace(/\b(?:times|multiplied by)\b/g, "*").replace(/\bdivided by\b/g, "/").replace(/(\d)\s*x\s*(?=\d)/g, "$1*");
  if (!/^[\d.\s()+*/^%\-]+$/.test(expression) || !/[+*/^%\-]/.test(expression)) return null;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(expression) || /^\+?\d{8,15}$/.test(expression) || /^\d{1,2}-\d{1,2}-\d{2,4}$/.test(expression)) return null;
  try {
    return answer("Calculation", arithmetic(expression), /%/.test(expression) ? "% means divide by 100. Use “8500 minus 15%” for a discount." : "Calculated locally · Standard operator precedence", currency);
  } catch (err) {
    return failure(err instanceof Error ? err.message : "Check the expression.");
  }
}
