import { useState } from "react";
import { Check } from "lucide-react";
import { typeLabel, useTrading } from "@/lib/trading/store";
import { cn } from "@/lib/cn";
import { Button, Card } from "./ui";

export function ChecklistScreen({ onPass }: { onPass: () => void }) {
  const rules = useTrading((state) => state.rules);
  const active = rules.filter((rule) => rule.isActive);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const done = active.filter((rule) => checked[rule.id]).length;
  const allChecked = active.length > 0 && done === active.length;

  function toggle(id: string) {
    setChecked((current) => ({ ...current, [id]: !current[id] }));
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm text-muted">勾完才能记这笔交易。这是强制，不是建议。</p>
      </div>

      <Card className="p-0">
        {active.length === 0 ? (
          <p className="p-4 text-sm text-muted">没有启用的铁律。先去「铁律」里启用或添加。</p>
        ) : (
          <ul>
            {active.map((rule) => {
              const on = Boolean(checked[rule.id]);
              return (
                <li key={rule.id} className="border-b border-line last:border-b-0">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(rule.id)}
                    className="flex w-full items-start gap-3 px-4 py-3.5 text-left"
                  >
                    <span
                      className={cn(
                        "mt-0.5 grid size-6 shrink-0 place-items-center border",
                        on ? "border-primary bg-primary text-primary-fg" : "border-line bg-bg text-transparent",
                      )}
                    >
                      <Check className="size-4" strokeWidth={2.5} />
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{rule.title}</span>
                        <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-muted">
                          {typeLabel(rule.type)}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted">{rule.content}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <p className="text-center font-mono text-xs text-muted tabular-nums">
        {done} / {active.length}
      </p>
      <Button variant="ok" disabled={!allChecked} onClick={onPass}>
        {allChecked ? "全部确认，开始记录" : "还有未确认的铁律"}
      </Button>
    </div>
  );
}
