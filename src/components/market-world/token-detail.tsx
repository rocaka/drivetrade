import { TrainingSelect } from "@/components/training-select";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clock3,
  Copy,
  ShieldCheck,
  Star,
} from "lucide-react";
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
  Price,
  ageLabel,
  chainSpec,
  platformName,
  simTime,
  statusLabel,
} from "./shared";
import { MarketNews } from "./market-news";
import { TokenAvatar } from "./token-avatar";
import { PriceChart } from "./price-chart";
import "./token-detail.css";
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
    const past = token.history.at(-1)?.t === world.now ? token.history.slice(0, -1) : token.history;
    const open = past.at(-1)?.price ?? price;
    // The forming window: previous close, live extremes and the running volume total.
    const current = {
      t: world.now,
      price,
      volume: token.volume,
      open,
      high: Math.max(open, price, token.bar?.high ?? price),
      low: Math.min(open, price, token.bar?.low ?? price),
    };
    return [...past, current];
  }, [token.history, token.bar, token.volume, world.now, price]);
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

  const tradeRef = useRef<HTMLElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [tradeInView, setTradeInView] = useState(true);
  useEffect(() => {
    const element = tradeRef.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setTradeInView(entry.isIntersecting), {
      threshold: 0.15,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  function openTicket(next: Side, percent?: number) {
    if (preparing) return;
    if (next !== side) switchSide(next);
    if (percent !== undefined && position) {
      setAmount(inputFromAtoms((BigInt(position.quantity) * BigInt(percent)) / 100n));
      setSellPercent(percent);
      setLocalError("");
    }
    tradeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (percent === undefined) window.setTimeout(() => amountRef.current?.focus({ preventScroll: true }), 350);
  }
  const positionPnl = exitValue - cost;
  const positionPct = cost > 0 ? (positionPnl / cost) * 100 : null;
  const feeUsd = quote ? (units(quote.fee) + units(quote.gas)) * fx : 0;
  const receiveText = quote
    ? side === "buy"
      ? `${compact(units(quote.amountOut))} ${token.symbol}`
      : currencyCompact(Math.max(0, (units(quote.amountOut) - units(quote.gas)) * fx))
    : "—";
  const disabledReason = readOnly
    ? "另一标签正在运行"
    : !canTrade
      ? "当前世界已停止新增交易"
      : isPending
        ? "等待上一笔成交"
        : null;

  return (
    <div className="mw-detail td" data-side={side}>
      <div className="td-topbar">
        <BackButton onClick={onBack} />
        <button
          type="button"
          className={`mw-icon-button ${watched ? "mw-starred" : ""}`}
          aria-label={watched ? "取消关注项目" : "关注项目"}
          aria-pressed={watched}
          onClick={onWatch}
        >
          <Star size={20} fill={watched ? "currentColor" : "none"} />
        </button>
      </div>

      <header className="td-head">
        <div className="td-identity">
          <TokenAvatar token={token} size={48} />
          <div className="td-identity-text">
            <h2>
              {token.name} <span>{token.symbol}</span>
            </h2>
            <div className="td-badges">
              <ChainBadge id={token.chain} />
              {token.easterEgg ? (
                <EasterEggBadge token={token} />
              ) : (
                <span className="mw-tag">{platformName(token.platformId)}</span>
              )}
              <span className="td-age">
                {statusLabel(token)} · {ageLabel(world.now, token.bornAt)}
              </span>
            </div>
          </div>
        </div>
        <div className="td-quote">
          <span className="td-quote-label">参考市值</span>
          <div className="td-quote-row">
            <strong>
              <AnimatedValue value={marketCap} format={currencyCompact} />
            </strong>
            <span className={`td-change ${change >= 0 ? "is-up" : "is-down"}`}>
              {change >= 0 ? "+" : ""}
              {change.toFixed(1)}%
            </span>
          </div>
          <p className="td-unit-price">
            单价 <Price value={currentPrice} />
          </p>
        </div>
        <dl className="td-stats">
          <div>
            <dt>池深度</dt>
            <dd>{currencyCompact(units(token.pool.quote) * fx)}</dd>
          </div>
          <div>
            <dt>持币地址</dt>
            <dd>{token.holders}</dd>
          </div>
          <div>
            <dt>成交笔数</dt>
            <dd>{token.trades}</dd>
          </div>
          <div>
            <dt>成交额</dt>
            <dd>{currencyCompact(token.volume)}</dd>
          </div>
        </dl>
        <EasterEggInfo token={token} />
      </header>

      <section className="td-card td-chart" aria-label="行情图">
        <PriceChart
          history={chartHistory}
          now={world.now}
          scale={fx * (chartMode === "marketCap" ? supply : 1)}
          mode={chartMode}
          onModeChange={setChartMode}
          positionOverlay={chartPosition}
        />
      </section>

      {position && quantity > 0 && (
        <section className="td-card td-position" aria-label="我的持仓">
          <div className="td-position-head">
            <div>
              <span className="td-caption">我的持仓 · 净退出盈亏</span>
              <strong className={positionPnl >= 0 ? "is-up" : "is-down"}>
                {positionPnl >= 0 ? "+" : "−"}${money(Math.abs(positionPnl))}
                {positionPct !== null ? (
                  <small>
                    {positionPct >= 0 ? "+" : ""}
                    {positionPct.toFixed(2)}%
                  </small>
                ) : null}
              </strong>
            </div>
            <span className="td-position-qty">
              {compact(quantity)} {token.symbol}
            </span>
          </div>
          <dl className="td-position-grid">
            <div>
              <dt>余仓成本</dt>
              <dd>${money(cost)}</dd>
            </div>
            <div>
              <dt>预计净退出</dt>
              <dd>${money(exitValue)}</dd>
            </div>
            <div>
              <dt>撤退参考 · 市值</dt>
              <dd>
                {position.stopPrice ? currencyCompact(position.stopPrice * fx * supply) : "未设置"}
              </dd>
            </div>
            <div>
              <dt>目标参考 · 市值</dt>
              <dd>
                {position.targetPrice ? currencyCompact(position.targetPrice * fx * supply) : "未设置"}
              </dd>
            </div>
          </dl>
          {!canExit && (
            <div className="mw-notice mw-notice-danger">
              <AlertTriangle size={18} />
              <span>{exitReason ?? "当前无法退出"} · 净退出估值 $0.00</span>
            </div>
          )}
          <div className="td-position-actions">
            <button type="button" disabled={!canTrade} onClick={() => openTicket("sell", 50)}>
              卖出一半
            </button>
            <button type="button" disabled={!canTrade} onClick={() => openTicket("sell", 100)}>
              全部卖出
            </button>
          </div>
          {world.config.assessmentVersion === "process-v2-trading" && (
            <p className="td-caption">
              <ShieldCheck size={13} /> 自动保护为系统教学预设，可在交易面板中调整
            </p>
          )}
        </section>
      )}

      <section ref={tradeRef} className="td-card td-trade" aria-label="交易">
        <div className="td-side" role="tablist" aria-label="交易方向">
          {(["buy", "sell"] as const).map((value) => (
            <button
              type="button"
              role="tab"
              key={value}
              aria-selected={side === value}
              className={`is-${value}`}
              onClick={() => switchSide(value)}
            >
              {value === "buy" ? "买入" : "卖出"}
            </button>
          ))}
        </div>

        <div className="td-balance">
          {side === "buy" ? (
            <>
              <span>可用资金</span>
              <strong>${money(cashUsd)}</strong>
            </>
          ) : (
            <>
              <span>持有</span>
              <strong>
                {compact(quantity)} {token.symbol}
                {quantity > 0 ? <small> ≈ {currencyCompact(exitValue)}</small> : null}
              </strong>
            </>
          )}
        </div>

        <label className="td-amount">
          <span className="sr-only">
            {side === "buy" ? "买入金额（美元）" : `卖出数量（${token.symbol}）`}
          </span>
          {side === "buy" ? <span className="td-amount-affix">$</span> : null}
          <input
            ref={amountRef}
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setSellPercent(null);
            }}
            inputMode="decimal"
            placeholder="0"
            aria-label={side === "buy" ? "买入金额" : "卖出数量"}
            disabled={!canTrade || preparing}
          />
          {side === "sell" ? <span className="td-amount-affix">{token.symbol}</span> : null}
        </label>

        {side === "buy" ? (
          <div className="td-presets">
            {BUY_PRESETS.map((preset) => {
              const presetAtom = dollarAmount(preset, fx);
              const insufficient = Number(preset) > cashUsd;
              return (
                <button
                  type="button"
                  key={preset}
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
                  ${preset}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="td-presets">
            {[25, 50, 75, 100].map((percent) => (
              <button
                type="button"
                key={percent}
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
                {percent === 100 ? "全部" : `${percent}%`}
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

        <dl className="td-summary">
          <div>
            <dt>{side === "buy" ? "预计买到" : "预计到手"}</dt>
            <dd className="td-summary-main">{receiveText}</dd>
          </div>
          <div>
            <dt>费用（含链费）</dt>
            <dd>{quote ? currencyCompact(feeUsd) : "—"}</dd>
          </div>
          <div>
            <dt>价格影响</dt>
            <dd className={quote && quote.impactPct >= 5 ? "is-down" : undefined}>
              {quote ? `${quote.impactPct < 0.01 ? "<0.01" : quote.impactPct.toFixed(2)}%` : "—"}
            </dd>
          </div>
          <div>
            <dt>滑点容忍</dt>
            <dd>{slippage}%</dd>
          </div>
        </dl>
        {quote && !quote.ok && <p className="mw-inline-error">{quote.error}</p>}
        {quote?.ok && side === "buy" && feeUsd > amountUsd * 0.1 && (
          <p className="td-hint">这笔费用占比较高，可以先观察或调整金额。</p>
        )}
        {preparing && (
          <p className="td-hint" role="status">
            {tradeStatus}
          </p>
        )}
        {localError && (
          <p className="mw-inline-error" role="alert">
            {localError}
          </p>
        )}

        <ActionButton
          className={`td-submit is-${side}`}
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
          {disabledReason ??
            (side === "sell" && quantity <= 0
              ? "还没有可卖的持仓"
              : `${side === "buy" ? "买入" : "卖出"} ${token.symbol}`)}
        </ActionButton>
        <button
          type="button"
          className="td-observe"
          disabled={busy || preparing || !canTrade}
          onClick={() => void observe()}
        >
          <Clock3 size={15} />
          先不动，观察 1 分钟
        </button>

        <TrainingDisclosure title="交易设置" summary={`滑点 ${slippage}% · 有效期 ${validFor} 秒 · 随手记`}>
          <p className="mw-muted">
            买入时自动准备可用余额，兑换与调度费用记入账户。成交以执行时的行情为准。
          </p>
          <div className="td-settings-row">
            <span>滑点容忍</span>
            <div className="td-presets td-presets-small">
              {["1", "5", "10"].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={slippage === value}
                  onClick={() => setSlippage(value)}
                >
                  {value}%
                </button>
              ))}
            </div>
          </div>
          <label className="mw-label">
            自定义滑点 · %
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

      <div className="td-info">
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

      <div className={`td-dock ${tradeInView ? "is-hidden" : ""}`} aria-hidden={tradeInView}>
        <button
          type="button"
          className="is-buy"
          tabIndex={tradeInView ? -1 : 0}
          disabled={!canTrade}
          onClick={() => openTicket("buy")}
        >
          买入
        </button>
        <button
          type="button"
          className="is-sell"
          tabIndex={tradeInView ? -1 : 0}
          disabled={!canTrade || quantity <= 0}
          onClick={() => openTicket("sell")}
        >
          卖出
        </button>
        <button
          type="button"
          className="td-dock-observe"
          tabIndex={tradeInView ? -1 : 0}
          aria-label="观察 1 分钟"
          disabled={busy || preparing || !canTrade}
          onClick={() => void observe()}
        >
          <Clock3 size={18} />
        </button>
      </div>
    </div>
  );
}
