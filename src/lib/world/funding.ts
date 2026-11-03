import { CHAINS } from "./config.ts";
import { atoms } from "./amount.ts";
import { quoteGasTopup, transactionGas } from "./engine.ts";
import type { Atom, ChainId, World, WorldCommand } from "./types.ts";

const SCALE = 1_000_000n;
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
export function gasTopupBudget(world: World, chain: ChainId, nativeOut?: bigint): Atom {
  const fx = BigInt(atoms(world.fx[chain].toFixed(6)));
  const gas = fundingGas(world, chain);
  const needed = ceil((nativeOut ?? gas * 7n) * fx, SCALE) + (gas * fx) / SCALE;
  const proportional = ceil(needed * 10_000n, 9_950n);
  const minimum = needed + 20_000n;
  const amount = (proportional > minimum ? proportional : minimum) + 2n;
  return (nativeOut === undefined && amount < SCALE ? SCALE : amount).toString();
}
export function fundingGas(world: World, chain: ChainId): bigint {
  return BigInt(transactionGas(world, chain));
}
export type FundingStep =
  | { kind: "ready"; message: string }
  | { kind: "wait"; message: string }
  | { kind: "blocked"; message: string }
  | { kind: "command"; message: string; command: WorldCommand };

/** Replans from committed balances after every real confirmation. It never
 * credits a target chain early or counts an in-transit transfer twice. */
export function nextFundingStep(
  world: World,
  target: ChainId,
  tradeAmount: Atom,
  id: string,
): FundingStep {
  if (!/^\d+$/.test(tradeAmount) || BigInt(tradeAmount) <= 0n)
    return { kind: "blocked", message: "先填写有效的买入金额" };
  if (world.phase === "completed" || world.phase === "settling")
    return { kind: "blocked", message: "本场已停止资金操作" };
  const gas = fundingGas(world, target),
    balance = world.wallet[target];
  const desired = BigInt(tradeAmount) + gas * 3n;
  if (BigInt(balance.native) >= desired)
    return { kind: "ready", message: "资金与退出链费已准备好，重新核对报价后买入" };
  if (
    world.transactions.some(
      (tx) =>
        tx.status === "pending" &&
        (tx.type === "swap" || tx.type === "bridge" || tx.type === "gas_topup"),
    ) ||
    world.bridges.some((b) => b.status === "in_transit")
  )
    return { kind: "wait", message: "等待兑换或跨链到账" };
  const needsGas = BigInt(balance.native) < gas;
  const fx = BigInt(atoms(world.fx[target].toFixed(6)));
  const need = desired - BigInt(balance.native) + gas;
  const nativeGap = desired - BigInt(balance.native);
  const wantedGasOut = nativeGap < gas * 7n ? nativeGap : gas * 7n;
  const stableNeeded = needsGas
    ? BigInt(gasTopupBudget(world, target, wantedGasOut))
    : ceil(ceil(need * fx, SCALE) * 10_000n, 9_970n) + 2n;
  if (needsGas && BigInt(balance.stable) >= stableNeeded) {
    const q = quoteGasTopup(world, target, stableNeeded.toString());
    if (!q.ok) return { kind: "blocked", message: q.error ?? "gas补给不可用" };
    return {
      kind: "command",
      message: "通过模拟补给服务补 gas：服务费与实际链费从本链稳定资产扣除",
      command: {
        id,
        type: "gas_topup",
        chain: target,
        amount: stableNeeded.toString(),
        note: "统一账户：零gas时使用明确收费的模拟补给服务",
      },
    };
  }
  if (BigInt(balance.stable) >= stableNeeded)
    return {
      kind: "command",
      message: "将本链稳定资产兑换为交易资金",
      command: {
        id,
        type: "swap",
        chain: target,
        direction: "to_native",
        amount: stableNeeded.toString(),
        note: "统一账户：按已确认预算准备交易资金与退出链费",
      },
    };
  const missing = stableNeeded - BigInt(balance.stable);
  const gross = ceil(missing * 10_000n, 9_980n) + 2n;
  const donors = CHAINS.filter(
    (c) => c.id !== target && BigInt(world.wallet[c.id].native) >= fundingGas(world, c.id) * 2n,
  ).sort((a, b) => Number(BigInt(world.wallet[b.id].stable) - BigInt(world.wallet[a.id].stable)));
  if (!donors.some((c) => BigInt(world.wallet[c.id].stable) > 2n)) {
    const bootstrap = CHAINS.find(
      (c) =>
        c.id !== target &&
        BigInt(world.wallet[c.id].native) < fundingGas(world, c.id) * 2n &&
        quoteGasTopup(world, c.id, gasTopupBudget(world, c.id, fundingGas(world, c.id) * 3n)).ok,
    );
    if (bootstrap)
      return {
        kind: "command",
        message: `先补足${bootstrap.name}的来源链费，再按真实桥流程调度`,
        command: {
          id,
          type: "gas_topup",
          chain: bootstrap.id,
          amount: gasTopupBudget(world, bootstrap.id, fundingGas(world, bootstrap.id) * 3n),
          note: "统一账户：跨链前通过收费服务准备来源链费",
        },
      };
  }
  const donor = donors.find((c) => BigInt(world.wallet[c.id].stable) > 0n);
  if (donor) {
    const available = BigInt(world.wallet[donor.id].stable);
    const amount = available < gross ? available : gross;
    if (amount > 2n)
      return {
        kind: "command",
        message: `从 ${donor.name} 调度稳定资产，按实际桥费与到账时间执行`,
        command: {
          id,
          type: "bridge",
          from: donor.id,
          to: target,
          amount: amount.toString(),
          note: "统一账户：跨链调度已确认预算，到账后再兑换",
        },
      };
  }
  for (const c of donors) {
    const reserve = fundingGas(world, c.id) * 3n;
    const native = BigInt(world.wallet[c.id].native) - reserve;
    if (native <= 0n) continue;
    const sourceFx = BigInt(atoms(world.fx[c.id].toFixed(6)));
    const wanted = ceil(gross * SCALE * 10_000n, sourceFx * 9_970n);
    const amount = native < wanted ? native : wanted;
    if (amount > 10n)
      return {
        kind: "command",
        message: `先兑换 ${c.name} 的可调度原生资产，保留本链 gas`,
        command: {
          id,
          type: "swap",
          chain: c.id,
          direction: "to_stable",
          amount: amount.toString(),
          note: "统一账户：调度前兑换，保留源链链费",
        },
      };
  }
  return { kind: "blocked", message: "可调度现金不足，持仓与在途资产不能当作可用余额" };
}
