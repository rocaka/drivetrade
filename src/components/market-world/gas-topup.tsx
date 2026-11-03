import { useState } from "react";
import { useWorld } from "@/lib/world/store";
import { quoteGasTopup } from "@/lib/world/engine";
import { gasTopupBudget } from "@/lib/world/funding";
import { atoms, compact, money, units } from "@/lib/world/amount";
import type { ChainId, World } from "@/lib/world/types";
import { ActionButton, chainSpec } from "./shared";
export function GasTopupControl({ world, chain }: { world: World; chain: ChainId }) {
  const [amount, setAmount] = useState(() => units(gasTopupBudget(world, chain)).toFixed(2));
  const [message, setMessage] = useState("");
  const { busy, readOnly, dispatch } = useWorld();
  let q;
  try {
    q = quoteGasTopup(world, chain, atoms(amount));
  } catch {
    q = null;
  }
  const pending = world.transactions.some(
    (tx) => tx.type === "gas_topup" && tx.chain === chain && tx.status === "pending",
  );
  const canOperate = !readOnly && world.phase !== "completed" && world.phase !== "settling";
  return (
    <div className="mw-gas-topup">
      <p className="mw-muted">
        模拟补给服务用本链稳定资产购买原生币，服务金库支付链费。总额内扣0.5%服务费（最低$0.02）与实际链费，无需钱包预先持有gas。
      </p>
      <label className="mw-label">
        补给总额 · USD
        <input
          aria-label="gas补给稳定资产总额"
          inputMode="decimal"
          value={amount}
          disabled={!canOperate || pending}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      {q && (
        <div className="mw-wallet-operation-facts">
          <span>
            预计到手 {compact(units(q.nativeOut))} {chainSpec(chain).native}
          </span>
          <span>费用 ${money(units(q.totalFeeUsd))}</span>
        </div>
      )}
      {q && !q.ok && <p className="mw-inline-error">{q.error}</p>}
      {message && (
        <p className="mw-muted" role="status">
          {message}
        </p>
      )}
      <ActionButton
        secondary
        busy={busy}
        disabled={!canOperate || pending || !q?.ok}
        onClick={async () => {
          if (!q?.ok) return;
          const ok = await dispatch({
            id: crypto.randomUUID(),
            type: "gas_topup",
            chain,
            amount: q.amountUsd,
            note: "使用收费模拟补给服务准备本链gas",
          });
          setMessage(
            ok
              ? "补给已提交，按模拟区块执行；可继续市场或推进一分钟"
              : useWorld.getState().error || "补给未提交",
          );
        }}
      >
        {pending ? "补给等待执行" : "确认gas补给"}
      </ActionButton>
    </div>
  );
}
