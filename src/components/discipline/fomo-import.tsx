import { useMemo, useState } from "react";
import { toast } from "sonner";
import { draftsToTrades, parseFomoPaste } from "@/lib/trading/fomo";
import { formatSigned, useTrading } from "@/lib/trading/store";
import { Button, Field, fieldClass, Overlay } from "./ui";

const SAMPLE = `本金 1000
BONK 200 +80
WIF 150 -40
SOL 300`;

export function FomoImportCard() {
  const importFomo = useTrading((state) => state.importFomo);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const parsed = useMemo(() => parseFomoPaste(text), [text]);

  function commit() {
    if (parsed.drafts.length === 0) {
      toast.error(parsed.errors[0] ?? "没读到仓位");
      return;
    }
    const result = importFomo(draftsToTrades(parsed.drafts), parsed.principal);
    const principalNote = parsed.principal ? `本金记成 ${parsed.principal}。` : "";
    toast.success(`写入 ${result.added} 笔，重复跳过 ${result.skipped}。${principalNote}`);
    setText("");
    setOpen(false);
  }

  return (
    <>
      <section className="rounded-2xl bg-surface p-5">
        <h2 className="font-serif text-2xl font-medium">手贴仓位</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          没有文件时，一行一笔贴进来。盈亏进曲线，不计入执行率。整本账用下面的导入、导出。
        </p>
        <Button className="mt-3" variant="ghost" onClick={() => setOpen(true)}>
          贴进来
        </Button>
      </section>

      {open ? (
        <Overlay
          className="fixed inset-0 z-40 flex items-end justify-center bg-bg/80 px-4 pb-[max(env(safe-area-inset-bottom,0px),1.25rem)] sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="fomo-import-title"
        >
          <div className="max-h-[85dvh] w-full max-w-sm overflow-y-auto border border-line bg-surface p-4">
            <h2 id="fomo-import-title" className="text-lg font-black">
              贴仓位
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              一行一笔：币种、投入、盈亏。亏损写减号。只写投入表示还在持仓。第一行可以写本金。
            </p>
            <pre className="mt-3 overflow-x-auto bg-bg p-3 font-mono text-xs leading-relaxed text-muted">
              {SAMPLE}
            </pre>
            <Field label="仓位">
              <textarea
                className={`${fieldClass} min-h-36 resize-y font-mono`}
                value={text}
                placeholder={SAMPLE}
                onChange={(event) => setText(event.target.value)}
              />
            </Field>
            {parsed.drafts.length > 0 ? (
              <ul className="mb-3 space-y-1">
                {parsed.drafts.slice(0, 8).map((draft, index) => (
                  <li key={`${draft.symbol}-${index}`} className="flex justify-between gap-3 font-mono text-xs">
                    <span className="truncate">{draft.symbol}</span>
                    <span className="shrink-0 tabular-nums text-muted">
                      {draft.stake === null ? "投入未写" : draft.stake}
                      {" · "}
                      {draft.pnl === null ? "持仓" : formatSigned(draft.pnl)}
                    </span>
                  </li>
                ))}
                {parsed.drafts.length > 8 ? (
                  <li className="text-xs text-muted">还有 {parsed.drafts.length - 8} 笔</li>
                ) : null}
              </ul>
            ) : null}
            {parsed.errors.length > 0 ? (
              <p className="mb-3 text-xs text-bad">{parsed.errors.slice(0, 3).join("；")}</p>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button onClick={commit} disabled={parsed.drafts.length === 0}>
                写入 {parsed.drafts.length} 笔
              </Button>
            </div>
          </div>
        </Overlay>
      ) : null}
    </>
  );
}
