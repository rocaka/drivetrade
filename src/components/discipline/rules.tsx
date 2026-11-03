import { useState } from "react";
import { toast } from "sonner";
import { RULE_TYPES, typeLabel, useTrading, type RuleType } from "@/lib/trading/store";
import { cn } from "@/lib/cn";
import { Button, Card, Field, Overlay, fieldClass } from "./ui";
import { TrainingSelect } from "@/components/training-select";

export function RulesScreen() {
  const rules = useTrading((state) => state.rules);
  const addRule = useTrading((state) => state.addRule);
  const updateRule = useTrading((state) => state.updateRule);
  const toggleRule = useTrading((state) => state.toggleRule);
  const removeRule = useTrading((state) => state.removeRule);

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState<RuleType>("BUY");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  function resetAdd() {
    setTitle("");
    setContent("");
    setType("BUY");
    setAdding(false);
    setEditingId(null);
  }

  function startEdit(id: string) {
    const rule = rules.find((item) => item.id === id);
    if (!rule) return;
    setEditingId(id);
    setTitle(rule.title);
    setContent(rule.content);
    setType(rule.type);
    setAdding(true);
  }

  function save() {
    const nextTitle = title.trim();
    const nextContent = content.trim();
    if (!nextTitle || !nextContent) {
      toast.error("标题和说明都要填");
      return;
    }
    if (editingId) {
      updateRule(editingId, { title: nextTitle, content: nextContent, type });
      toast.success("铁律已更新");
    } else {
      addRule({ title: nextTitle, content: nextContent, type });
      toast.success("铁律已加上，检查清单会带上它");
    }
    resetAdd();
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm text-muted">停用的不会出现在交易前检查里。</p>
      </div>

      {rules.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">还没有铁律。先写一条你最容易破的。</p>
        </Card>
      ) : (
        rules.map((rule) => (
          <Card key={rule.id} className={cn(!rule.isActive && "opacity-60")}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{rule.title}</p>
                <p className="mt-1 text-xs text-muted">{typeLabel(rule.type)}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={rule.isActive}
                onClick={() => toggleRule(rule.id)}
                className={cn(
                  "relative h-7 w-12 shrink-0 rounded-full transition",
                  rule.isActive ? "bg-ok" : "bg-surface-2",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 size-6 rounded-full bg-fg transition",
                    rule.isActive ? "left-5" : "left-0.5",
                  )}
                />
                <span className="sr-only">{rule.isActive ? "停用" : "启用"}</span>
              </button>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted">{rule.content}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={() => startEdit(rule.id)}>
                修改
              </Button>
              <Button
                variant="ghost"
                onClick={() => setPendingDelete(rule.id)}
                className="text-bad"
              >
                删除
              </Button>
            </div>
          </Card>
        ))
      )}

      {adding ? (
        <Card>
          <h3 className="mb-3 text-sm font-semibold">{editingId ? "修改铁律" : "添加铁律"}</h3>
          <Field label="标题">
            <input
              className={fieldClass}
              value={title}
              placeholder="例如：禁止追高"
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field label="详细说明">
            <textarea
              className={cn(fieldClass, "min-h-24 resize-y")}
              value={content}
              placeholder="具体怎么判断、怎么执行"
              onChange={(event) => setContent(event.target.value)}
            />
          </Field>
          <Field label="类型">
            <TrainingSelect
              aria-label="类型"
              value={type}
              onValueChange={(value) => setType(value as RuleType)}
              options={RULE_TYPES}
            />
          </Field>
          <Button variant="ok" onClick={save}>
            保存铁律
          </Button>
          <Button variant="ghost" className="mt-2" onClick={resetAdd}>
            取消
          </Button>
        </Card>
      ) : (
        <Button variant="ghost" onClick={() => setAdding(true)}>
          添加新铁律
        </Button>
      )}

      {pendingDelete ? (
        <Overlay
          className="fixed inset-0 z-40 flex items-end justify-center bg-bg/80 px-4 pb-[max(env(safe-area-inset-bottom,0px),1.25rem)] sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-rule-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-4">
            <h2 id="delete-rule-title" className="text-base font-semibold">
              删除这条铁律？
            </h2>
            <p className="mt-2 text-sm text-muted">删掉之后，检查清单里也不会再出现。</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={() => setPendingDelete(null)}>
                留下
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  removeRule(pendingDelete);
                  if (editingId === pendingDelete) resetAdd();
                  setPendingDelete(null);
                  toast.success("已删除");
                }}
              >
                删除
              </Button>
            </div>
          </div>
        </Overlay>
      ) : null}
    </div>
  );
}
