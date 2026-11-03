import type { TradePlan, Token, World } from "@/lib/world/types";
import { tokenPrice, quoteTrade } from "@/lib/world/engine";
import { captureTradeProcess } from "@/lib/world/process";
import { currencyCompact, units } from "@/lib/world/amount";
import { TrainingDisclosure } from "@/components/training-ui";

export type PlanDraft = {
  loss: string;
  stopPct: string;
  targetPct: string;
  minutes: string;
  impact: string;
  evidence: string[];
  confirmed: boolean;
};
export const freshPlan = (budget = 90): PlanDraft => ({
  loss: String(budget),
  stopPct: "15",
  targetPct: "30",
  minutes: "15",
  impact: "3",
  evidence: [],
  confirmed: false,
});
export function buildTradePlan(
  draft: PlanDraft,
  token: Token,
  thesis: TradePlan["thesis"],
): TradePlan | null {
  const loss = Number(draft.loss),
    stop = Number(draft.stopPct),
    target = Number(draft.targetPct),
    seconds = Number(draft.minutes) * 60,
    impact = Number(draft.impact),
    price = tokenPrice(token);
  if (
    !draft.confirmed ||
    draft.evidence.length < 3 ||
    ![loss, stop, target, seconds, impact, price].every(Number.isFinite) ||
    loss <= 0 ||
    stop <= 0 ||
    stop >= 100 ||
    target <= 0 ||
    !Number.isInteger(seconds) ||
    seconds < 30 ||
    seconds > 3600 ||
    impact <= 0 ||
    impact > 20 ||
    price <= 0
  )
    return null;
  return {
    version: "plan-v1",
    thesis,
    maxLossUsd: loss,
    invalidationPrice: price * (1 - stop / 100),
    targetPrice: price * (1 + target / 100),
    maxHoldSeconds: seconds,
    maxImpactPct: impact,
    evidence: [...draft.evidence],
  };
}
export function TradePlanFields({
  world,
  token,
  draft,
  onChange,
  amountUsd = 0,
}: {
  world: World;
  token: Token;
  draft: PlanDraft;
  onChange: (draft: PlanDraft) => void;
  amountUsd?: number;
}) {
  const snapshot = captureTradeProcess(world, token, quoteTrade(world, token.id, "buy", "1"), 0);
  const momentumLabel =
    Math.abs(snapshot.momentumPct) > 0 && Math.abs(snapshot.momentumPct) < 0.01
      ? `${snapshot.momentumPct > 0 ? "上涨" : "下跌"}不足0.01%`
      : `${snapshot.momentumPct >= 0 ? "+" : ""}${snapshot.momentumPct.toFixed(2)}%`;
  const facts = [
    ["lp", "流动性锁定", token.pool.lpLocked ? "LP 已锁定" : "LP 未锁定"],
    [
      "permissions",
      "合约权限",
      token.mintAuthority || token.freezeAuthority || token.taxMutable
        ? "仍有可变权限"
        : "无增发、冻结与改税权限",
    ],
    ["liquidity", "真实池深度", currencyCompact(units(token.pool.quote) * world.fx[token.chain])],
    [
      "concentration",
      "创建者持仓",
      `${((units(token.creatorTokens) / Math.max(units(token.supply), Number.MIN_VALUE)) * 100).toFixed(1)}%`,
    ],
    [
      "momentum",
      "已发生走势",
      `近60秒 ${momentumLabel} · ${token.holders}个地址${amountUsd > 0 ? ` · 深度/投入 ${(snapshot.liquidityUsd / amountUsd).toFixed(1)}倍` : ""}`,
    ],
  ];
  const update = (field: keyof PlanDraft, value: string | boolean) =>
    onChange({ ...draft, [field]: value, ...(field !== "confirmed" ? { confirmed: false } : {}) });
  return (
    <TrainingDisclosure
      title="本次交易计划"
      summary={draft.confirmed ? "已核对 · 提交时冻结" : "证据、全损预算与退出条件"}
      defaultOpen
    >
      <p className="mw-muted">
        至少核对三项。权限、池深度必查；创建者持仓超过20%时也需核对集中度。
      </p>
      <div className="mw-plan-facts">
        {facts.map(([key, label, value]) => (
          <label className="mw-plan-evidence" key={key}>
            <input
              type="checkbox"
              checked={draft.evidence.includes(key)}
              onChange={() =>
                onChange({
                  ...draft,
                  confirmed: false,
                  evidence: draft.evidence.includes(key)
                    ? draft.evidence.filter((v) => v !== key)
                    : [...draft.evidence, key],
                })
              }
            />
            <span>
              <strong>{label}</strong>
              <small>{value}</small>
            </span>
          </label>
        ))}
      </div>
      <div className="mw-plan-grid">
        <label className="mw-label">
          最多承担全损 · $
          <input
            aria-label="计划全损预算美元"
            inputMode="decimal"
            value={draft.loss}
            onChange={(e) => update("loss", e.target.value)}
          />
        </label>
        <label className="mw-label">
          最大价格冲击 · %
          <input
            aria-label="计划最大价格冲击百分比"
            inputMode="decimal"
            value={draft.impact}
            onChange={(e) => update("impact", e.target.value)}
          />
        </label>
        <label className="mw-label">
          失效跌幅 · %
          <input
            aria-label="计划失效跌幅百分比"
            inputMode="decimal"
            value={draft.stopPct}
            onChange={(e) => update("stopPct", e.target.value)}
          />
        </label>
        <label className="mw-label">
          目标涨幅 · %
          <input
            aria-label="计划目标涨幅百分比"
            inputMode="decimal"
            value={draft.targetPct}
            onChange={(e) => update("targetPct", e.target.value)}
          />
        </label>
        <label className="mw-label">
          最长观察 · 分钟
          <input
            aria-label="计划最长持有分钟"
            inputMode="numeric"
            value={draft.minutes}
            onChange={(e) => update("minutes", e.target.value)}
          />
        </label>
      </div>
      <p className="mw-muted">
        失效与目标价在提交时冻结，并生成自动提交规则；触发后的实际成交仍受排队、链费和池深度限制。
      </p>
      <TrainingDisclosure title="怎样核对执行" summary="只看当时事实与实际操作">
        <p className="mw-muted">
          资金流策略需近60秒正向走势、至少3个持币地址及池深度达到订单20倍；小额验证不超过权益0.25%，分批加仓需已有持仓。实际全损投入不超过权益1%，计划冲击不超过5%。
        </p>
      </TrainingDisclosure>
      <label className="mw-plan-evidence">
        <input
          type="checkbox"
          aria-label="已核对交易证据与退出计划"
          checked={draft.confirmed}
          onChange={(e) => update("confirmed", e.target.checked)}
        />
        <span>已核对证据、预算与退出计划</span>
      </label>
    </TrainingDisclosure>
  );
}
