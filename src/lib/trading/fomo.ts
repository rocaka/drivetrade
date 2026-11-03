import { todayISO, type Trade } from "./store";

export type FomoDraft = {
  symbol: string;
  stake: number | null;
  pnl: number | null;
  date: string;
};

export type FomoParse = {
  drafts: FomoDraft[];
  principal: number | null;
  errors: string[];
};

const principalRe =
  /^(?:本金|现金|principal|cash)\s*[:：]?\s*([+-]?\d[\d,]*(?:\.\d+)?)\s*$/i;
const dateRe = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;

function parseNumberToken(token: string): { value: number; signed: boolean } | null {
  const cleaned = token.replace(/,/g, "").replace(/＋/g, "+").replace(/－/g, "-").replace(/−/g, "-");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return { value, signed: cleaned.startsWith("+") || cleaned.startsWith("-") };
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = parseNumberToken(value.trim());
    return parsed ? parsed.value : null;
  }
  return null;
}

function readSymbol(row: Record<string, unknown>): string {
  const token = row.token;
  const nested =
    token && typeof token === "object"
      ? asText((token as Record<string, unknown>).symbol) ||
        asText((token as Record<string, unknown>).name)
      : "";
  return (
    asText(row.symbol) ||
    asText(row.ticker) ||
    asText(row.coin) ||
    asText(row.name) ||
    nested
  ).replace(/^\$/, "");
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function amountsFromNumbers(nums: { value: number; signed: boolean }[]): {
  stake: number | null;
  pnl: number | null;
} {
  if (nums.length === 0) return { stake: null, pnl: null };
  if (nums.length === 1) {
    return nums[0].signed
      ? { stake: null, pnl: nums[0].value }
      : { stake: Math.abs(nums[0].value), pnl: null };
  }
  const signed = nums.filter((item) => item.signed);
  const unsigned = nums.filter((item) => !item.signed);
  if (signed.length > 0 && unsigned.length > 0) {
    return { stake: Math.abs(unsigned[0].value), pnl: signed[signed.length - 1].value };
  }
  return { stake: Math.abs(nums[0].value), pnl: nums[1].value };
}

function parseLine(line: string, today: string): { draft?: FomoDraft; principal?: number; error?: string } {
  const principal = line.match(principalRe);
  if (principal) {
    const value = parseNumberToken(principal[1]);
    if (!value || value.value <= 0) return { error: `本金要大于 0：${line}` };
    return { principal: value.value };
  }

  const tokens = line.split(/\s+/).filter(Boolean);
  const words: string[] = [];
  const nums: { value: number; signed: boolean }[] = [];
  let date = today;
  for (const token of tokens) {
    const dated = token.match(dateRe);
    if (dated) {
      date = `${dated[1]}-${dated[2].padStart(2, "0")}-${dated[3].padStart(2, "0")}`;
      continue;
    }
    const num = parseNumberToken(token);
    if (num) nums.push(num);
    else words.push(token.replace(/^\$/, ""));
  }
  const symbol = words.join(" ").trim();
  if (!symbol) return { error: `缺币种：${line}` };
  if (nums.length === 0) return { error: `${symbol} 缺金额` };
  const { stake, pnl } = amountsFromNumbers(nums);
  return { draft: { symbol: symbol.slice(0, 40), stake, pnl, date } };
}

function draftsFromJson(value: unknown, today: string): FomoParse | null {
  if (typeof value === "string") return null;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return parseFomoPaste(value.join("\n"), today);
  }
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? arrayField(value as Record<string, unknown>)
      : null;
  if (!rows) return null;
  const drafts: FomoDraft[] = [];
  const errors: string[] = [];
  rows.forEach((row, index) => {
    if (!row || typeof row !== "object") {
      errors.push(`第 ${index + 1} 条不是对象`);
      return;
    }
    const record = row as Record<string, unknown>;
    const symbol = readSymbol(record);
    if (!symbol) {
      errors.push(`第 ${index + 1} 条没有币种`);
      return;
    }
    const stake =
      asNumber(record.stake) ??
      asNumber(record.cost) ??
      asNumber(record.costBasis) ??
      asNumber(record.invested) ??
      asNumber(record.amountUsd);
    const explicit = asNumber(record.pnl) ?? asNumber(record.pnlUsd) ?? asNumber(record.totalPnlUsd);
    const realized = asNumber(record.realizedPnlUsd) ?? asNumber(record.realizedPnl);
    const unrealized = asNumber(record.unrealizedPnlUsd) ?? asNumber(record.unrealizedPnl);
    const pnl = explicit ?? (realized !== null || unrealized !== null ? (realized ?? 0) + (unrealized ?? 0) : null);
    const date = asText(record.date).match(dateRe) ? asText(record.date).slice(0, 10) : today;
    drafts.push({
      symbol: symbol.slice(0, 40),
      stake: stake !== null && stake < 0 ? null : stake,
      pnl,
      date,
    });
  });
  const root = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const principal =
    asNumber(root?.principal) ?? asNumber(root?.cash) ?? asNumber(root?.cashBalance);
  return {
    drafts,
    principal: principal !== null && principal > 0 ? principal : null,
    errors,
  };
}

function arrayField(record: Record<string, unknown>): unknown[] | null {
  for (const key of ["trades", "positions", "balances", "holdings", "data"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return null;
}

export function parseFomoPaste(text: string, today = todayISO()): FomoParse {
  const trimmed = text.trim();
  if (!trimmed) return { drafts: [], principal: null, errors: [] };
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = draftsFromJson(JSON.parse(trimmed), today);
      if (parsed) return parsed;
    } catch {
      return { drafts: [], principal: null, errors: ["JSON 读不了"] };
    }
  }

  const drafts: FomoDraft[] = [];
  let principal: number | null = null;
  const errors: string[] = [];
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  if (lines.length > 200) {
    return { drafts: [], principal: null, errors: ["一次最多 200 行"] };
  }
  for (const line of lines) {
    const result = parseLine(line, today);
    if (result.error) errors.push(result.error);
    if (typeof result.principal === "number") principal = result.principal;
    if (result.draft) drafts.push(result.draft);
  }
  return { drafts, principal, errors };
}

function stableId(key: string) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fomo-${(hash >>> 0).toString(16)}`;
}

export function draftsToTrades(drafts: FomoDraft[], handle = "fomo"): Trade[] {
  const seen = new Map<string, number>();
  const now = new Date().toISOString();
  return drafts.map((draft) => {
    const base = stableId(
      [draft.symbol.toLowerCase(), draft.stake ?? "x", draft.pnl ?? "open", draft.date].join("|"),
    );
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const stakeText = draft.stake === null ? "金额未写" : `投入 ${draft.stake}`;
    const pnlText = draft.pnl === null ? "还在持仓" : `盈亏 ${draft.pnl}`;
    return {
      id: count === 0 ? base : `${base}-${count}`,
      date: draft.date,
      symbol: draft.symbol,
      planReason: `从 ${handle} 导入的仓位。没走过交易前检查。`,
      stopLoss: "未记录",
      takeProfit: "未记录",
      actualEntry: `${stakeText}。${pnlText}。`,
      actualExit: draft.pnl === null ? "" : "按抄下来的盈亏记账",
      followedPlan: true,
      deviationReason: "",
      stake: draft.stake,
      pnl: draft.pnl,
      createdAt: now,
      source: "fomo",
    };
  });
}
