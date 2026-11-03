import { TrainingSelect } from "@/components/training-select";
import { useState, type ReactNode } from "react";
import { ArrowRight, ArrowRightLeft, CircleAlert, Clock3, Info, Route } from "lucide-react";
import { toast } from "sonner";
import { useWorld } from "@/lib/world/store";
import { CHAINS } from "@/lib/world/config";
import { atoms, compact, currencyCompact, money, units } from "@/lib/world/amount";
import type { ChainId, World } from "@/lib/world/types";
import { AnimatedValue, TextReveal, TrainingDisclosure } from "@/components/training-ui";
import { ActionButton, ChainBadge, EmptyState, chainSpec, simTime } from "./shared";
import "./wallet.css";
import { GasTopupControl } from "./gas-topup";
import { fundingGas } from "@/lib/world/funding";

function WalletHelp({ children, label }: { children: ReactNode; label: string }) {
  return (
    <details className="mw-wallet-help">
      <summary aria-label={label}>
        <Info size={16} />
      </summary>
      <div>{children}</div>
    </details>
  );
}

export function WalletPanel({ world }: { world: World }) {
  const { dispatch, busy, readOnly } = useWorld();
  const [operation, setOperation] = useState<"swap" | "bridge">("swap");
  const [swapChain, setSwapChain] = useState<ChainId>("solana");
  const [direction, setDirection] = useState<"to_native" | "to_stable">("to_native");
  const [swapAmount, setSwapAmount] = useState("");
  const [from, setFrom] = useState<ChainId>("solana");
  const [to, setTo] = useState<ChainId>("base");
  const [bridgeAmount, setBridgeAmount] = useState("");
  const [localError, setLocalError] = useState("");
  const canOperate = !readOnly && world.phase !== "completed" && world.phase !== "settling";
  const stableUsd = CHAINS.reduce((sum, chain) => sum + units(world.wallet[chain.id].stable), 0);
  const nativeUsd = CHAINS.reduce(
    (sum, chain) => sum + units(world.wallet[chain.id].native) * world.fx[chain.id],
    0,
  );
  const inTransit = world.bridges.filter((transfer) => transfer.status === "in_transit");
  const transitUsd = inTransit.reduce((sum, transfer) => sum + units(transfer.amount), 0);
  const pendingCount = world.transactions.filter((tx) => tx.status === "pending").length;
  const swapBalance = world.wallet[swapChain];
  const sourceStable = units(world.wallet[from].stable);
  const swapUnit = direction === "to_native" ? "USD" : chainSpec(swapChain).native;
  const swapAvailable =
    direction === "to_native"
      ? currencyCompact(units(swapBalance.stable))
      : `${compact(units(swapBalance.native))} ${swapUnit}`;
  async function swap() {
    setLocalError("");
    try {
      const amount = atoms(swapAmount);
      if (BigInt(amount) <= 0n) throw new Error("兑换数量要大于零");
      const submitted = await dispatch({
        id: crypto.randomUUID(),
        type: "swap",
        chain: swapChain,
        direction,
        amount,
        note:
          direction === "to_native" ? "补充本链 gas 与交易资金" : "将本链原生资产换回训练稳定币",
      });
      if (!submitted) {
        setLocalError(useWorld.getState().error || "兑换未提交，请重试");
        return;
      }
      toast.success("已提交兑换");
      setSwapAmount("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "请检查兑换数量");
    }
  }
  async function bridge() {
    setLocalError("");
    try {
      if (from === to) throw new Error("请选择不同的来源链和目标链");
      const amount = atoms(bridgeAmount);
      if (BigInt(amount) <= 0n) throw new Error("转账金额要大于零");
      const submitted = await dispatch({
        id: crypto.randomUUID(),
        type: "bridge",
        from,
        to,
        amount,
        note: "按自己的资金配置计划转移训练稳定币",
      });
      if (!submitted) {
        setLocalError(useWorld.getState().error || "跨链转账未提交，请重试");
        return;
      }
      toast.success("已提交跨链转账");
      setBridgeAmount("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "请检查转账金额");
    }
  }
  return (
    <div className="mw-wallet-view" data-testid="wallet-overview">
      <section className="mw-wallet-overview" aria-label="现金账户">
        <div className="mw-wallet-total-label">
          <div>
            <h3>链上现金</h3>
            <span>已到账余额合计 · USD</span>
          </div>
          <WalletHelp label="链上现金如何计算">
            <p>三条链的稳定资产与原生币美元估值合计，不含持仓和在途资金。</p>
            <p>交易从项目所在链扣款，跨链需要手动调度；待确认订单尚未扣款。</p>
          </WalletHelp>
        </div>
        <AnimatedValue
          value={stableUsd + nativeUsd}
          format={(value) => `$${money(value)}`}
          className="mw-wallet-cash-value"
        />
        <div className="mw-wallet-composition">
          <div>
            <span>稳定资产</span>
            <strong>{currencyCompact(stableUsd)}</strong>
          </div>
          <div>
            <span>
              原生资产 <small>含 gas</small>
            </span>
            <strong>{currencyCompact(nativeUsd)}</strong>
          </div>
        </div>
        <div className="mw-wallet-transit-total">
          <span>
            <Clock3 size={15} />
            在途资金{inTransit.length > 0 && <small>{inTransit.length}笔</small>}
          </span>
          <strong>{currencyCompact(transitUsd)}</strong>
        </div>
        {pendingCount > 0 && <p className="mw-wallet-pending">{pendingCount} 笔订单待确认</p>}
      </section>
      <TrainingDisclosure
        title="链上分布"
        summary={`${CHAINS.length} 条链`}
        className="mw-wallet-distribution"
      >
        {CHAINS.map((chain) => {
          const balance = world.wallet[chain.id];
          const stable = units(balance.stable),
            native = units(balance.native),
            nativeValue = native * world.fx[chain.id];
          const pending = world.transactions.filter(
            (tx) => tx.chain === chain.id && tx.status === "pending",
          ).length;
          const lowGas = BigInt(balance.native) < fundingGas(world, chain.id) * 3n;
          return (
            <article className="mw-wallet-network" key={chain.id}>
              <div className="mw-wallet-network-title">
                <ChainBadge id={chain.id} />
                <strong>{currencyCompact(stable + nativeValue)}</strong>
              </div>
              <div className="mw-wallet-asset-row">
                <span>稳定资产</span>
                <strong>{currencyCompact(stable)}</strong>
              </div>
              <div className="mw-wallet-asset-row">
                <span>
                  {chain.native}
                  <small>
                    {compact(native)} {chain.native}
                  </small>
                </span>
                <strong>{currencyCompact(nativeValue)}</strong>
              </div>
              {(lowGas || pending > 0) && (
                <div className="mw-wallet-network-status">
                  {lowGas && (
                    <span className="mw-bad">
                      <CircleAlert size={14} />
                      链费余额偏低
                    </span>
                  )}
                  {pending > 0 && <span>{pending} 笔待确认</span>}
                </div>
              )}
            </article>
          );
        })}
      </TrainingDisclosure>
      <TrainingDisclosure
        title="资金调度"
        summary="本链兑换 / 跨链转账"
        className="mw-wallet-funds"
      >
        <div className="mw-segment" aria-label="资金操作">
          <button
            type="button"
            className={operation === "swap" ? "is-active" : ""}
            onClick={() => {
              setOperation("swap");
              setLocalError("");
            }}
          >
            <ArrowRightLeft size={17} />
            本链兑换
          </button>
          <button
            type="button"
            className={operation === "bridge" ? "is-active" : ""}
            onClick={() => {
              setOperation("bridge");
              setLocalError("");
            }}
          >
            <Route size={17} />
            跨链转账
          </button>
        </div>
        <div hidden={operation !== "swap"}>
          <label className="mw-label">
            所在链
            <TrainingSelect
              value={swapChain}
              onValueChange={(value) => setSwapChain(value as ChainId)}
              options={CHAINS.map((chain) => ({ value: chain.id, label: chain.name }))}
              aria-label="兑换链"
              disabled={!canOperate}
            />
          </label>
          <div className="mw-quick-amounts">
            <button
              type="button"
              className={direction === "to_native" ? "is-active" : ""}
              onClick={() => setDirection("to_native")}
            >
              稳定资产 → {chainSpec(swapChain).native}
            </button>
            <button
              type="button"
              className={direction === "to_stable" ? "is-active" : ""}
              onClick={() => setDirection("to_stable")}
            >
              {chainSpec(swapChain).native} → 稳定资产
            </button>
          </div>
          <label className="mw-label">
            兑换数量 · {swapUnit}
            <input
              inputMode="decimal"
              value={swapAmount}
              onChange={(event) => setSwapAmount(event.target.value)}
              placeholder="输入数量"
              aria-label="兑换数量"
              disabled={!canOperate}
            />
          </label>
          <div className="mw-wallet-input-balance">
            <span>本链可用</span>
            <strong>{swapAvailable}</strong>
          </div>
          <div className="mw-wallet-operation-facts">
            <span>兑换费 0.3%</span>
            <WalletHelp label="兑换费用与到账">
              <p>另需本链原生币支付链费。按执行时汇率结算，兑换不跨链。</p>
            </WalletHelp>
          </div>
          <ActionButton busy={busy} disabled={!canOperate || !swapAmount} onClick={swap}>
            确认兑换
          </ActionButton>
        </div>
        <div hidden={operation !== "bridge"}>
          <div className="mw-bridge-route">
            <label className="mw-label">
              从
              <TrainingSelect
                value={from}
                onValueChange={(value) => setFrom(value as ChainId)}
                options={CHAINS.map((chain) => ({ value: chain.id, label: chain.name }))}
                aria-label="桥接来源链"
                disabled={!canOperate}
              />
            </label>
            <ArrowRight size={18} />
            <label className="mw-label">
              到
              <TrainingSelect
                value={to}
                onValueChange={(value) => setTo(value as ChainId)}
                options={CHAINS.map((chain) => ({
                  value: chain.id,
                  label: chain.name,
                  disabled: chain.id === from,
                }))}
                aria-label="桥接目标链"
                disabled={!canOperate}
              />
            </label>
          </div>
          <label className="mw-label">
            转账金额 · USD
            <input
              inputMode="decimal"
              value={bridgeAmount}
              onChange={(event) => setBridgeAmount(event.target.value)}
              placeholder="输入金额"
              aria-label="桥接数量"
              disabled={!canOperate}
            />
          </label>
          <div className="mw-wallet-input-balance">
            <span>来源链稳定资产</span>
            <strong>{currencyCompact(sourceStable)}</strong>
          </div>
          <div className="mw-wallet-operation-facts">
            <span>桥费 0.2%</span>
            <WalletHelp label="跨链费用与到账">
              <p>另收来源链原生币链费。源链确认后约30–209模拟秒到账，实际状态保留在转账记录中。</p>
              <p>到账的是稳定资产；目标链交易仍需 {chainSpec(to).native}。</p>
            </WalletHelp>
          </div>
          <ActionButton
            busy={busy}
            disabled={!canOperate || !bridgeAmount || from === to}
            onClick={bridge}
          >
            转到 {chainSpec(to).name}
          </ActionButton>
        </div>
        {!canOperate && (
          <p className="mw-wallet-form-note">
            {readOnly ? "当前为只读，请接管训练后操作。" : "本场已停止资金操作。"}
          </p>
        )}
        {localError && (
          <p className="mw-inline-error" role="alert">
            {localError}
          </p>
        )}
      </TrainingDisclosure>
      <TrainingDisclosure title="gas补给" summary="本链稳定资产付费，服务金库支付链费">
        <label className="mw-label">
          补给链
          <TrainingSelect
            value={swapChain}
            onValueChange={(value) => setSwapChain(value as ChainId)}
            options={CHAINS.map((c) => ({ value: c.id, label: c.name }))}
            aria-label="gas补给链"
            disabled={!canOperate}
          />
        </label>
        <GasTopupControl key={swapChain} world={world} chain={swapChain} />
      </TrainingDisclosure>
      <TrainingDisclosure
        title="转账记录"
        summary={
          inTransit.length > 0 ? `${inTransit.length} 笔在途` : `${world.bridges.length} 笔跨链转账`
        }
        className="mw-wallet-transfer-history"
      >
        {world.bridges.length ? (
          <div>
            {world.bridges
              .slice()
              .reverse()
              .map((transfer) => (
                <article className="mw-wallet-transfer-record" key={transfer.id}>
                  <div className="mw-wallet-transfer-route">
                    <ChainBadge id={transfer.from} short />
                    <ArrowRight size={15} />
                    <ChainBadge id={transfer.to} short />
                    <span className={transfer.status === "completed" ? "mw-ok" : "mw-muted"}>
                      {transfer.status === "completed"
                        ? "已到账"
                        : transfer.status === "refunded"
                          ? "已退回"
                          : "转账中"}
                    </span>
                  </div>
                  <div className="mw-wallet-transfer-value">
                    <strong>{currencyCompact(units(transfer.amount))}</strong>
                    <span>
                      {transfer.status === "in_transit"
                        ? `约 ${Math.max(0, Math.ceil(transfer.dueAt - world.now))} 模拟秒`
                        : "稳定资产"}
                    </span>
                  </div>
                  <p>
                    桥费 {currencyCompact(units(transfer.fee))}
                    {transfer.status === "in_transit"
                      ? ` · 预计 ${simTime(transfer.dueAt)} 到账`
                      : ""}
                  </p>
                </article>
              ))}
          </div>
        ) : (
          <p className="mw-wallet-empty">暂无跨链转账</p>
        )}
      </TrainingDisclosure>
    </div>
  );
}

export function TransactionsPanel({ world }: { world: World }) {
  const [filter, setFilter] = useState<"all" | "pending" | "failed">("all");
  const [page, setPage] = useState(1);
  const names = { buy: "买入", sell: "卖出", swap: "兑换", bridge: "桥接", gas_topup: "gas补给" };
  const states = {
    pending: "待执行",
    confirmed: "已确认",
    reverted: "执行回退",
    dropped: "未包含",
    cancelled: "已取消",
    expired: "已过期 · 未执行",
  };
  const transactions = world.transactions
    .filter(
      (tx) =>
        filter === "all" ||
        (filter === "pending"
          ? tx.status === "pending"
          : tx.status === "reverted" || tx.status === "dropped" || tx.status === "expired"),
    )
    .slice()
    .reverse();
  const pages = Math.max(1, Math.ceil(transactions.length / 20)),
    current = Math.min(page, pages);
  return (
    <div data-testid="market-transactions">
      <section className="mw-section-intro">
        <TextReveal as="h2" text="交易记录" />
        <p>{world.transactions.length} 笔已提交</p>
      </section>
      <div className="mw-filter-tabs">
        {(["all", "pending", "failed"] as const).map((item) => (
          <button
            type="button"
            key={item}
            className={filter === item ? "is-active" : ""}
            onClick={() => {
              setFilter(item);
              setPage(1);
            }}
          >
            {item === "all" ? "全部" : item === "pending" ? "待执行" : "失败记录"}
          </button>
        ))}
      </div>
      {transactions.length ? (
        <section className="mw-panel mw-transaction-records">
          {transactions.slice((current - 1) * 20, current * 20).map((tx) => {
            const token = world.tokens.find((item) => item.id === tx.tokenId);
            const chain = chainSpec(tx.chain);
            const direction = "direction" in tx ? tx.direction : undefined;
            const inputUnit =
              tx.type === "bridge" || tx.type === "gas_topup"
                ? "稳定币"
                : tx.type === "sell"
                  ? (token?.symbol ?? "代币")
                  : tx.type === "swap" && direction === "to_native"
                    ? "稳定币"
                    : chain.native;
            const outputUnit =
              tx.type === "buy"
                ? (token?.symbol ?? "代币")
                : tx.type === "bridge"
                  ? "稳定币"
                  : tx.type === "swap" && direction === "to_stable"
                    ? "稳定币"
                    : chain.native;
            return (
              <TrainingDisclosure
                key={tx.id}
                title={`${names[tx.type]} ${token?.symbol ?? (tx.type === "bridge" ? "训练稳定币" : chain.native)}`}
                summary={`${states[tx.status]} · ${simTime(tx.submittedAt)}`}
                defaultOpen={tx.status === "pending" || tx.status === "reverted"}
              >
                <div className="mw-tx-facts">
                  <p>
                    <span>提交数量</span>
                    <strong>
                      {compact(units(tx.amount))} {inputUnit}
                    </strong>
                  </p>
                  <p>
                    <span>实际到手</span>
                    <strong>{tx.out ? `${compact(units(tx.out))} ${outputUnit}` : "—"}</strong>
                  </p>
                  <p>
                    <span>已记费用</span>
                    <strong>
                      {tx.feeUsd !== undefined
                        ? currencyCompact(tx.feeUsd)
                        : tx.status === "expired"
                          ? "$0.00 · 未进入执行"
                          : "待结算"}
                    </strong>
                  </p>
                </div>
                {tx.deadline !== undefined && (
                  <p className="mw-muted">
                    截止 {simTime(tx.deadline)}
                    {tx.status === "pending"
                      ? ` · 剩余 ${Math.max(0, tx.deadline - world.now)} 模拟秒`
                      : ""}
                  </p>
                )}
                {tx.result && (
                  <p
                    className={
                      tx.status === "reverted" || tx.status === "dropped" ? "mw-bad" : "mw-muted"
                    }
                  >
                    {tx.result}
                  </p>
                )}
                <p>{tx.note}</p>
                <div className="mw-inline">
                  <ChainBadge id={tx.chain} short />
                  <span className="mw-caption">意图 {tx.id.slice(0, 18)}</span>
                </div>
              </TrainingDisclosure>
            );
          })}
        </section>
      ) : (
        <EmptyState
          icon={<Clock3 size={24} />}
          title={filter === "all" ? "尚未提交交易" : "这个分类暂无记录"}
        >
          提交后的状态会显示在这里。
        </EmptyState>
      )}
      {pages > 1 && (
        <div className="mw-pagination">
          <button type="button" disabled={current === 1} onClick={() => setPage(current - 1)}>
            上一页
          </button>
          <span>
            {current} / {pages}
          </span>
          <button type="button" disabled={current === pages} onClick={() => setPage(current + 1)}>
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
