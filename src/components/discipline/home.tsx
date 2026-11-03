import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import {
  executionStats,
  formatAmount,
  formatSigned,
  moneyStats,
  useTrading,
} from "@/lib/trading/store";
import {
  applyBackup,
  completeBackup,
  downloadJson,
  prepareBackup,
  type PreparedBackup,
} from "@/lib/academy/backup";
import { Button, Overlay } from "./ui";
import { AiPanel } from "./ai-panel";
import { FomoImportCard } from "./fomo-import";
import { EquitySpark } from "./money-panel";

export function HomeScreen({
  onCheck,
  onJournal,
  onStats,
  onRules,
  onAcademy,
  onMarket,
}: {
  onCheck: () => void;
  onJournal: () => void;
  onStats: () => void;
  onRules: () => void;
  onAcademy: () => void;
  onMarket: () => void;
}) {
  const trades = useTrading((state) => state.trades);
  const rules = useTrading((state) => state.rules);
  const principal = useTrading((state) => state.principal);
  const stats = executionStats(trades);
  const money = moneyStats(trades, principal);
  const active = rules.filter((rule) => rule.isActive);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PreparedBackup | null>(null);
  const [includeTraining, setIncludeTraining] = useState(true);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupText, setBackupText] = useState("");
  const [importText, setImportText] = useState("");

  async function acceptBackup(text: string) {
    try {
      setPending(await prepareBackup(text));
      setIncludeTraining(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "文件读不了，确认是账本 JSON");
    }
  }

  function exportLegacy() {
    const payload = {
      version: 2,
      exportTime: new Date().toISOString(),
      trades,
      rules,
      principal,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `交易纪律备份_${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success("备份已下载，存到微信或网盘");
  }
  async function exportData() {
    setBackupBusy(true);
    try {
      const text = await completeBackup();
      downloadJson(text, `交易训练完整备份_${new Date().toISOString().slice(0, 10)}.json`);
      toast.success("完整备份已导出，包含铁律、课程和训练世界");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "完整备份未完成，数据仍保留在本机");
    } finally {
      setBackupBusy(false);
    }
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      void acceptBackup(String(reader.result));
    };
    reader.readAsText(file);
  }

  return (
    <div className="stagger grid grid-cols-2 gap-3">
      <section className="col-span-2 rounded-2xl border border-line bg-surface p-5">
        <p className="text-xs font-medium tracking-widest text-primary">新 · 多链交易训练世界</p>
        <h2 className="mt-2 text-2xl font-black">先在虚拟市场，练好每个决定</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          三条模拟链、五类发射平台。新币持续出现，自己观察、买卖与复盘。虚拟资金与真实账本独立。
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button onClick={onMarket}>进入随机市场</Button>
          <Button variant="ghost" onClick={onAcademy}>
            学习与考核
          </Button>
        </div>
      </section>
      <button
        type="button"
        onClick={onCheck}
        className="col-span-2 rounded-2xl bg-primary px-5 py-6 text-left text-primary-fg transition duration-300 active:scale-[0.98]"
      >
        <p className="text-sm text-primary-fg/75">下一步</p>
        <p className="mt-1 text-4xl font-black leading-none">交易前检查</p>
        {stats.total > 0 && stats.rate < 80 ? (
          <p className="mt-3 text-sm text-primary-fg/80">执行率还没到 80。</p>
        ) : null}
      </button>
      <button
        type="button"
        onClick={onJournal}
        className="min-h-28 rounded-2xl bg-surface px-4 py-4 text-left transition duration-300 active:scale-[0.98]"
      >
        <p className="text-xs text-faint">记录</p>
        <p className="mt-2 text-2xl font-black">写日志</p>
      </button>
      <button
        type="button"
        onClick={onStats}
        className="min-h-28 rounded-2xl bg-surface px-4 py-4 text-left transition duration-300 active:scale-[0.98]"
      >
        <p className="text-xs text-faint">曲线</p>
        <p className="mt-2 text-2xl font-black">看统计</p>
      </button>

      <div className="col-span-2 flex items-center justify-between rounded-2xl bg-surface px-5 py-4 text-sm">
        <p className="text-faint">
          本机 {trades.length} 笔 · 本金 {formatAmount(principal)}
        </p>
        <div className="flex shrink-0 gap-4">
          <button type="button" onClick={() => void exportData()} disabled={backupBusy}>
            {backupBusy ? "备份中" : "完整导出"}
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="font-medium text-primary"
          >
            导入
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={onFile}
        />
      </div>
      <p className="col-span-2 px-2 text-xs leading-relaxed text-muted">
        完整备份包含学习和训练。
        <button type="button" className="min-h-11 underline" onClick={exportLegacy}>
          仅导出兼容旧版的账本与全部铁律
        </button>
      </p>

      <details className="col-span-2 rounded-2xl border border-line bg-surface p-4">
        <summary className="min-h-11 cursor-pointer text-sm text-muted">
          下载受限时，复制或粘贴完整备份
        </summary>
        <div className="mt-3 space-y-3">
          <Button
            variant="ghost"
            disabled={backupBusy}
            onClick={async () => {
              setBackupBusy(true);
              try {
                setBackupText(await completeBackup());
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "备份生成失败");
              } finally {
                setBackupBusy(false);
              }
            }}
          >
            生成可复制完整备份
          </Button>
          {backupText && (
            <label className="block text-xs text-muted">
              将下方完整 JSON 保存到文本文件
              <textarea
                className="mt-2 min-h-28 w-full rounded-lg border border-line bg-bg p-3 font-mono text-xs"
                aria-label="待保存的完整备份"
                value={backupText}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
          )}
          <label className="block text-xs text-muted">
            粘贴已有备份 JSON
            <textarea
              className="mt-2 min-h-28 w-full rounded-lg border border-line bg-bg p-3 font-mono text-xs"
              aria-label="粘贴备份JSON"
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
            />
          </label>
          <Button
            variant="ghost"
            disabled={!importText.trim() || backupBusy}
            onClick={() => void acceptBackup(importText)}
          >
            校验粘贴备份
          </Button>
        </div>
      </details>

      <section className="col-span-2 rounded-2xl bg-surface p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-black">账户</h2>
          <button type="button" onClick={onStats} className="text-sm text-primary">
            打开曲线
          </button>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3">
          <div>
            <dt className="text-xs text-faint">本金</dt>
            <dd className="mt-1 text-xl font-black tabular-nums">
              {formatAmount(money.principal)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-faint">权益</dt>
            <dd className="mt-1 text-xl font-black tabular-nums">{formatAmount(money.equity)}</dd>
          </div>
          <div>
            <dt className="text-xs text-faint">胜率</dt>
            <dd className="mt-1 text-xl font-black tabular-nums">
              {money.winRate === null ? "—" : `${money.winRate}%`}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-faint">收益</dt>
            <dd className="mt-1 text-xl font-black text-ok tabular-nums">
              +{formatAmount(money.profit)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-faint">亏损</dt>
            <dd className="mt-1 text-xl font-black text-bad tabular-nums">
              {formatSigned(money.loss)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-faint">回撤</dt>
            <dd className="mt-1 text-xl font-black text-bad tabular-nums">
              {money.settled === 0 ? "—" : formatSigned(money.maxDrawdown)}
            </dd>
          </div>
        </dl>
        <EquitySpark data={money.curve} />
      </section>

      <section className="col-span-2">
        <div className="mb-3 flex items-baseline justify-between px-1">
          <h2 className="text-lg font-black">铁律</h2>
          <button type="button" onClick={onRules} className="text-sm text-primary">
            管理
          </button>
        </div>
        {active.length === 0 ? (
          <p className="rounded-2xl bg-surface px-5 py-4 text-sm text-muted">
            没有启用的铁律。先去加一条。
          </p>
        ) : (
          <div className="flex snap-x gap-3 overflow-x-auto pb-1">
            {active.map((rule, index) => (
              <article
                key={rule.id}
                className="w-[78%] shrink-0 snap-start rounded-2xl bg-surface p-4"
              >
                <p className="text-xs text-faint">{String(index + 1).padStart(2, "0")}</p>
                <p className="mt-2 text-lg font-black">{rule.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted">{rule.content}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="col-span-2">
        <AiPanel />
      </div>
      <div className="col-span-2">
        <FomoImportCard />
      </div>

      {pending ? (
        <Overlay
          className="fixed inset-0 z-40 flex items-end justify-center bg-bg/80 px-4 pb-[max(env(safe-area-inset-bottom,0px),1.25rem)] sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-title"
        >
          <div className="w-full max-w-sm border border-line bg-surface p-4">
            <h2 id="import-title" className="text-base font-semibold">
              用备份覆盖当前数据？
            </h2>
            <p className="mt-2 text-sm text-muted">
              交易 {pending.trades.length} 笔，铁律 {pending.rules.length}{" "}
              条。这台设备上现有的记录会被换掉。
            </p>
            {pending.training ? (
              <label className="mt-3 flex items-start gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={includeTraining}
                  onChange={(e) => setIncludeTraining(e.target.checked)}
                />
                <span>
                  同时恢复训练世界、课程与考核记录（覆盖当前训练进度）。取消勾选则保留现有训练。
                </span>
              </label>
            ) : (
              <p className="mt-3 text-xs text-muted">
                旧版备份只恢复账本与铁律，保留本机训练进度。
              </p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={() => setPending(null)}>
                取消
              </Button>
              <Button
                disabled={backupBusy}
                onClick={async () => {
                  setBackupBusy(true);
                  try {
                    await applyBackup(pending, includeTraining);
                    setPending(null);
                    toast.success("备份已导入");
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "恢复未完成");
                  } finally {
                    setBackupBusy(false);
                  }
                }}
              >
                覆盖导入
              </Button>
            </div>
          </div>
        </Overlay>
      ) : null}
    </div>
  );
}
