import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  Eye,
  ShieldCheck,
  RotateCcw,
} from "lucide-react";
import { Button, fieldClass } from "@/components/discipline/ui";
import { TextReveal, TrainingDisclosure } from "@/components/training-ui";
import { TrainingSelect } from "@/components/training-select";
import { formatPrice, money } from "@/lib/world/amount";
import {
  ADVANCED_LAB_CHALLENGES,
  ADVANCED_RISK_CENTS,
  applyLabAction,
  evaluateLabs,
  LAB_CHALLENGES,
  getLabChallenge,
  tradingBuyQuote,
  labEquity,
  labPrice,
  labResult,
  labSellQuote,
  makeLabRun,
  replayLabRun,
} from "@/lib/training-lab/engine";
import type { LabAction, LabRun, LabToken } from "@/lib/training-lab/types";
import "./practical-lab.css";

type Props = {
  challengeId?: string;
  runs: readonly LabRun[];
  onSave: (run: LabRun) => Promise<boolean>;
  onClose: () => void;
  /** Opens another challenge; offered as "next" once this one is saved. */
  onOpen?: (id: string) => void;
};
type Draft = { seed: string; actions: LabAction[] };
const draftKey = (id: string) => `td-practical-draft-v1:${id}`;
function fresh(): Draft {
  return { seed: crypto.randomUUID(), actions: [] };
}
function initialDraft(id: string): Draft {
  try {
    const raw = JSON.parse(localStorage.getItem(draftKey(id)) ?? "null");
    if (raw && typeof raw.seed === "string" && Array.isArray(raw.actions)) {
      replayLabRun({ challengeId: id, seed: raw.seed, actions: raw.actions });
      return { seed: raw.seed, actions: raw.actions };
    }
  } catch {
    /* Keep invalid draft separate from saved evidence. */
  }
  return fresh();
}
export function PracticalLab({ challengeId, runs, onSave, onClose, onOpen }: Props) {
  const [selected, setSelected] = useState(challengeId);
  useEffect(() => setSelected(challengeId), [challengeId]);
  const summary = useMemo(() => evaluateLabs(runs), [runs]);
  const advanced = useMemo(() => evaluateLabs(runs, ADVANCED_LAB_CHALLENGES), [runs]);
  const picked = selected ? getLabChallenge(selected) : undefined;
  const track = advanced.checks.some((c) => c.id === picked?.id) ? advanced : summary;
  // Next unfinished challenge in the same track, wrapping around to earlier gaps.
  const pickedIndex = track.checks.findIndex((c) => c.id === picked?.id);
  const nextCheck = [
    ...track.checks.slice(pickedIndex + 1),
    ...track.checks.slice(0, Math.max(0, pickedIndex)),
  ].find((c) => !c.passed);
  const next = nextCheck ? getLabChallenge(nextCheck.id) : undefined;
  if (picked && picked.id.startsWith("trade-practice-"))
    return (
      <TradingSession
        key={picked.id}
        challengeId={picked.id}
        runs={runs}
        onSave={onSave}
        onClose={() => (challengeId ? onClose() : setSelected(undefined))}
        next={
          next ? { title: next.title, open: () => (onOpen ?? setSelected)(next.id) } : undefined
        }
        progress={{ completed: track.completed, required: track.required }}
      />
    );
  if (picked)
    return (
      <LabSession
        key={picked.id}
        challengeId={picked.id}
        runs={runs}
        onSave={onSave}
        onClose={() => (challengeId ? onClose() : setSelected(undefined))}
      />
    );
  return (
    <article className="practical-lab academy-reader" data-testid="practical-lab-picker">
      <button className="lab-back" onClick={onClose}>
        <ArrowLeft size={16} />
        返回训练
      </button>
      <p className="academy-eyebrow">
        实操实验室 · {summary.completed} / {summary.required}
      </p>
      <TextReveal text={"决定之后，\n亲手执行。"} as="h2" />
      <p className="lab-intro">
        选金额，买入、卖出，或者继续观察。每一关只练一个交易习惯，结果由实际操作记录。
      </p>
      <div className="lab-challenge-list">
        {LAB_CHALLENGES.map((c, i) => {
          const record = summary.checks[i];
          return (
            <button key={c.id} onClick={() => setSelected(c.id)} data-testid={`lab-open-${i + 1}`}>
              <span className={`lab-number ${record.passed ? "is-done" : ""}`}>
                {record.passed ? <Check size={17} /> : String(i + 1).padStart(2, "0")}
              </span>
              <span>
                <strong>{c.title}</strong>
                <small>
                  {record.passed
                    ? "实操达标"
                    : record.bestScore
                      ? `最高 ${record.bestScore} 分 · 继续练习`
                      : "待完成实际操作"}
                </small>
              </span>
              <ChevronRight size={18} />
            </button>
          );
        })}
      </div>
      <p className="academy-eyebrow lab-track-heading">
        进阶实操 · 选做 · {advanced.completed} / {advanced.required}
      </p>
      <div className="lab-challenge-list">
        {ADVANCED_LAB_CHALLENGES.map((c, i) => {
          const record = advanced.checks[i];
          return (
            <button
              key={c.id}
              onClick={() => setSelected(c.id)}
              data-testid={`lab-open-advanced-${i + 1}`}
            >
              <span className={`lab-number ${record.passed ? "is-done" : ""}`}>
                {record.passed ? <Check size={17} /> : `进${i + 1}`}
              </span>
              <span>
                <strong>{c.title}</strong>
                <small>
                  {record.passed
                    ? "实操达标"
                    : record.bestScore
                      ? `最高 ${record.bestScore} 分 · 继续练习`
                      : c.summary}
                </small>
              </span>
              <ChevronRight size={18} />
            </button>
          );
        })}
      </div>
      <p className="lab-footnote">虚拟资金 · 操作自动记录 · 每次练习的结果都会保留</p>
    </article>
  );
}
function LabSession({
  challengeId,
  runs,
  onSave,
  onClose,
}: Required<Pick<Props, "onSave" | "onClose" | "runs">> & { challengeId: string }) {
  const challenge = getLabChallenge(challengeId)!;
  const [draft, setDraft] = useState<Draft>(() => initialDraft(challengeId));
  const [tokenId, setTokenId] = useState("token-a");
  const [amount, setAmount] = useState("4");
  const [percent, setPercent] = useState<25 | 50 | 100>(100);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [stop, setStop] = useState("");
  const [slippage, setSlippage] = useState("5");
  const [ttl, setTtl] = useState("6");
  const [factsOpen, setFactsOpen] = useState(false);
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const actionLock = useRef(false),
    saveLock = useRef(false);
  const state = useMemo(() => replayLabRun({ challengeId, ...draft }), [challengeId, draft]);
  const token = state.tokens.find((t) => t.id === tokenId) ?? state.tokens[0];
  const position = state.positions[token.id];
  const result = labResult(state);
  const saved = runs.some(
    (r) =>
      r.challengeId === challengeId &&
      r.seed === draft.seed &&
      JSON.stringify(r.actions) === JSON.stringify(draft.actions),
  );
  useEffect(() => {
    try {
      localStorage.setItem(draftKey(challengeId), JSON.stringify(draft));
    } catch {
      setError("本次草稿未能写入本机，离开前请保存完整记录。");
    }
    actionLock.current = false;
  }, [challengeId, draft]);
  function act(action: LabAction) {
    setError("");
    if (saving || saveLock.current || actionLock.current || state.finished) return;
    if (draft.actions.length >= 199) {
      setError("本次操作已达上限，请保存结果后重试。");
      return;
    }
    actionLock.current = true;
    try {
      const next = applyLabAction(state, action);
      const failure = next.events
        .slice(state.events.length)
        .find((event) => ["rejected", "reverted", "restricted-exit"].includes(event.type));
      if (failure) setError(failure.message);
      setDraft((d) => ({ ...d, actions: [...d.actions, action] }));
    } catch {
      actionLock.current = false;
      setError("操作无法解析，请检查输入。");
    }
  }
  async function seal() {
    if (saveLock.current || actionLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setError("");
    try {
      const actions = state.finished
        ? draft.actions
        : [...draft.actions, { type: "finish" } as const];
      const run = makeLabRun(challengeId, draft.seed, actions);
      setDraft((d) => ({ ...d, actions }));
      if (!(await onSave(run))) setError("证据尚未保存，请保留页面后重试。");
    } catch {
      setError("保存未完成，操作草稿仍保留。");
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }
  function retry() {
    setDraft(fresh());
    setTokenId("token-a");
    setFactsOpen(false);
    setStop("");
    setError("");
  }
  const pnl = labEquity(state) - state.initialEquityCents,
    quote = labSellQuote(state, token.id, percent);
  const cash = state.cash[token.chain],
    gas = state.gas[token.chain];
  const now = `${String(Math.floor(state.step / 2)).padStart(2, "0")}:${state.step % 2 ? "30" : "00"}`;
  return (
    <article
      className="practical-lab academy-reader"
      data-testid="practical-lab-session"
      data-challenge-id={challengeId}
    >
      <button className="lab-back" onClick={onClose}>
        <ArrowLeft size={16} />
        返回实操
      </button>
      <p className="academy-eyebrow">历史实操 · 原版</p>
      <TextReveal text={challenge.title} as="h2" />
      <p className="lab-goal">{challenge.goal}</p>
      <div className="lab-account">
        <div>
          <small>本关权益</small>
          <strong>${money(labEquity(state) / 100)}</strong>
        </div>
        <div className={pnl < 0 ? "is-loss" : pnl > 0 ? "is-profit" : ""}>
          <small>相对开局</small>
          <strong>
            {pnl < 0 ? "−" : "+"}${money(Math.abs(pnl) / 100)}
          </strong>
        </div>
        <span>
          <Clock3 size={13} />
          {now}
        </span>
      </div>
      {state.finished ? (
        <>
          <div
            className="lab-result"
            role="status"
            data-testid="lab-result"
            data-passed={result.passed}
          >
            <ShieldCheck size={24} />
            <div>
              <TextReveal as="h3" text={result.passed ? "这次执行达标。" : "把这一处再练稳。"} />
              <p>
                {result.score} / 100 · 实际费用 ${money(result.feesCents / 100)}
              </p>
            </div>
          </div>
          <div className="lab-checks">
            {result.checks.map((c) => (
              <div key={c.id}>
                <span className={c.passed ? "is-profit" : "is-loss"}>{c.passed ? "✓" : "○"}</span>
                <div>
                  <strong>{c.title}</strong>
                  <p>{c.passed ? "已从本次操作验证。" : c.detail}</p>
                </div>
              </div>
            ))}
          </div>
          <Button disabled={saving || saved} onClick={() => void seal()}>
            {saved ? (
              <>
                <Check size={17} />
                完整证据已保存
              </>
            ) : saving ? (
              "正在保存…"
            ) : (
              "保存本次完整记录"
            )}
          </Button>
          <div className="lab-two-actions">
            <Button variant="ghost" disabled={!saved || saving} onClick={retry}>
              <RotateCcw size={16} />
              同关换种子再练
            </Button>
            <Button variant="ghost" onClick={onClose}>
              返回训练
              <ArrowRight size={16} />
            </Button>
          </div>
        </>
      ) : (
        <>
          {state.tokens.length > 1 && (
            <div className="lab-token-tabs" aria-label="实操项目">
              {state.tokens.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setTokenId(t.id);
                    setFactsOpen(false);
                  }}
                  aria-pressed={token.id === t.id}
                >
                  <span>{t.symbol}</span>
                  <small>
                    {t.chain} · {t.address}
                  </small>
                </button>
              ))}
            </div>
          )}
          <div className="lab-market-heading">
            <div>
              <small>
                {token.chain} · {token.address}
              </small>
              <h3>
                {token.name} <span>{token.symbol}</span>
              </h3>
            </div>
            <strong>${formatPrice(labPrice(token))}</strong>
          </div>
          <LabChart token={token} stopPrice={state.stopPlans[token.id]} />
          <div className="lab-market-meta">
            <span>池深 ${money(token.poolCash / 100)}</span>
            <span>
              {token.curveRemainingCents === null
                ? "池上交易"
                : `曲线余量 $${money(token.curveRemainingCents / 100)}`}
            </span>
            <span>讨论热度 {token.hype}</span>
          </div>
          <button
            className="lab-inspect"
            onClick={() => {
              setFactsOpen((v) => !v);
              if (!state.inspected.includes(token.id)) act({ type: "inspect", tokenId: token.id });
            }}
            aria-expanded={factsOpen}
          >
            <Eye size={15} />
            {state.inspected.includes(token.id)
              ? "已核对链与合约 · 查看事实"
              : "核对链、合约与退出报价"}
            <ChevronRight size={16} />
          </button>
          {factsOpen && (
            <div className="lab-facts">
              <p>
                链与地址：{token.chain} / {token.address}
              </p>
              <p>LP：{token.lockedLP ? "锁定，持币者仍可正常卖出" : "持有人可撤出流动性"}</p>
              <p>权限：{token.frozen ? "当前卖出受限" : "当前允许卖出，不保证以后不变"}</p>
              <p>关联簇：{token.cluster}</p>
              <p>
                持仓全额预计净退出：
                {position?.units
                  ? labSellQuote(state, token.id).ok
                    ? `$${money(labSellQuote(state, token.id).netCents / 100)}`
                    : labSellQuote(state, token.id).error
                  : "暂无持仓"}
              </p>
            </div>
          )}
          <section className="lab-ticket">
            <div className="lab-direction">
              <button aria-pressed={side === "buy"} onClick={() => setSide("buy")}>
                买入
              </button>
              <button aria-pressed={side === "sell"} onClick={() => setSide("sell")}>
                卖出
              </button>
            </div>
            <div className="lab-ticket-balances">
              <span>
                本链可用<strong>${money(cash / 100)}</strong>
              </span>
              <span>
                本链 gas<strong>${money(gas / 100)}</strong>
              </span>
              <span>
                持仓数量
                <strong>
                  {((position?.units ?? 0) / 1_000_000).toLocaleString("zh-CN", {
                    maximumFractionDigits: 4,
                  })}
                </strong>
              </span>
            </div>
            {side === "buy" ? (
              <>
                <label className="lab-label">
                  买入金额 · 训练美元
                  <input
                    className={fieldClass}
                    aria-label="实操买入金额"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <div className="lab-presets">
                  {["1", "4", "8"].map((v) => (
                    <button key={v} onClick={() => setAmount(v)} aria-pressed={amount === v}>
                      ${v}
                    </button>
                  ))}
                </div>
                <Button
                  disabled={
                    saving ||
                    state.orders.some((o) => o.status === "pending") ||
                    !Number.isFinite(Number(amount)) ||
                    Number(amount) <= 0
                  }
                  onClick={() =>
                    act({
                      type: "buy",
                      tokenId: token.id,
                      cents: Math.round(Number(amount) * 100),
                      slippageBps: Math.round(Number(slippage) * 100),
                      ttlSteps: Number(ttl),
                    })
                  }
                >
                  {state.orders.some((o) => o.status === "pending")
                    ? "已有意图等待执行"
                    : `确认买入 ${token.symbol}`}
                </Button>
              </>
            ) : (
              <>
                <div className="lab-presets">
                  {([25, 50, 100] as const).map((v) => (
                    <button key={v} onClick={() => setPercent(v)} aria-pressed={percent === v}>
                      {v}%
                    </button>
                  ))}
                </div>
                <p className="lab-exit-quote">
                  {quote.ok ? `预计净回款 $${money(quote.netCents / 100)}` : quote.error}
                </p>
                <Button
                  disabled={!position?.units || saving}
                  onClick={() => act({ type: "sell", tokenId: token.id, percent })}
                >
                  {token.frozen ? "确认尝试退出（当前受限）" : `确认卖出 ${percent}%`}
                </Button>
              </>
            )}
            <TrainingDisclosure title="资金与执行设置" summary="补 gas · 跨链 · 冻结失效价">
              <Button
                variant="ghost"
                onClick={() => act({ type: "fund", chain: token.chain, cents: 100 })}
              >
                用本链 $1 稳定资金补 gas
              </Button>
              {challengeId === "practice-9" && (
                <Button
                  variant="ghost"
                  disabled={state.bridge?.status === "pending"}
                  onClick={() => act({ type: "bridge", from: "solana", to: "base", cents: 1000 })}
                >
                  Solana → Base 调度 $10
                </Button>
              )}
              <label className="lab-label">
                失效价 · 美元
                <input
                  className={fieldClass}
                  aria-label="实操失效价"
                  inputMode="decimal"
                  value={stop}
                  onChange={(e) => setStop(e.target.value)}
                  placeholder={`例如 ${formatPrice(labPrice(token) * 0.85)}`}
                  disabled={state.stopPlans[token.id] !== undefined}
                />
              </label>
              <Button
                variant="ghost"
                disabled={
                  state.stopPlans[token.id] !== undefined ||
                  !Number.isFinite(Number(stop)) ||
                  Number(stop) <= 0
                }
                onClick={() => act({ type: "plan", tokenId: token.id, stopPrice: Number(stop) })}
              >
                {state.stopPlans[token.id] !== undefined
                  ? `已冻结 $${formatPrice(state.stopPlans[token.id])}`
                  : "冻结本次失效价"}
              </Button>
              {challengeId === "practice-10" && (
                <div className="lab-two-fields">
                  <label className="lab-label">
                    滑点 %
                    <TrainingSelect
                      aria-label="实操滑点"
                      value={slippage}
                      onValueChange={setSlippage}
                      options={["1", "3", "5"].map((value) => ({ value, label: `${value}%` }))}
                    />
                  </label>
                  <label className="lab-label">
                    有效期
                    <TrainingSelect
                      aria-label="实操有效期"
                      value={ttl}
                      onValueChange={setTtl}
                      options={["1", "3", "6"].map((value) => ({ value, label: `${value} 步` }))}
                    />
                  </label>
                </div>
              )}
            </TrainingDisclosure>
          </section>
          <div className="lab-two-actions">
            <Button variant="ghost" onClick={() => act({ type: "wait", steps: 1 })}>
              <Clock3 size={16} />
              观察30秒
            </Button>
            <Button variant="ghost" onClick={() => act({ type: "wait", steps: 4 })}>
              观察2分钟
            </Button>
          </div>
          {state.bridge && (
            <p className="lab-inline-state">
              {state.bridge.status === "pending"
                ? `$${money(state.bridge.cents / 100)} 在途 · 剩余 ${state.bridge.dueStep - state.step} 步`
                : `$${money(state.bridge.cents / 100)} 已到账 ${state.bridge.to}`}
            </p>
          )}
          {state.orders.length > 0 && (
            <div className="lab-order-list">
              {state.orders.map((o) => (
                <p key={o.id}>
                  意图 {o.id} ·{" "}
                  {
                    {
                      pending: "待执行",
                      confirmed: "已成交",
                      reverted: "已回退",
                      expired: "已过期",
                    }[o.status]
                  }
                  <span>{o.message}</span>
                </p>
              ))}
            </div>
          )}
          <Button variant="ghost" disabled={saving} onClick={() => void seal()}>
            <Check size={16} />
            完成并保存本次实操
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="lab-error">
          {error}
        </p>
      )}
      <TrainingDisclosure
        title="本次操作"
        summary={`${draft.actions.length} 个动作 · 实际费用 $${money(state.feesCents / 100)}`}
      >
        <ol className="lab-log">
          {state.events
            .slice(-16)
            .reverse()
            .map((e, i) => (
              <li key={`${state.events.length - i}`}>
                <time>
                  {String(Math.floor(e.step / 2)).padStart(2, "0")}:{e.step % 2 ? "30" : "00"}
                </time>
                <span>{e.message}</span>
              </li>
            ))}
        </ol>
      </TrainingDisclosure>
      <TrainingDisclosure title="本关规则">
        <ul className="lab-rules">
          {challenge.rules.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className="lab-footnote">
          本关是受控AMM实操，不是自由世界。所有余额和行情均为教学模拟；保存时由种子与操作重放结果。
        </p>
      </TrainingDisclosure>
    </article>
  );
}
function LabChart({
  token,
  stopPrice,
  stopLabel = "冻结失效价",
}: {
  token: LabToken;
  stopPrice?: number;
  stopLabel?: string;
}) {
  const values = token.history.map((p) => p.price),
    min = Math.min(...values),
    max = Math.max(...values),
    span = Math.max(max - min, max * 0.02),
    bottom = Math.max(0, min - span * 0.1),
    top = max + span * 0.1;
  const y = (v: number) => 115 - ((v - bottom) / (top - bottom)) * 95;
  const points = token.history
    .map((p, i) => `${12 + (i / Math.max(1, token.history.length - 1)) * 278},${y(p.price)}`)
    .join(" ");
  const up = values.at(-1)! >= values[0];
  return (
    <svg
      className={`lab-chart ${up ? "is-profit" : "is-loss"}`}
      viewBox="0 0 360 142"
      role="img"
      aria-label={`本关已发生价格，从${formatPrice(values[0])}到${formatPrice(values.at(-1)!)}美元`}
      data-testid="lab-price-chart"
    >
      {[25, 70, 115].map((v) => (
        <line key={v} x1="12" y1={v} x2="290" y2={v} className="lab-grid" />
      ))}
      <text x="302" y="28">
        ${formatPrice(top)}
      </text>
      <text x="302" y="118">
        ${formatPrice(bottom)}
      </text>
      {stopPrice && stopPrice >= bottom && stopPrice <= top && (
        <>
          <line x1="12" y1={y(stopPrice)} x2="290" y2={y(stopPrice)} className="lab-stop" />
          <text x="12" y={y(stopPrice) - 5}>
            {stopLabel}
          </text>
        </>
      )}
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle
        cx={token.history.length > 1 ? 290 : 12}
        cy={y(values.at(-1)!)}
        r="2.5"
        fill="currentColor"
      />
      <text x="12" y="138">
        00:00
      </text>
      <text x="262" y="138">
        {String(Math.floor((token.history.at(-1)?.step ?? 0) / 2)).padStart(2, "0")}:
        {(token.history.at(-1)?.step ?? 0) % 2 ? "30" : "00"}
      </text>
    </svg>
  );
}

function TradingSession({
  challengeId,
  runs,
  onSave,
  onClose,
  next,
  progress,
}: Required<Pick<Props, "onSave" | "onClose" | "runs">> & {
  challengeId: string;
  next?: { title: string; open: () => void };
  progress: { completed: number; required: number };
}) {
  const challenge = getLabChallenge(challengeId)!;
  const [draft, setDraft] = useState<Draft>(() => initialDraft(challengeId));
  const [tokenId, setTokenId] = useState("token-a");
  const [amount, setAmount] = useState("4");
  const [percent, setPercent] = useState<25 | 50 | 100>(100);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const busy = useRef(false),
    saveBusy = useRef(false);
  const state = useMemo(() => replayLabRun({ challengeId, ...draft }), [challengeId, draft]);
  const token = state.tokens.find((t) => t.id === tokenId) ?? state.tokens[0];
  const p = state.positions[token.id],
    plan = state.trading!.plans[token.id];
  const result = labResult(state),
    quote = labSellQuote(state, token.id, percent);
  const enteredCents = Math.round(Number(amount) * 100),
    buyQuote = tradingBuyQuote(state, token.id, enteredCents);
  const pending = state.orders.some((o) => o.status === "pending");
  const saved = runs.some(
    (r) =>
      r.version === "lab-v2-trading" &&
      r.challengeId === challengeId &&
      r.seed === draft.seed &&
      JSON.stringify(r.actions) === JSON.stringify(draft.actions),
  );
  useEffect(() => {
    try {
      localStorage.setItem(draftKey(challengeId), JSON.stringify(draft));
    } catch {
      setError("操作草稿未能保存，离开前请保存本次记录。");
    }
    busy.current = false;
  }, [challengeId, draft]);
  function act(action: LabAction) {
    if (busy.current || saveBusy.current || state.finished) return;
    setError("");
    if (draft.actions.length >= 199) {
      setError("本次操作已到上限，请保存后再开一场。");
      return;
    }
    busy.current = true;
    try {
      const next = applyLabAction(state, action);
      const failed = next.events
        .slice(state.events.length)
        .find((e) => ["rejected", "reverted", "restricted-exit"].includes(e.type));
      if (failed) setError(failed.message);
      setDraft((d) => ({ ...d, actions: [...d.actions, action] }));
    } catch {
      busy.current = false;
      setError("金额不合适，请检查后再试。");
    }
  }
  async function finish() {
    if (saveBusy.current || busy.current) return;
    saveBusy.current = true;
    setSaving(true);
    setError("");
    try {
      const actions = state.finished
        ? draft.actions
        : [...draft.actions, { type: "finish" } as const];
      const run = makeLabRun(challengeId, draft.seed, actions);
      setDraft((d) => ({ ...d, actions }));
      if (!(await onSave(run))) setError("记录尚未保存，请留在本页重试。");
    } catch {
      setError("保存没有完成，操作草稿仍然保留。");
    } finally {
      saveBusy.current = false;
      setSaving(false);
    }
  }
  const pnl = labEquity(state) - state.initialEquityCents;
  const dollars = (n: number) => `$${money(n / 100)}`;
  const i = Number(challengeId.split("-").at(-1));
  const isAdvanced = i > LAB_CHALLENGES.length;
  // Loss if this buy is later sold at the stop, fees included (the 1R of this trade).
  const riskCents =
    buyQuote.units > 0
      ? (enteredCents * Math.max(0, labPrice(token) - plan.stopPrice)) / labPrice(token) +
        buyQuote.cycleCostCents
      : 0;
  const stopDistancePct = Math.max(0, (1 - plan.stopPrice / labPrice(token)) * 100);
  const goal =
    i === 3
      ? `跌到 $${formatPrice(plan.stopPrice)} 就先卖出，别继续等。`
      : i === 4
        ? `涨到 $${formatPrice(plan.targetPrice)} 先卖一部分，再处理余仓。`
        : i === 2 || i === 5
          ? `等回到 $${formatPrice(plan.entryPrice)} 以下，再考虑买入。`
          : challenge.goal;
  return (
    <article
      className="practical-lab lab-trading academy-reader"
      data-testid="practical-lab-session"
      data-challenge-id={challengeId}
      data-lab-version="lab-v2-trading"
    >
      <button className="lab-back" onClick={onClose}>
        <ArrowLeft size={16} />
        返回练习
      </button>
      <p className="academy-eyebrow">
        {isAdvanced
          ? `进阶实操 · ${i - LAB_CHALLENGES.length} / ${progress.required}`
          : `交易练习 · ${i} / 12`}{" "}
        · 已达标 {progress.completed}
      </p>
      <TextReveal as="h2" text={challenge.title} />
      <p className="lab-goal">{goal}</p>
      <div className="lab-account">
        <div>
          <small>本关总资产</small>
          <strong>{dollars(labEquity(state))}</strong>
        </div>
        <div className={pnl < 0 ? "is-loss" : pnl > 0 ? "is-profit" : ""}>
          <small>本关盈亏</small>
          <strong>
            {pnl < 0 ? "−" : "+"}
            {dollars(Math.abs(pnl))}
          </strong>
        </div>
        <span>
          <Clock3 size={13} />
          {String(Math.floor(state.step / 2)).padStart(2, "0")}:{state.step % 2 ? "30" : "00"}
        </span>
      </div>
      {state.finished ? (
        <>
          <div
            className="lab-result"
            role="status"
            data-testid="lab-result"
            data-passed={result.passed}
          >
            <ShieldCheck size={24} />
            <div>
              <TextReveal
                as="h3"
                text={result.passed ? "这一关，做到了。" : "再练一次，会更稳。"}
              />
              <p>
                做到 {result.checks.filter((c) => c.passed).length} / {result.checks.length} 项 ·
                实际费用 {dollars(result.feesCents)}
              </p>
            </div>
          </div>
          <div className="lab-checks">
            {result.checks.map((c) => (
              <div key={c.id}>
                <span className={c.passed ? "is-profit" : "is-loss"}>{c.passed ? "✓" : "○"}</span>
                <div>
                  <strong>{c.title}</strong>
                  <p>{c.passed ? "已从实际交易记录核对。" : c.detail}</p>
                </div>
              </div>
            ))}
          </div>
          {saved && result.passed && next ? (
            <Button onClick={next.open}>
              下一项：{next.title}
              <ArrowRight size={16} />
            </Button>
          ) : saved && result.passed && progress.completed === progress.required ? (
            <p className="lab-inline-state" role="status">
              {isAdvanced
                ? "4 项进阶实操全部达标。到自由市场里，用同样的规则做满 30 笔再看统计。"
                : "12 项实操全部达标。可以去「进度」页开始模拟交易考核。"}
            </p>
          ) : (
            <Button disabled={saving || saved} onClick={() => void finish()}>
              {saved ? (
                <>
                  <Check size={17} />
                  本次记录已保存
                </>
              ) : saving ? (
                "正在保存…"
              ) : (
                "保存这次练习"
              )}
            </Button>
          )}
          {saved && result.passed ? (
            <p className="lab-saved-note">
              <Check size={14} />
              本次记录已保存 · 实操达标 {progress.completed} / {progress.required}
            </p>
          ) : null}
          <div className="lab-two-actions">
            <Button
              variant="ghost"
              disabled={!saved || saving}
              onClick={() => {
                setDraft(fresh());
                setTokenId("token-a");
                setAmount("4");
                setSide("buy");
                setError("");
              }}
            >
              再练一次
              <RotateCcw size={15} />
            </Button>
            <Button variant="ghost" onClick={onClose}>
              返回练习
              <ArrowRight size={15} />
            </Button>
          </div>
        </>
      ) : (
        <>
          {state.tokens.length > 1 && (
            <div className="lab-token-tabs" aria-label="选择交易项目">
              {state.tokens.map((t, j) => (
                <button
                  key={t.id}
                  aria-pressed={token.id === t.id}
                  onClick={() => setTokenId(t.id)}
                >
                  <span>
                    {String.fromCharCode(65 + j)} · {t.symbol}
                  </span>
                  <small>{dollars(Math.round(labPrice(t) * 100))}</small>
                </button>
              ))}
            </div>
          )}
          <div className="lab-market-heading">
            <div>
              <small>模拟行情</small>
              <h3>
                {token.name} <span>{token.symbol}</span>
              </h3>
            </div>
            <strong>${formatPrice(labPrice(token))}</strong>
          </div>
          <LabChart token={token} stopPrice={plan.stopPrice} stopLabel="先撤价" />
          <div className="lab-trade-levels">
            <span>
              买入区<strong>≤ ${formatPrice(plan.entryPrice)}</strong>
            </span>
            <span>
              先撤<strong>${formatPrice(plan.stopPrice)}</strong>
            </span>
            <span>
              目标<strong>${formatPrice(plan.targetPrice)}</strong>
            </span>
          </div>
          {state.trading!.dailyStopped && (
            <p className="lab-inline-state">本关已到停止线：可以卖出，先不再买入。</p>
          )}
          {pending && (
            <p className="lab-inline-state" role="status">
              已有买单等待结果，点“观察”推进行情。
            </p>
          )}
          <section className="lab-ticket">
            <div className="lab-direction">
              <button aria-pressed={side === "buy"} onClick={() => setSide("buy")}>
                买入
              </button>
              <button aria-pressed={side === "sell"} onClick={() => setSide("sell")}>
                卖出
              </button>
            </div>
            <div className="lab-ticket-balances">
              <span>
                可用金额<strong>{dollars(state.cash[token.chain])}</strong>
              </span>
              <span>
                这项持仓
                <strong>
                  {p?.units ? dollars(labSellQuote(state, token.id).netCents) : "$0.00"}
                </strong>
              </span>
            </div>
            {side === "buy" ? (
              <>
                <label className="lab-label">
                  买入金额 · 训练美元
                  <input
                    className={fieldClass}
                    aria-label="实操买入金额"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <div className="lab-presets">
                  {["1", "4", "7.5"].map((v) => (
                    <button key={v} aria-pressed={amount === v} onClick={() => setAmount(v)}>
                      ${v}
                    </button>
                  ))}
                </div>
                <p className="lab-exit-quote">
                  {buyQuote.units > 0
                    ? `预计买到 ${(buyQuote.units / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 4 })} ${token.symbol} · 往返费用约 ${dollars(buyQuote.cycleCostCents)}`
                    : "输入小额试试"}
                </p>
                {buyQuote.units > 0 ? (
                  <p
                    className={`lab-risk-line ${(i === 13 || i === 16) && (riskCents > ADVANCED_RISK_CENTS || riskCents < ADVANCED_RISK_CENTS / 2) ? "is-off" : ""}`}
                  >
                    这笔的 1R：跌到先撤价（−{stopDistancePct.toFixed(0)}%）约亏{" "}
                    {dollars(Math.round(riskCents))}
                    {i === 13 || i === 16
                      ? riskCents > ADVANCED_RISK_CENTS
                        ? " · 超过本关 $1，买少一点"
                        : riskCents < ADVANCED_RISK_CENTS / 2
                          ? " · 不到 $0.50，可以再多一点"
                          : " · 在 $0.50–$1 之间 ✓"
                      : ""}
                  </p>
                ) : null}
                <Button
                  disabled={
                    saving || pending || !Number.isFinite(enteredCents) || enteredCents < 20
                  }
                  onClick={() =>
                    act({
                      type: "buy",
                      tokenId: token.id,
                      cents: enteredCents,
                      slippageBps: 500,
                      ttlSteps: 6,
                    })
                  }
                >
                  买入 {token.symbol}
                </Button>
              </>
            ) : (
              <>
                <div className="lab-presets">
                  {([25, 50, 100] as const).map((v) => (
                    <button key={v} aria-pressed={percent === v} onClick={() => setPercent(v)}>
                      {v}%
                    </button>
                  ))}
                </div>
                <p className="lab-exit-quote">
                  {quote.ok ? `预计拿回 ${dollars(quote.netCents)}（已计费用）` : quote.error}
                </p>
                <Button
                  disabled={!p?.units || saving}
                  onClick={() => act({ type: "sell", tokenId: token.id, percent })}
                >
                  卖出 {percent}%
                </Button>
              </>
            )}
          </section>
          {error && (
            <p className="lab-error" role="alert">
              {error}
            </p>
          )}
          <div className="lab-two-actions">
            <Button variant="ghost" onClick={() => act({ type: "wait", steps: 1 })}>
              <Clock3 size={16} />
              观察30秒
            </Button>
            <Button variant="ghost" onClick={() => act({ type: "wait", steps: 4 })}>
              观察2分钟
            </Button>
          </div>
          {state.orders.length > 0 && (
            <div className="lab-order-list">
              {state.orders.map((o) => (
                <p key={o.id}>
                  买单{o.id} ·{" "}
                  {
                    {
                      pending: "等待结果",
                      confirmed: "已经买到",
                      reverted: "没有成交",
                      expired: "已过期",
                    }[o.status]
                  }
                  <span>{o.message}</span>
                </p>
              ))}
            </div>
          )}
          <Button variant="ghost" disabled={saving} onClick={() => void finish()}>
            <Check size={16} />
            结束并回看这次练习
          </Button>
        </>
      )}
      {state.finished && error && (
        <p className="lab-error" role="alert">
          {error}
        </p>
      )}
      <TrainingDisclosure
        title="交易记录"
        summary={`${state.facts.buyCount} 次买入 · ${state.facts.sellCount} 次卖出 · 费用 ${dollars(state.feesCents)}`}
      >
        <ol className="lab-log">
          {state.events
            .slice(-18)
            .reverse()
            .map((e, j) => (
              <li key={`${state.events.length - j}`}>
                <time>
                  {String(Math.floor(e.step / 2)).padStart(2, "0")}:{e.step % 2 ? "30" : "00"}
                </time>
                <span>{e.message}</span>
              </li>
            ))}
        </ol>
      </TrainingDisclosure>
      <p className="lab-footnote">虚拟资金 · 参考价位由本关给出 · 只按实际买卖与观察记录训练结果</p>
    </article>
  );
}
