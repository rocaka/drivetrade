import { useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import {
  executionStats,
  formatSigned,
  newestFirst,
  rateTone,
  tradePnl,
  tradeStake,
  useTrading,
  type Trade,
} from "@/lib/trading/store";
import { cn } from "@/lib/cn";
import { AiPanel } from "./ai-panel";
import { MoneyPanel } from "./money-panel";
import { Button, Card, Dialog, RateBlock } from "./ui";

type Filter = "all" | "ok" | "bad" | "open";

function matchesFilter(trade: Trade, filter: Filter) {
  if (filter === "open") return tradePnl(trade) === null;
  if (trade.source === "fomo") return filter === "all";
  if (filter === "ok") return trade.followedPlan;
  if (filter === "bad") return !trade.followedPlan;
  return true;
}

function matchesQuery(trade: Trade, query: string) {
  if (!query) return true;
  const haystack = [trade.symbol, trade.planReason, trade.deviationReason, trade.date]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export function StatsScreen({ onEdit }: { onEdit: (id: string) => void }) {
  const trades = useTrading((state) => state.trades);
  const removeTrade = useTrading((state) => state.removeTrade);
  const restoreTrade = useTrading((state) => state.restoreTrade);
  const stats = executionStats(trades);
  const tone = rateTone(stats.rate, stats.total);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const needle = query.trim().toLowerCase();
  const ordered = newestFirst(trades).filter((trade) => matchesQuery(trade, needle));
  const visible = ordered.filter((trade) => matchesFilter(trade, filter));
  const fomoCount = trades.filter((trade) => trade.source === "fomo").length;
  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "全部" },
    { key: "ok", label: "按计划" },
    { key: "bad", label: "有偏差" },
    { key: "open", label: "未平仓" },
  ];

  return (
    <div className="space-y-3">
      <Card>
        <RateBlock
          rate={stats.rate}
          tone={tone}
          total={stats.total}
          followed={stats.followed}
          streak={stats.streak}
        />
        <p className="mt-3 text-xs leading-relaxed text-muted">
          低于 80%，先把纪律练出来。下面的曲线只反映已记下的盈亏。
          {fomoCount > 0 ? ` FOMO 导入 ${fomoCount} 笔只进盈亏，不进执行率。` : ""}
        </p>
      </Card>

      <MoneyPanel />

      <AiPanel />

      {trades.length > 0 ? (
        <div className="space-y-2 pt-2">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-lg font-black">全部记录</h2>
            <p className="text-xs text-faint tabular-nums">
              {visible.length} / {trades.length} 笔
            </p>
          </div>
          <label className="flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 focus-within:border-primary">
            <Search className="size-4 shrink-0 text-faint" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜币种、理由或日期"
              aria-label="搜索交易记录"
              className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-faint"
            />
          </label>
          <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="筛选记录">
            {filters.map(({ key, label }) => {
              const count = ordered.filter((trade) => matchesFilter(trade, key)).length;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={filter === key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    "min-h-11 rounded-full border px-1 text-xs font-bold transition",
                    filter === key
                      ? "border-primary bg-primary text-primary-fg"
                      : "border-line bg-surface text-muted hover:text-fg",
                  )}
                >
                  {label}
                  <span className="ml-1 font-mono tabular-nums opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {trades.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">还没有交易记录。先走一遍检查清单，再记第一笔。</p>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            {needle ? `没有匹配「${query.trim()}」的记录。` : "这一类还没有记录。"}
          </p>
        </Card>
      ) : (
        visible.map((trade) => {
          const open = openId === trade.id;
          const pnl = tradePnl(trade);
          const stake = tradeStake(trade);
          const returnPct = pnl !== null && stake !== null && stake > 0 ? (pnl / stake) * 100 : null;
          return (
            <article
              key={trade.id}
              className="relative overflow-hidden rounded-2xl border border-line bg-surface transition hover:border-faint/60"
            >
              <span
                className={cn(
                  "absolute inset-y-0 left-0 w-1",
                  trade.source === "fomo" ? "bg-primary" : trade.followedPlan ? "bg-ok" : "bg-bad",
                )}
                aria-hidden
              />
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : trade.id)}
                className="w-full px-4 py-4 pl-5 text-left"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold">{trade.symbol}</p>
                    <p className="font-mono text-xs text-muted tabular-nums">{trade.date}</p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-1 text-xs font-bold",
                      trade.source === "fomo"
                        ? "bg-primary text-primary-fg"
                        : trade.followedPlan
                          ? "bg-ok/15 text-ok"
                          : "bg-bad/15 text-bad",
                    )}
                  >
                    {trade.source === "fomo" ? "FOMO" : trade.followedPlan ? "按计划" : "有偏差"}
                  </span>
                </div>
                <div className="mt-2 flex items-start justify-between gap-3">
                  <p className="line-clamp-2 text-sm text-muted">{trade.planReason}</p>
                  {pnl !== null ? (
                    <p
                      className={cn(
                        "shrink-0 text-right font-mono text-sm font-semibold tabular-nums",
                        pnl >= 0 ? "text-ok" : "text-bad",
                      )}
                    >
                      {formatSigned(pnl)}
                      {returnPct !== null ? (
                        <span className="block text-xs font-normal opacity-80">
                          {returnPct > 0 ? "+" : ""}
                          {returnPct.toFixed(1)}%
                        </span>
                      ) : null}
                    </p>
                  ) : (
                    <p className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs text-faint">
                      未平仓
                    </p>
                  )}
                </div>
              </button>

              {open ? (
                <dl className="space-y-2 border-t border-line px-4 pt-3 pb-4 pl-5 text-sm">
                  <Row label="理由" value={trade.planReason} />
                  <div className="grid grid-cols-2 gap-3">
                    <Row label="止损" value={trade.stopLoss} />
                    <Row label="止盈" value={trade.takeProfit} />
                  </div>
                  <Row label="进场" value={trade.actualEntry || "未写"} />
                  <Row label="出场" value={trade.actualExit || "未写"} />
                  <div className="grid grid-cols-2 gap-3">
                    <Row label="投入" value={stake === null ? "未写" : formatSigned(stake).replace(/^\+/, "")} />
                    <Row label="盈亏" value={pnl === null ? "未平仓" : formatSigned(pnl)} />
                  </div>
                  {!trade.followedPlan ? <Row label="偏差" value={trade.deviationReason || "未写"} /> : null}
                  {trade.followedPlan && trade.deviationReason ? (
                    <Row label="备注" value={trade.deviationReason} />
                  ) : null}
                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <Button variant="ghost" onClick={() => onEdit(trade.id)}>
                      {pnl === null ? "补记平仓" : "修改"}
                    </Button>
                    <Button variant="ghost" className="text-bad" onClick={() => setPendingDelete(trade.id)}>
                      删除
                    </Button>
                  </div>
                </dl>
              ) : null}
            </article>
          );
        })
      )}

      {pendingDelete ? (
        <Dialog title="删除这条记录？" onClose={() => setPendingDelete(null)}>
          <p className="mt-2 text-sm text-muted">删掉后执行率会按剩下的记录重算。</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              留下
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const removed = trades.find((trade) => trade.id === pendingDelete);
                removeTrade(pendingDelete);
                if (openId === pendingDelete) setOpenId(null);
                setPendingDelete(null);
                toast.success("记录已删除", {
                  action: removed
                    ? { label: "撤销", onClick: () => restoreTrade(removed) }
                    : undefined,
                });
              }}
            >
              删除
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-fg">{value}</dd>
    </div>
  );
}
