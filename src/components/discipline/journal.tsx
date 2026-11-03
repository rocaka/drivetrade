import { useEffect, useState } from "react";
import { toast } from "sonner";
import { todayISO, useTrading, type Trade } from "@/lib/trading/store";
import { cn } from "@/lib/cn";
import { Button, Card, Field, fieldClass } from "./ui";

type FormState = {
  date: string;
  symbol: string;
  planReason: string;
  stopLoss: string;
  takeProfit: string;
  actualEntry: string;
  actualExit: string;
  followedPlan: boolean;
  deviationReason: string;
  stake: string;
  pnl: string;
};

function emptyForm(): FormState {
  return {
    date: "",
    symbol: "",
    planReason: "",
    stopLoss: "",
    takeProfit: "",
    actualEntry: "",
    actualExit: "",
    followedPlan: true,
    deviationReason: "",
    stake: "",
    pnl: "",
  };
}

function fromTrade(trade: Trade): FormState {
  return {
    date: trade.date,
    symbol: trade.symbol,
    planReason: trade.planReason,
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    actualEntry: trade.actualEntry,
    actualExit: trade.actualExit,
    followedPlan: trade.followedPlan,
    deviationReason: trade.deviationReason,
    stake: trade.stake === null || trade.stake === undefined ? "" : String(trade.stake),
    pnl: trade.pnl === null || trade.pnl === undefined ? "" : String(trade.pnl),
  };
}

function parseAmount(raw: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = raw.trim().replace(/,/g, "");
  if (!trimmed) return { ok: true, value: null };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false };
  return { ok: true, value };
}

export function JournalScreen({
  visible,
  checklistOk,
  editingId,
  editToken,
  onNeedCheck,
  onSaved,
}: {
  visible: boolean;
  checklistOk: boolean;
  editingId: string | null;
  editToken: number;
  onNeedCheck: () => void;
  onSaved: () => void;
}) {
  const addTrade = useTrading((state) => state.addTrade);
  const updateTrade = useTrading((state) => state.updateTrade);
  const [form, setForm] = useState<FormState>(emptyForm);

  useEffect(() => {
    const trade = editingId
      ? useTrading.getState().trades.find((item) => item.id === editingId)
      : undefined;
    setForm(trade ? fromTrade(trade) : { ...emptyForm(), date: todayISO() });
  }, [editingId, editToken]);

  const locked = !editingId && !checklistOk;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function save() {
    const symbol = form.symbol.trim();
    const planReason = form.planReason.trim();
    const stopLoss = form.stopLoss.trim();
    const takeProfit = form.takeProfit.trim();
    const deviationReason = form.deviationReason.trim();
    const stake = parseAmount(form.stake);
    const pnl = parseAmount(form.pnl);

    if (!symbol || !planReason || !stopLoss || !takeProfit) {
      toast.error("币种、买入理由、止损、止盈都要写");
      return;
    }
    if (!form.followedPlan && !deviationReason) {
      toast.error("没按计划走，写一句偏差原因");
      return;
    }
    if (!stake.ok || (stake.value !== null && stake.value < 0)) {
      toast.error("投入金额要是大于等于 0 的数字，或者留空");
      return;
    }
    if (!pnl.ok) {
      toast.error("盈亏金额要是数字，盈利为正，亏损为负");
      return;
    }

    const input = {
      date: form.date || todayISO(),
      symbol,
      planReason,
      stopLoss,
      takeProfit,
      actualEntry: form.actualEntry.trim(),
      actualExit: form.actualExit.trim(),
      followedPlan: form.followedPlan,
      deviationReason,
      stake: stake.value,
      pnl: pnl.value,
    };

    if (editingId) {
      updateTrade(editingId, input);
      toast.success("记录已更新");
    } else {
      addTrade(input);
      toast.success("已记下。下一笔还是要先过检查");
    }
    onSaved();
  }

  return (
    <div className={visible ? "screen-in space-y-4" : "hidden"}>
      {locked ? (
        <Card>
          <p className="text-sm font-medium">先过检查清单</p>
          <p className="mt-1 text-sm text-muted">
            新的一笔必须先把铁律全部勾完。这是为了拦住追高、扛单和该走不走。
          </p>
          <Button className="mt-4" onClick={onNeedCheck}>
            去检查
          </Button>
        </Card>
      ) : (
        <Card>
          {!editingId ? (
            <p className="mb-4 rounded-xl border border-line bg-bg px-3 py-2 text-xs text-ok">
              检查已通过。写下计划，再写实际怎么做的。
            </p>
          ) : (
            <p className="mb-4 text-xs text-muted">改的是已有记录，不用重新检查。</p>
          )}

          <Field label="日期">
            <input
              type="date"
              className={fieldClass}
              value={form.date}
              onChange={(event) => set("date", event.target.value)}
            />
          </Field>
          <Field label="币种 / 标的">
            <input
              className={fieldClass}
              value={form.symbol}
              placeholder="例如：Dogcoin"
              onChange={(event) => set("symbol", event.target.value)}
            />
          </Field>
          <Field label="为什么买？（计划理由）">
            <textarea
              className={cn(fieldClass, "min-h-24 resize-y")}
              value={form.planReason}
              placeholder="写清楚入场逻辑，不能只写「感觉要涨」"
              onChange={(event) => set("planReason", event.target.value)}
            />
          </Field>
          <Field label="止损位置 / 比例">
            <input
              className={fieldClass}
              value={form.stopLoss}
              placeholder="例如：-15% 或跌破某档市值"
              onChange={(event) => set("stopLoss", event.target.value)}
            />
          </Field>
          <Field label="止盈目标">
            <input
              className={fieldClass}
              value={form.takeProfit}
              placeholder="例如：涨 50% 先卖一半"
              onChange={(event) => set("takeProfit", event.target.value)}
            />
          </Field>
          <Field label="实际进场">
            <textarea
              className={cn(fieldClass, "min-h-20 resize-y")}
              value={form.actualEntry}
              placeholder="买在什么位置、什么时间"
              onChange={(event) => set("actualEntry", event.target.value)}
            />
          </Field>
          <Field label="实际出场">
            <textarea
              className={cn(fieldClass, "min-h-20 resize-y")}
              value={form.actualExit}
              placeholder="卖在什么位置、有没有按计划走。还没走可以先空着"
              onChange={(event) => set("actualExit", event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="本笔投入">
              <input
                className={fieldClass}
                inputMode="decimal"
                value={form.stake}
                placeholder="比如 200"
                onChange={(event) => set("stake", event.target.value)}
              />
            </Field>
            <Field label="盈亏金额">
              <input
                className={fieldClass}
                inputMode="decimal"
                value={form.pnl}
                placeholder="赚填正，亏填负"
                onChange={(event) => set("pnl", event.target.value)}
              />
            </Field>
          </div>
          <LiveReturn stake={form.stake} pnl={form.pnl} />

          <p className="mb-1.5 text-xs font-medium text-muted">是否按计划执行？</p>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => set("followedPlan", true)}
              className={cn(
                "min-h-11 rounded-xl border text-sm font-semibold",
                form.followedPlan ? "border-ok bg-ok text-bg" : "border-line bg-bg text-muted",
              )}
            >
              完全按计划
            </button>
            <button
              type="button"
              onClick={() => set("followedPlan", false)}
              className={cn(
                "min-h-11 rounded-xl border text-sm font-semibold",
                !form.followedPlan ? "border-bad bg-bad text-bg" : "border-line bg-bg text-muted",
              )}
            >
              有偏差
            </button>
          </div>

          <Field label={form.followedPlan ? "备注（可选）" : "偏差原因"}>
            <textarea
              className={cn(fieldClass, "min-h-20 resize-y")}
              value={form.deviationReason}
              placeholder={form.followedPlan ? "可以空着" : "一句话：哪里没按计划走"}
              onChange={(event) => set("deviationReason", event.target.value)}
            />
          </Field>

          <Button onClick={save}>{editingId ? "保存修改" : "保存交易记录"}</Button>
        </Card>
      )}
    </div>
  );
}

function LiveReturn({ stake, pnl }: { stake: string; pnl: string }) {
  const stakeParsed = parseAmount(stake);
  const pnlParsed = parseAmount(pnl);
  if (!stakeParsed.ok || !pnlParsed.ok || stakeParsed.value === null || stakeParsed.value <= 0 || pnlParsed.value === null) {
    return <p className="mb-3 text-xs text-muted">还没平仓就留空盈亏。填了之后，统计页会更新曲线。</p>;
  }
  const ret = (pnlParsed.value / stakeParsed.value) * 100;
  const up = pnlParsed.value >= 0;
  return (
    <p className={cn("mb-3 font-mono text-sm tabular-nums", up ? "text-ok" : "text-bad")}>
      本笔收益率 {ret > 0 ? "+" : ""}
      {ret.toFixed(1)}%
    </p>
  );
}
