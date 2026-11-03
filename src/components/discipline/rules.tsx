import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { RULE_TYPES, typeLabel, useTrading, type RuleType } from "@/lib/trading/store";
import { cn } from "@/lib/cn";
import { Button, Card, Dialog, Field, fieldClass } from "./ui";
import { TrainingSelect } from "@/components/training-select";

type Draft = { title: string; content: string; type: RuleType };

const emptyDraft: Draft = { title: "", content: "", type: "BUY" };

function RuleForm({
  heading,
  initial,
  onSave,
  onCancel,
}: {
  heading: string;
  initial: Draft;
  onSave: (draft: Draft) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content);
  const [type, setType] = useState<RuleType>(initial.type);

  function save() {
    const nextTitle = title.trim();
    const nextContent = content.trim();
    if (!nextTitle || !nextContent) {
      toast.error("标题和说明都要填");
      return;
    }
    onSave({ title: nextTitle, content: nextContent, type });
  }

  return (
    <Card className="border border-primary/50">
      <h3 className="mb-3 text-sm font-semibold">{heading}</h3>
      <Field label="标题">
        <input
          className={fieldClass}
          value={title}
          autoFocus
          maxLength={40}
          placeholder="例如：禁止追高"
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <Field label="详细说明">
        <textarea
          className={cn(fieldClass, "min-h-24 resize-y")}
          value={content}
          maxLength={400}
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
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button variant="ok" onClick={save}>
          保存铁律
        </Button>
      </div>
    </Card>
  );
}

export function RulesScreen() {
  const rules = useTrading((state) => state.rules);
  const addRule = useTrading((state) => state.addRule);
  const updateRule = useTrading((state) => state.updateRule);
  const toggleRule = useTrading((state) => state.toggleRule);
  const removeRule = useTrading((state) => state.removeRule);
  const restoreRule = useTrading((state) => state.restoreRule);
  const moveRule = useTrading((state) => state.moveRule);

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const activeCount = rules.filter((rule) => rule.isActive).length;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <p className="text-sm text-muted">停用的不会出现在交易前检查里。顺序就是检查顺序。</p>
        <p className="shrink-0 font-mono text-xs text-faint tabular-nums">
          启用 {activeCount}/{rules.length}
        </p>
      </div>

      {rules.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">还没有铁律。先写一条你最容易破的。</p>
        </Card>
      ) : (
        rules.map((rule, index) =>
          editingId === rule.id ? (
            <RuleForm
              key={rule.id}
              heading="修改铁律"
              initial={rule}
              onCancel={() => setEditingId(null)}
              onSave={(draft) => {
                updateRule(rule.id, draft);
                setEditingId(null);
                toast.success("铁律已更新");
              }}
            />
          ) : (
            <Card key={rule.id} className={cn("transition", !rule.isActive && "opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-faint tabular-nums">
                    {String(index + 1).padStart(2, "0")} · {typeLabel(rule.type)}
                  </p>
                  <p className="mt-1 text-base font-semibold">{rule.title}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={rule.isActive}
                  aria-label={`${rule.isActive ? "停用" : "启用"}「${rule.title}」`}
                  onClick={() => toggleRule(rule.id)}
                  className={cn(
                    "relative h-7 w-12 shrink-0 rounded-full transition",
                    rule.isActive ? "bg-ok" : "bg-surface-2",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 size-6 rounded-full bg-fg shadow transition-all",
                      rule.isActive ? "left-5" : "left-0.5",
                    )}
                  />
                </button>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted">{rule.content}</p>
              <div className="mt-4 flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={() => setEditingId(rule.id)}>
                  修改
                </Button>
                <Button
                  variant="ghost"
                  className="flex-1 text-bad"
                  onClick={() => setPendingDelete(rule.id)}
                >
                  删除
                </Button>
                <Button
                  variant="ghost"
                  className="w-12 shrink-0 px-0"
                  aria-label={`上移「${rule.title}」`}
                  disabled={index === 0}
                  onClick={() => moveRule(rule.id, -1)}
                >
                  <ArrowUp className="size-4" aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  className="w-12 shrink-0 px-0"
                  aria-label={`下移「${rule.title}」`}
                  disabled={index === rules.length - 1}
                  onClick={() => moveRule(rule.id, 1)}
                >
                  <ArrowDown className="size-4" aria-hidden />
                </Button>
              </div>
            </Card>
          ),
        )
      )}

      {adding ? (
        <RuleForm
          heading="添加铁律"
          initial={emptyDraft}
          onCancel={() => setAdding(false)}
          onSave={(draft) => {
            addRule(draft);
            setAdding(false);
            toast.success("铁律已加上，检查清单会带上它");
          }}
        />
      ) : (
        <Button variant="ghost" onClick={() => setAdding(true)}>
          添加新铁律
        </Button>
      )}

      {pendingDelete ? (
        <Dialog title="删除这条铁律？" onClose={() => setPendingDelete(null)}>
          <p className="mt-2 text-sm text-muted">删掉之后，检查清单里也不会再出现。</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              留下
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const index = rules.findIndex((rule) => rule.id === pendingDelete);
                const removed = rules[index];
                removeRule(pendingDelete);
                if (editingId === pendingDelete) setEditingId(null);
                setPendingDelete(null);
                toast.success("已删除", {
                  action: removed
                    ? { label: "撤销", onClick: () => restoreRule(removed, index) }
                    : undefined,
                });
              }}
            >
              删除
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
