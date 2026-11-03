import { useEffect, useState } from "react";
import { analyzeBook } from "@/lib/trading/analyze";
import type { Analysis } from "@/lib/trading/analysis";
import { executionStats, formatSigned, moneyStats, useTrading } from "@/lib/trading/store";
import { Button, Card } from "./ui";

const CACHE_KEY = "td-ai-cache-v1";

type Cache = { fingerprint: string; analysis: Analysis; at: string };

function fingerprint(principal: number, net: number, ids: string) {
  return `${principal}|${net.toFixed(2)}|${ids}`;
}

function readCache(): Cache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Cache;
    if (!data?.analysis?.verdict || !data.fingerprint) return null;
    return {
      ...data,
      analysis: { ...data.analysis, data: data.analysis.data ?? [] },
    };
  } catch {
    return null;
  }
}

function AnalysisList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="font-mono text-xs tracking-widest text-primary">{label}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="text-sm leading-relaxed text-muted">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AiPanel() {
  const trades = useTrading((state) => state.trades);
  const principal = useTrading((state) => state.principal);
  const money = moneyStats(trades, principal);
  const discipline = executionStats(trades);
  const ids = trades.map((trade) => trade.id).join(",");
  const key = fingerprint(principal, money.net, ids);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const cached = readCache();
    if (cached) {
      setAnalysis(cached.analysis);
      setStale(cached.fingerprint !== key);
    }
  }, [key]);

  async function run() {
    if (pending || trades.length === 0) return;
    setPending(true);
    setError("");
    const lines = trades.slice(0, 120).map((trade) => {
      const pnl = trade.pnl === null ? "未平" : formatSigned(trade.pnl);
      const stake = trade.stake === null ? "投入?" : String(trade.stake);
      const line = `${trade.date} ${trade.symbol} 投入${stake} 盈亏${pnl}${trade.source === "fomo" ? " 导入" : ""}`;
      return line.slice(0, 180);
    });
    const summary = [
      `本金 ${money.principal}`,
      `权益 ${money.equity.toFixed(2)}`,
      `净盈亏 ${formatSigned(money.net)}`,
      `已平仓 ${money.settled} 笔，未平 ${money.open} 笔`,
      `胜率 ${money.winRate === null ? "无" : `${money.winRate}%`}`,
      `盈亏比 ${money.payoff === null ? "无" : money.payoff.toFixed(2)}`,
      `最大回撤 ${formatSigned(money.maxDrawdown)}`,
      `检查清单执行率 ${discipline.rate}%（${discipline.followed}/${discipline.total}，导入单不计）`,
    ].join("；");

    try {
      const result = await analyzeBook({ data: { summary, lines } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAnalysis(result.analysis);
      setStale(false);
      const cache: Cache = {
        fingerprint: key,
        analysis: result.analysis,
        at: new Date().toISOString(),
      };
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      } catch {
        // Storage can be full or blocked; the fresh analysis is still shown.
      }
    } catch {
      setError("分析没跑成，过一会儿再试");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <h2 className="font-serif text-2xl font-medium">看这笔账</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        一次看完三件事：数据、仓位、下一步。不喊单，不预测涨跌。点一次才分析。
      </p>
      <Button className="mt-3" onClick={run} disabled={pending || trades.length === 0}>
        {pending ? "正在看账本" : trades.length === 0 ? "先导入或记一笔" : "分析当前账本"}
      </Button>
      {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}
      {stale && analysis ? <p className="mt-3 text-xs text-muted">账本变过了，下面还是上次的分析。</p> : null}
      {analysis ? (
        <div className="mt-4 space-y-4 border-t border-line pt-3">
          <p className="text-sm font-medium leading-relaxed">{analysis.verdict}</p>
          <AnalysisList label="数据" items={analysis.data} />
          <AnalysisList label="仓位" items={analysis.positions} />
          <div>
            <p className="font-mono text-xs tracking-widest text-primary">建议</p>
            <ol className="mt-2 space-y-1.5">
              {analysis.next.map((item, index) => (
                <li key={item} className="flex gap-2 text-sm leading-relaxed">
                  <span className="font-mono text-xs text-primary">{String(index + 1).padStart(2, "0")}</span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
