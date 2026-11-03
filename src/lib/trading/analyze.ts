import { createServerFn } from "@tanstack/react-start";

export type Analysis = {
  verdict: string;
  data: string[];
  positions: string[];
  next: string[];
};

type Payload = {
  summary: string;
  lines: string[];
};

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseAnalysis(raw: string): Analysis | null {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    const verdict = asText(data.verdict);
    const facts = Array.isArray(data.data) ? data.data.map(asText).filter(Boolean).slice(0, 4) : [];
    const positions = Array.isArray(data.positions) ? data.positions.map(asText).filter(Boolean).slice(0, 5) : [];
    const next = Array.isArray(data.next) ? data.next.map(asText).filter(Boolean).slice(0, 3) : [];
    if (!verdict || next.length === 0) return null;
    return { verdict, data: facts, positions, next };
  } catch {
    return null;
  }
}

export const analyzeBook = createServerFn({ method: "POST" })
  .validator((input: Payload) => input)
  .handler(async ({ data }) => {
    const summary = asText(data?.summary);
    const lines = Array.isArray(data?.lines) ? data.lines.map(asText).filter(Boolean).slice(0, 120) : [];
    if (!summary || lines.length === 0) {
      return { ok: false as const, error: "账本是空的，先导入或记一笔" };
    }
    if (summary.length > 2000 || lines.some((line) => line.length > 180)) {
      return { ok: false as const, error: "这次送来的数据太长" };
    }

    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "这台环境没有打开 AI" };

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0.3,
        max_tokens: 900,
        messages: [
          {
            role: "system",
            content:
              "你是加密现货和合约的纪律教练。只根据用户给出的账本说话。中文，短句，不客气。不要喊单，不要预测涨跌，不要承诺赚钱，不要编造账本里没有的币。只返回 JSON，不要 markdown。",
          },
          {
            role: "user",
            content: `返回 {"verdict":"两句总评","data":["最多4条，只解释摘要里已经算好的胜率、盈亏比、回撤、持仓结构"],"positions":["最多5条，点名币和问题"],"next":["3条可执行的下一步"]}\n\n摘要：\n${summary}\n\n仓位：\n${lines.join("\n")}`,
          },
        ],
      }),
    });

    if (!res.ok) return { ok: false as const, error: "分析没跑成，过一会儿再试" };

    const body = (await res.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    const raw = typeof content === "string" ? content : "";
    const analysis = parseAnalysis(raw);
    if (!analysis) return { ok: false as const, error: "分析返回看不懂，再试一次" };
    return { ok: true as const, analysis };
  });
