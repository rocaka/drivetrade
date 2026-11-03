import { TrainingSelect } from "@/components/training-select";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Check, Copy, Star } from "lucide-react";
import { toast } from "sonner";
import { useWorld } from "@/lib/world/store";
import {
  liquidationValue,
  publicObservations,
  quoteTrade,
  riskCheck,
  tokenPrice,
} from "@/lib/world/engine";
import { atoms, compact, currencyCompact, money, units } from "@/lib/world/amount";
import { positionChartOverlay } from "@/lib/world/chart";
import type { Atom, Quote, Side, Token, World } from "@/lib/world/types";
import {
  ActionButton,
  BackButton,
  ChainBadge,
  Metric,
  Price,
  ageLabel,
  chainSpec,
  platformName,
  simTime,
  statusLabel,
} from "./shared";
import { MarketNews } from "./market-news";
import { TokenAvatar } from "./token-avatar";
import { CandlestickChart } from "./candlestick-chart";
import { EasterEggBadge, EasterEggInfo } from "./easter-egg";
import { AnimatedValue, TrainingDisclosure, useTrainingActive } from "@/components/training-ui";
import { TradePlanFields, buildTradePlan, freshPlan } from "./trade-plan";
import { prepareTradingBalance } from "@/lib/world/fund-account";
import { CHAINS } from "@/lib/world/config";

function parsedAmount(value: string): Atom | null {
  try {
    const result = atoms(value);
    return BigInt(result) > 0n ? result : null;
  } catch {
    return null;
  }
}
function inputFromAtoms(value: bigint) {
  const whole = value / 1_000_000n,
    fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}
const BUY_PRESETS = ["5", "10", "25", "50"] as const;
function dollarAmount(value: string, fx: number): Atom | null {
  const dollars = Number(value);
  return Number.isFinite(dollars) && dollars > 0 && fx > 0
    ? parsedAmount((Math.floor((dollars / fx) * 1_000_000) / 1_000_000).toFixed(6))
    : null;
}

export function TokenDetail({
  world,
  token,
  watched,
  onWatch,
  onBack,
}: {
  world: World;
  token: Token;
  watched: boolean;
  onWatch: () => void;
  onBack: () => void;
}) {
  const dispatch = useWorld((state) => state.dispatch);
  const busy = useWorld((state) => state.busy);
  const readOnly = useWorld((state) => state.readOnly);
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [sellPercent, setSellPercent] = useState<number | null>(null);
  const [chartMode, setChartMode] = useState<"marketCap" | "usdPrice">("marketCap");
  const [slippage, setSlippage] = useState("5");
  const [validFor, setValidFor] = useState("120");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [localError, setLocalError] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [copied, setCopied] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [tradeStatus, setTradeStatus] = useState("");
  const active = useTrainingActive();
  const activeRef = useRef(active);
  activeRef.current = active;
  const operation = useRef(0),
    submitting = useRef(false);
  useEffect(() => {
    if (!active) {
      operation.current++;
      submitting.current = false;
      setPreparing(false);
    }
  }, [active]);
  useEffect(() => {
    const cancelWhenHidden = () => {
      if (!document.hidden) return;
      operation.current++;
      submitting.current = false;
      setPreparing(false);
      setTradeStatus("");
    };
    document.addEventListener("visibilitychange", cancelWhenHidden);
    return () => {
      document.removeEventListener("visibilitychange", cancelWhenHidden);
      operation.current++;
      submitting.current = false;
    };
  }, []);
  const [planDraft, setPlanDraft] = useState(() =>
    freshPlan(Math.max(0.01, Math.floor(liquidationValue(world) * 0.009 * 100) / 100)),
  );
  const legacyPlan =
    world.config.assessmentVersion === "process-v1" && world.config.mode === "exam";
  const planRequired = legacyPlan && side === "buy";
  const plan = planRequired
    ? buildTradePlan(
        planDraft,
        token,
        reason === "流动性与资金流符合我的条件"
          ? "flow"
          : reason === "按预先计划分批买入"
            ? "scale"
            : "probe",
      )
    : undefined;
  const chain = chainSpec(token.chain);
  const fx = world.fx[token.chain];
  const position = world.positions[token.id];
  const amountAtom = side === "buy" ? dollarAmount(amount, fx) : parsedAmount(amount);
  const cashUsd = CHAINS.reduce(
    (sum, c) =>
      sum + units(world.wallet[c.id].stable) + units(world.wallet[c.id].native) * world.fx[c.id],
    0,
  );
  const quote: Quote | null = useMemo(() => {
    if (!amountAtom) return null;
    try {
      return quoteTrade(world, token.id, side, amountAtom);
    } catch {
      return null;
    }
  }, [world, token.id, side, amountAtom]);
  const price = tokenPrice(token);
  const publicFacts = publicObservations(world, token.id);
  const quantity = units(position?.quantity ?? "0");
  const sellQuote = quantity > 0 ? quoteTrade(world, token.id, "sell", position!.quantity) : null;
  const canExit = Boolean(
    sellQuote?.ok &&
    BigInt(world.wallet[token.chain].native) >= BigInt(sellQuote.gas) &&
    BigInt(sellQuote.amountOut) > BigInt(sellQuote.gas),
  );
  const exitReason = !sellQuote?.ok
    ? sellQuote?.error
    : BigInt(world.wallet[token.chain].native) < BigInt(sellQuote.gas)
      ? "本链链费余额不足"
      : BigInt(sellQuote.amountOut) <= BigInt(sellQuote.gas)
        ? "回款不足以覆盖链费"
        : undefined;
  const exitValue =
    canExit && sellQuote
      ? Math.max(0, (units(sellQuote.amountOut) - units(sellQuote.gas)) * fx)
      : 0;
  const canTrade = world.phase !== "completed" && world.phase !== "settling" && !readOnly;
  const isPending = world.transactions.some(
    (tx) => tx.status === "pending" && tx.tokenId === token.id,
  );
  const supply = units(token.supply);
  const currentPrice = price * fx;
  const chartHistory = useMemo(() => {
    const current = { t: world.now, price, volume: 0 };
    return token.history.at(-1)?.t === world.now
      ? [...token.history.slice(0, -1), current]
      : [...token.history, current];
  }, [token.history, world.now, price]);
  const marketCap = currentPrice * supply;
  const nativeBalance = units(world.wallet[token.chain].native);
  const gas = quote?.gas ?? quoteTrade(world, token.id, "buy", "1").gas;
  const amountUsd = amountAtom ? units(amountAtom) * fx : 0;
  const cost = units(position?.costUsd ?? "0");
  const chartPosition = positionChartOverlay({
    quantity,
    costUsd: cost,
    exitValueUsd: exitValue,
    canExit,
    valueScale: chartMode === "marketCap" ? supply : 1,
    exitReason,
  });
  const validSeconds = Number(validFor);
  const deadline = world.now + validSeconds;
  const change = token.initialPrice > 0 ? (price / token.initialPrice - 1) * 100 : 0;

  function switchSide(value: Side) {
    if (preparing) return;
    setSide(value);
    setAmount("");
    setSellPercent(null);
    setLocalError("");
    setReason("");
  }
  async function submit() {
    if (submitting.current || !canTrade || !activeRef.current) return;
    setLocalError("");
    if (!amountAtom || !quote?.ok) {
      setLocalError(quote?.error ?? "请选择有效金额");
      return;
    }
    const slip = Number(slippage);
    if (
      !Number.isFinite(slip) ||
      slip < 0 ||
      slip > 50 ||
      !Number.isInteger(validSeconds) ||
      validSeconds < 1 ||
      validSeconds > 3600
    ) {
      setLocalError("检查交易设置中的范围");
      return;
    }
    if (legacyPlan && !reason) {
      setLocalError("这场旧版考核仍需选择原有依据");
      return;
    }
    if (planRequired && !plan) {
      setLocalError("这场旧版考核仍需确认原有计划");
      return;
    }
    const warning = side === "buy" ? riskCheck(world, token, amountAtom) : null;
    if (warning) {
      setLocalError(warning);
      return;
    }
    const run = ++operation.current;
    submitting.current = true;
    try {
      if (nativeBalance < (side === "buy" ? units(amountAtom) : 0) + units(gas) * 3) {
        setPreparing(true);
        setTradeStatus("正在准备余额…");
        await prepareTradingBalance({
          worldId: world.id,
          chain: token.chain,
          amount: (w) => (side === "buy" ? (dollarAmount(amount, w.fx[token.chain]) ?? "0") : "1"),
          continueIf: () => operation.current === run && activeRef.current,
          onProgress: () => setTradeStatus("正在准备余额…"),
        });
      }
      if (operation.current !== run || !activeRef.current || document.hidden) return;
      const current = useWorld.getState().world;
      if (!current || current.id !== world.id) throw new Error("市场已变化，请重新确认");
      const actualAmount =
        side === "buy" ? dollarAmount(amount, current.fx[token.chain]) : amountAtom;
      if (!actualAmount) throw new Error("金额低于本场交易精度");
      const risk =
        side === "buy"
          ? riskCheck(
              current,
              current.tokens.find((t) => t.id === token.id)!,
              actualAmount,
            )
          : null;
      if (risk) throw new Error(risk);
      const minOut = (
        (BigInt(quote.amountOut) * BigInt(10_000 - Math.round(slip * 100))) /
        10_000n
      ).toString();
      const commandId = crypto.randomUUID();
      const ok = await dispatch({
        id: commandId,
        type: side,
        tokenId: token.id,
        amount: actualAmount,
        minOut,
        deadline: current.now + validSeconds,
        note: legacyPlan
          ? `${reason}${note.trim() ? `；${note.trim()}` : ""}`
          : note.trim() || `自主${side === "buy" ? "买入" : "卖出"}，自动记录本次交易`,
        stopPrice: plan?.invalidationPrice ?? (stop.trim() ? Number(stop) : undefined),
        targetPrice: plan?.targetPrice ?? (target.trim() ? Number(target) : undefined),
        ...(plan ? { plan } : {}),
      });
      if (!ok) throw new Error(useWorld.getState().error || "这笔交易未能提交");
      if (operation.current === run && activeRef.current && !document.hidden)
        await useWorld.getState().advance(12);
      const tx = useWorld.getState().world?.transactions.find((t) => t.id === commandId);
      if (tx && ["reverted", "dropped", "expired"].includes(tx.status))
        throw new Error(tx.result || "本次未成交");
      toast.success(
        tx?.status === "confirmed"
          ? `已${side === "buy" ? "买入" : "卖出"} ${token.symbol}`
          : "订单已提交，等待成交",
      );
      if (operation.current === run) {
        setAmount("");
        setSellPercent(null);
        setTradeStatus("");
        setPlanDraft((d) => ({ ...d, confirmed: false }));
      }
    } catch (error) {
      if (operation.current === run)
        setLocalError(error instanceof Error ? error.message : "交易未完成");
    } finally {
      if (operation.current === run) {
        submitting.current = false;
        setPreparing(false);
      }
    }
  }
  async function observe() {
    if (busy || preparing || !canTrade) return;
    useWorld.getState().setPlaying(false);
    const run = operation.current;
    if (await dispatch({ id: crypto.randomUUID(), type: "wait", note: "继续观察行情，暂不买卖" })) {
      if (operation.current === run && activeRef.current && !document.hidden)
        await useWorld.getState().advance(60);
    }
  }
  async function saveProtection() {
    setLocalError("");
    const stopPrice = stop.trim() ? Number(stop) : undefined;
    const targetPrice = target.trim() ? Number(target) : undefined;
    if (
      (stopPrice !== undefined &&
        (!Number.isFinite(stopPrice) || stopPrice <= 0 || stopPrice >= price)) ||
      (targetPrice !== undefined && (!Number.isFinite(targetPrice) || targetPrice <= price))
    ) {
      setLocalError("检查失效价和目标价的范围");
      return;
    }
    if (
      await dispatch({
        id: crypto.randomUUID(),
        type: "protect",
        tokenId: token.id,
        stopPrice,
        targetPrice,
      })
    )
      toast.success("自动提交规则已更新");
  }

  return (
    <div className="mw-detail">
      <div className="mw-detail-back">
        <BackButton onClick={onBack} />
        <button
          type="button"
          className={`mw-icon-button ${watched ? "mw-starred" : ""}`}
          aria-label={watched ? "取消关注项目" : "关注项目"}
          onClick={onWatch}
        >
          <Star size={20} fill={watched ? "currentColor" : "none"} />
        </button>
      </div>
      <section className="mw-price-section">
        <div className="mw-inline mw-wrap">
          <ChainBadge id={token.chain} />
          {token.easterEgg ? (
            <EasterEggBadge token={token} />
          ) : (
            <span className="mw-tag">{platformName(token.platformId)}</span>
          )}
          <span className="mw-muted">
            {statusLabel(token)} · {ageLabel(world.now, token.bornAt)}
          </span>
        </div>
        <div className="mw-price-title">
          <TokenAvatar token={token} size={40} />
          <div className="mw-marketcap-figure">
            <span>参考市值</span>
            <strong>
              <AnimatedValue value={marketCap} format={currencyCompact} />
            </strong>
          </div>
          <span className={change >= 0 ? "mw-ok" : "mw-bad"}>
            {change >= 0 ? "+" : ""}
            {change.toFixed(1)}%
          </span>
        </div>
        <div className="mw-detail-unit-price">
          <span>单价</span>
          <Price value={currentPrice} />
          <span className="mw-caption">{token.symbol}</span>
        </div>
        <EasterEggInfo token={token} />
        <CandlestickChart
          history={chartHistory}
          now={world.now}
          scale={fx * (chartMode === "marketCap" ? supply : 1)}
          mode={chartMode}
          onModeChange={setChartMode}
          positionOverlay={chartPosition}
        />
        <div className="mw-price-facts">
          <span>
            池深度 <strong>{currencyCompact(units(token.pool.quote) * fx)}</strong>
          </span>
          <span>
            持币 <strong>{token.holders} 地址</strong>
          </span>
          <span>
            成交 <strong>{token.trades} 笔</strong>
          </span>
        </div>
      </section>
      <section className="mw-panel mw-trade-panel">
        <div className="mw-trade-tabs" aria-label="交易方向">
          {(["buy", "sell"] as const).map((value) => (
            <button
              type="button"
              key={value}
              className={side === value ? "is-active" : ""}
              onClick={() => switchSide(value)}
            >
              {value === "buy" ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}{" "}
              {value === "buy" ? "买入" : "卖出"}
            </button>
          ))}
        </div>
        <div className="mw-trade-wallet">
          <div>
            <span>账户余额</span>
            <strong>${money(cashUsd)}</strong>
            <small>自动准备交易余额</small>
          </div>
          <div>
            <span>当前持仓</span>
            <strong>
              {compact(quantity)} {token.symbol}
            </strong>
            <small>{quantity > 0 ? `预计净退出 ${currencyCompact(exitValue)}` : "尚未买入"}</small>
          </div>
        </div>
        <label className="mw-label mw-amount-field">
          {side === "buy" ? "买入金额 · USD" : `卖出数量 · ${token.symbol}`}
          <input
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setSellPercent(null);
            }}
            inputMode="decimal"
            placeholder="0.00"
            aria-label={side === "buy" ? "买入金额" : "卖出数量"}
            disabled={!canTrade || preparing}
          />
        </label>
        <p className="mw-trade-equivalent">
          {side === "buy"
            ? amountAtom
              ? `预计投入 ${currencyCompact(amountUsd)}`
              : "选择金额，或自己输入"
            : amountAtom && quantity > 0
              ? `约占持仓 ${((units(amountAtom) / quantity) * 100).toFixed(1)}%`
              : "按持仓比例选择，也可输入数量"}
        </p>
        {side === "buy" ? (
          <div className="mw-buy-presets">
            {BUY_PRESETS.map((preset) => {
              const presetAtom = dollarAmount(preset, fx);
              const insufficient = Number(preset) > cashUsd;
              return (
                <button
                  type="button"
                  key={preset}
                  className={amountAtom === presetAtom ? "is-active" : ""}
                  aria-pressed={amountAtom === presetAtom}
                  data-testid={`quick-buy-${preset}`}
                  aria-label={`买入金额 $${preset}`}
                  title={insufficient ? "账户现金不足" : `投入 $${preset}`}
                  disabled={!canTrade || preparing || insufficient}
                  onClick={() => {
                    setAmount(preset);
                    setLocalError("");
                  }}
                >
                  <strong>${preset}</strong>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mw-sell-presets">
            {[25, 50, 75, 100].map((percent) => (
              <button
                type="button"
                key={percent}
                className={sellPercent === percent ? "is-active" : ""}
                aria-pressed={sellPercent === percent}
                data-testid={`quick-sell-${percent}`}
                disabled={
                  !canTrade ||
                  preparing ||
                  (BigInt(position?.quantity ?? "0") * BigInt(percent)) / 100n === 0n
                }
                onClick={() => {
                  setAmount(
                    inputFromAtoms((BigInt(position?.quantity ?? "0") * BigInt(percent)) / 100n),
                  );
                  setSellPercent(percent);
                  setLocalError("");
                }}
              >
                {percent}%
              </button>
            ))}
          </div>
        )}
        {legacyPlan && (
          <label className="mw-label">
            交易依据
            <TrainingSelect
              value={reason}
              onValueChange={setReason}
              options={(side === "buy"
                ? ["流动性与资金流符合我的条件", "观察后进行预算内的小额验证", "按预先计划分批买入"]
                : ["按原计划分批退出", "失效条件已经出现", "降低组合或关联项目暴露"]
              ).map((item) => ({ value: item, label: item }))}
              placeholder="选择本次依据"
              aria-label="交易依据"
            />
          </label>
        )}
        {planRequired && (
          <TradePlanFields
            world={world}
            token={token}
            draft={planDraft}
            onChange={setPlanDraft}
            amountUsd={amountAtom ? amountUsd + units(gas) * fx : 0}
          />
        )}
        {quote && (
          <div className="mw-simple-quote">
            <div>
              <span>{side === "buy" ? "预计买到" : "预计到手"}</span>
              <strong>
                {side === "buy"
                  ? `${compact(units(quote.amountOut))} ${token.symbol}`
                  : currencyCompact(Math.max(0, (units(quote.amountOut) - units(quote.gas)) * fx))}
              </strong>
            </div>
            <div>
              <span>预计费用</span>
              <span>{currencyCompact((units(quote.fee) + units(quote.gas)) * fx)}</span>
            </div>
            {!quote.ok && <p className="mw-inline-error">{quote.error}</p>}
            {quote.ok &&
              side === "buy" &&
              (units(quote.fee) + units(quote.gas)) * fx > amountUsd * 0.1 && (
                <p className="mw-muted">这笔费用占比较高，可以先观察或调整金额。</p>
              )}
          </div>
        )}
        {preparing && (
          <p className="mw-muted" role="status">
            {tradeStatus}
          </p>
        )}
        {localError && (
          <p className="mw-inline-error" role="alert">
            {localError}
          </p>
        )}
        <ActionButton
          busy={busy || preparing}
          disabled={
            !canTrade ||
            isPending ||
            !quote?.ok ||
            !amountAtom ||
            (legacyPlan && !reason) ||
            (planRequired && !plan) ||
            (side === "sell" && quantity <= 0)
          }
          onClick={submit}
        >
          {readOnly
            ? "另一标签正在运行"
            : !canTrade
              ? "当前世界已停止新增交易"
              : isPending
                ? "等待上一笔成交"
                : `${side === "buy" ? "买入" : "卖出"} ${token.symbol}`}
        </ActionButton>
        <ActionButton
          secondary
          disabled={busy || preparing || !canTrade}
          onClick={() => void observe()}
        >
          观察1分钟
        </ActionButton>
        <TrainingDisclosure title="更多设置" summary="成交保护与补充说明">
          <p className="mw-muted">
            买入时自动准备可用余额，兑换与调度费用记入账户。成交以执行时的行情为准。
          </p>
          <label className="mw-label">
            滑点容忍度 · %
            <input
              value={slippage}
              onChange={(event) => setSlippage(event.target.value)}
              inputMode="decimal"
              aria-label="滑点容忍百分比"
            />
          </label>
          <label className="mw-label">
            订单有效期 · 模拟秒
            <input
              type="number"
              min="1"
              max="3600"
              step="1"
              value={validFor}
              onChange={(event) => setValidFor(event.target.value)}
              aria-label="订单有效期模拟秒"
              disabled={!canTrade}
            />
          </label>
          <p className="mw-muted">
            确认后至模拟{" "}
            {Number.isInteger(validSeconds) && validSeconds > 0 ? simTime(deadline) : "—"}{" "}
            有效。过期未执行不扣 gas，执行回退仍可能收链费。
          </p>
          <label className="mw-label">
            随手记 · 选填
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={240}
              rows={2}
              placeholder="记下这笔交易的想法"
            />
          </label>
        </TrainingDisclosure>
        <TrainingDisclosure
          title="自动保护"
          summary={
            world.config.assessmentVersion === "process-v2-trading"
              ? "默认开启 · 可调整参考价"
              : "可选退出条件"
          }
        >
          <p className="mw-muted">
            {world.config.assessmentVersion === "process-v2-trading"
              ? "默认下跌15%、上涨30%或持有15分钟时尝试退出。系统保护不计作自主卖出，触发后仍可能未成交。"
              : "触发后仍需等待成交，费用照常记账。"}{" "}
            下面可调整本链报价单位的参考价。
          </p>
          <label className="mw-label">
            失效价 · {chain.native}
            <input
              inputMode="decimal"
              value={stop}
              onChange={(event) => setStop(event.target.value)}
              placeholder={position?.stopPrice ? String(position.stopPrice) : "低于当前价"}
            />
          </label>
          <label className="mw-label">
            目标价 · {chain.native}
            <input
              inputMode="decimal"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder={position?.targetPrice ? String(position.targetPrice) : "高于当前价"}
            />
          </label>
          {quantity > 0 && (
            <ActionButton secondary busy={busy} disabled={!canTrade} onClick={saveProtection}>
              更新持仓退出规则
            </ActionButton>
          )}
        </TrainingDisclosure>
      </section>
      {position && quantity > 0 && (
        <section className="mw-panel">
          <h3>我的持仓</h3>
          <div className="mw-stats-row">
            <Metric label="持有数量" value={compact(quantity)} sub={token.symbol} />
            <Metric label="余仓成本" value={`$${money(cost)}`} />
            <Metric label="预计净退出" value={`$${money(exitValue)}`} />
            <Metric
              label="退出后相对成本"
              value={`${exitValue >= cost ? "+" : "−"}$${money(Math.abs(exitValue - cost))}`}
              tone={exitValue >= cost ? "ok" : "bad"}
            />
          </div>
          {!canExit && (
            <div className="mw-notice mw-notice-danger">
              <AlertTriangle size={18} />
              <span>{exitReason ?? "当前无法退出"} · 净退出估值 $0.00</span>
            </div>
          )}
          <p className="mw-muted">
            自动保护 · 撤退参考{" "}
            {position.stopPrice ? currencyCompact(position.stopPrice * fx) : "未设置"}
            {" · "}目标参考{" "}
            {position.targetPrice ? currencyCompact(position.targetPrice * fx) : "未设置"}
            {world.config.assessmentVersion === "process-v2-trading" && " · 系统教学预设"}
          </p>
        </section>
      )}
      <TrainingDisclosure title="权限与公开线索" summary="地址、LP、持仓与证据来源">
        <p>{token.narrative}。线索不是安全保证，持币地址不一定代表独立的人。</p>
        <button
          className="mw-contract"
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(token.address);
              setCopied(true);
            } catch {
              toast.error("复制失败，可直接选择地址文本");
            }
          }}
          title="复制模拟合约地址"
        >
          <span>{token.address}</span>
          {copied ? <Check size={16} /> : <Copy size={16} />}
          <span>模拟地址</span>
        </button>
        <div className="mw-facts">
          {publicFacts.map((fact, index) => (
            <div
              className={`mw-fact mw-fact-${fact.tone}`}
              key={`${fact.label}-${index}`}
              data-testid="market-observation"
              data-evidence-status={fact.status}
            >
              <div className="mw-fact-heading">
                <span>{fact.label}</span>
                <span>
                  {
                    (
                      {
                        confirmed: "已确认",
                        inferred: "推测",
                        unknown: "未知",
                        expired: "已过期",
                      } as const
                    )[fact.status]
                  }
                </span>
              </div>
              <p>{fact.value}</p>
              <div className="mw-evidence-meta">
                <span>来源：{fact.source}</span>
                <span>
                  {simTime(fact.observedAt)} ·{" "}
                  {fact.freshness === "current" ? "当前快照" : "信息陈旧"} · 证据置信{" "}
                  {Math.round(fact.confidence * 100)}%
                </span>
              </div>
            </div>
          ))}
        </div>
        <p className="mw-muted">
          置信程度描述证据，不是安全概率。锁 LP 不防大户卖币，过去能卖也不保证下一次退出。
        </p>
        <p className="mw-muted">观察期成交额 {currencyCompact(token.volume)}</p>
      </TrainingDisclosure>
      <TrainingDisclosure title="相关讨论" summary="已确认消息与虚构社区观点">
        <MarketNews world={world} tokenId={token.id} compact />
      </TrainingDisclosure>
      <TrainingDisclosure title="本项目事件" summary="只看已发生的记录">
        <div className="mw-event-list">
          {world.events
            .filter((event) => event.tokenId === token.id && event.at <= world.now)
            .slice(-8)
            .reverse()
            .map((event) => (
              <div className="mw-event" key={event.id}>
                <time>{simTime(event.at)}</time>
                <span>{event.message}</span>
              </div>
            ))}
          {!world.events.some((event) => event.tokenId === token.id) && (
            <p className="mw-muted">暂无事件记录。</p>
          )}
        </div>
      </TrainingDisclosure>
    </div>
  );
}
