import { useState } from "react";
import { toast } from "sonner";
import { executionStats, formatSigned, rateTone, tradePnl, tradeStake, useTrading } from "@/lib/trading/store";
import { cn } from "@/lib/cn";
import { AiPanel } from "./ai-panel";
import { MoneyPanel } from "./money-panel";
import { Button, Card, Overlay, RateBlock } from "./ui";

type Filter = "all" | "ok" | "bad";

export function StatsScreen({ onEdit }: { onEdit: (id: string) => void }) {
  const trades = useTrading((state) => state.trades);
  const removeTrade = useTrading((state) => state.removeTrade);
  const stats = executionStats(trades);
  const tone = rateTone(stats.rate, stats.total);
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const visible = trades.filter((trade) => {
    if (trade.source === "fomo") return filter === "all";
    if (filter === "ok") return trade.followedPlan;
    if (filter === "bad") return !trade.followedPlan;
    return true;
  });
  const fomoCount = trades.filter((trade) => trade.source === "fomo").length;

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
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["all", "全部"],
              ["ok", "按计划"],
              ["bad", "有偏差"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                "min-h-11 border text-sm font-bold",
                filter === key
                  ? "border-primary bg-primary text-primary-fg"
                  : "border-line bg-surface text-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {trades.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">还没有交易记录。先走一遍检查清单，再记第一笔。</p>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">这一类还没有记录。</p>
        </Card>
      ) : (
        visible.map((trade) => {
          const open = openId === trade.id;
          const pnl = tradePnl(trade);
          const stake = tradeStake(trade);
          return (
            <article
              key={trade.id}
              className="relative overflow-hidden rounded-2xl border border-line bg-surface"
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
                      "shrink-0 px-2 py-1 font-mono text-xs font-bold",
                      trade.source === "fomo"
                        ? "bg-primary text-primary-fg"
                        : trade.followedPlan
                          ? "bg-surface-2 text-ok"
                          : "bg-surface-2 text-bad",
                    )}
                  >
                    {trade.source === "fomo" ? "FOMO" : trade.followedPlan ? "按计划" : "有偏差"}
                  </span>
                </div>
                <div className="mt-2 flex items-start justify-between gap-3">
                  <p className="line-clamp-2 text-sm text-muted">{trade.planReason}</p>
                  {pnl !== null ? (
                    <p className={cn("shrink-0 font-mono text-sm font-semibold tabular-nums", pnl >= 0 ? "text-ok" : "text-bad")}>
                      {formatSigned(pnl)}
                    </p>
                  ) : (
                    <p className="shrink-0 text-xs text-faint">未平仓</p>
                  )}
                </div>
              </button>

              {open ? (
                <dl className="space-y-2 border-t border-line px-4 pt-3 pb-4 pl-5 text-sm">
                  <Row label="理由" value={trade.planReason} />
                  <Row label="止损" value={trade.stopLoss} />
                  <Row label="止盈" value={trade.takeProfit} />
                  <Row label="进场" value={trade.actualEntry || "未写"} />
                  <Row label="出场" value={trade.actualExit || "未写"} />
                  <Row label="投入" value={stake === null ? "未写" : formatSigned(stake).replace(/^\+/, "")} />
                  <Row label="盈亏" value={pnl === null ? "未平仓" : formatSigned(pnl)} />
                  {!trade.followedPlan ? <Row label="偏差" value={trade.deviationReason || "未写"} /> : null}
                  {trade.followedPlan && trade.deviationReason ? (
                    <Row label="备注" value={trade.deviationReason} />
                  ) : null}
                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <Button variant="ghost" onClick={() => onEdit(trade.id)}>
                      修改
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
        <Overlay
          className="fixed inset-0 z-40 flex items-end justify-center bg-bg/80 px-4 pb-[max(env(safe-area-inset-bottom,0px),1.25rem)] sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-trade-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-4">
            <h2 id="delete-trade-title" className="text-base font-semibold">
              删除这条记录？
            </h2>
            <p className="mt-2 text-sm text-muted">删掉后执行率会按剩下的记录重算。</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={() => setPendingDelete(null)}>
                留下
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  removeTrade(pendingDelete);
                  if (openId === pendingDelete) setOpenId(null);
                  setPendingDelete(null);
                  toast.success("记录已删除");
                }}
              >
                删除
              </Button>
            </div>
          </div>
        </Overlay>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-fg">{value}</dd>
    </div>
  );
}
