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
import { ChevronRight, DatabaseBackup } from "lucide-react";
import { Button, Dialog } from "./ui";
import { cn } from "@/lib/cn";
import { AiPanel } from "./ai-panel";
import { FomoImportCard } from "./fomo-import";
import { EquitySpark } from "./equity-spark";

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

  const tile =
    "group rounded-2xl border border-line bg-surface px-4 py-4 text-left transition duration-300 hover:border-faint/60 active:scale-[0.98]";

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
        className="hero-cta group col-span-2 rounded-2xl bg-primary px-5 py-6 text-left text-primary-fg transition duration-300 active:scale-[0.98]"
      >
        <p className="text-sm text-primary-fg/75">下一步 · 每一笔都从这里开始</p>
        <p className="mt-1 flex items-center justify-between text-4xl font-black leading-none">
          交易前检查
          <ChevronRight className="size-8 transition group-hover:translate-x-1" aria-hidden />
        </p>
        <p className="mt-3 text-sm text-primary-fg/80">
          {active.length} 条铁律待确认
          {stats.total > 0 && stats.rate < 80 ? " · 执行率还没到 80" : ""}
        </p>
      </button>
      <button type="button" onClick={onJournal} className={tile}>
        <p className="text-xs text-faint">记录 · 已有 {trades.length} 笔</p>
        <p className="mt-2 text-2xl font-black">写日志</p>
      </button>
      <button type="button" onClick={onStats} className={tile}>
        <p className="text-xs text-faint">
          曲线 · {money.open > 0 ? `${money.open} 笔未平仓` : "全部已结算"}
        </p>
        <p className="mt-2 text-2xl font-black">看统计</p>
      </button>

      <section className="col-span-2 rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-black">账户</h2>
          <button type="button" onClick={onStats} className="text-sm text-primary">
            打开曲线
          </button>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-x-3 gap-y-4">
          <Metric label="本金" value={formatAmount(money.principal)} />
          <Metric label="权益" value={formatAmount(money.equity)} />
          <Metric label="胜率" value={money.winRate === null ? "—" : `${money.winRate}%`} />
          <Metric
            label="收益"
            value={money.profit > 0 ? `+${formatAmount(money.profit)}` : "0"}
            className={money.profit > 0 ? "text-ok" : undefined}
          />
          <Metric
            label="亏损"
            value={formatSigned(money.loss)}
            className={money.loss < 0 ? "text-bad" : undefined}
          />
          <Metric
            label="回撤"
            value={money.settled === 0 ? "—" : formatSigned(money.maxDrawdown)}
            className={money.maxDrawdown < 0 ? "text-bad" : undefined}
          />
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
          <div className="flex snap-x gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {active.map((rule, index) => (
              <article
                key={rule.id}
                className="w-[78%] max-w-xs shrink-0 snap-start rounded-2xl border border-line bg-surface p-4"
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

      <details className="group col-span-2 rounded-2xl border border-line bg-surface">
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden">
          <DatabaseBackup className="size-5 shrink-0 text-primary" aria-hidden />
          <span className="flex-1">
            <span className="block text-sm font-semibold">数据与备份</span>
            <span className="block text-xs text-faint">
              本机 {trades.length} 笔 · 本金 {formatAmount(principal)} · 只存在这台设备
            </span>
          </span>
          <ChevronRight className="size-4 text-faint transition group-open:rotate-90" aria-hidden />
        </summary>
        <div className="space-y-3 border-t border-line px-5 py-4">
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => void exportData()} disabled={backupBusy}>
              {backupBusy ? "备份中…" : "完整导出"}
            </Button>
            <Button variant="ghost" onClick={() => fileRef.current?.click()}>
              从文件导入
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={onFile}
          />
          <p className="text-xs leading-relaxed text-muted">
            完整备份包含学习和训练。
            <button type="button" className="min-h-11 underline" onClick={exportLegacy}>
              仅导出兼容旧版的账本与全部铁律
            </button>
          </p>
          <p className="pt-1 text-xs font-medium text-muted">下载受限时，复制或粘贴完整备份</p>
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
              <span className="flex items-center justify-between">
                将下方完整 JSON 保存到文本文件
                <button
                  type="button"
                  className="min-h-9 px-2 font-medium text-primary"
                  onClick={() => {
                    navigator.clipboard
                      ?.writeText(backupText)
                      .then(() => toast.success("已复制"))
                      .catch(() => toast.error("复制失败，请手动全选"));
                  }}
                >
                  复制
                </button>
              </span>
              <textarea
                className="mt-2 min-h-28 w-full rounded-xl border border-line bg-bg p-3 font-mono text-xs"
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
              className="mt-2 min-h-28 w-full rounded-xl border border-line bg-bg p-3 font-mono text-xs"
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

      {pending ? (
        <Dialog title="用备份覆盖当前数据？" onClose={() => setPending(null)}>
          <p className="mt-2 text-sm text-muted">
            交易 {pending.trades.length} 笔，铁律 {pending.rules.length}{" "}
            条。这台设备上现有的记录会被换掉。
          </p>
          {pending.training ? (
            <label className="mt-3 flex items-start gap-2 text-sm text-muted">
              <input
                type="checkbox"
                className="mt-1 accent-primary"
                checked={includeTraining}
                onChange={(e) => setIncludeTraining(e.target.checked)}
              />
              <span>
                同时恢复训练世界、课程与考核记录（覆盖当前训练进度）。取消勾选则保留现有训练。
              </span>
            </label>
          ) : (
            <p className="mt-3 text-xs text-muted">旧版备份只恢复账本与铁律，保留本机训练进度。</p>
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
                  setImportText("");
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
        </Dialog>
      ) : null}
    </div>
  );
}

function Metric({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className={cn("mt-1 truncate text-xl font-black tabular-nums", className)}>{value}</dd>
    </div>
  );
}
