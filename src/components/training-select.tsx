import * as Select from "@radix-ui/react-select";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import "./training-select.css";

export type TrainingSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type TrainingSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly TrainingSelectOption[];
  "aria-label": string;
  "aria-labelledby"?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  name?: string;
};

/** A controlled, keyboard-accessible menu; never opens the OS option picker. */
export function TrainingSelect({
  value,
  onValueChange,
  options,
  disabled,
  placeholder = "请选择",
  className = "",
  id,
  name,
  "aria-label": label,
  "aria-labelledby": labelledBy,
}: TrainingSelectProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const closeWhenHidden = () => {
      if (!trigger.current?.getClientRects().length) close();
    };
    // The training pages stay mounted to preserve drafts. Portalled menus
    // must close when their owning page is hidden or browser history changes.
    const observer = new MutationObserver(closeWhenHidden);
    for (let parent = trigger.current?.parentElement; parent; parent = parent.parentElement)
      observer.observe(parent, { attributes: true, attributeFilter: ["hidden", "style"] });
    window.addEventListener("popstate", close);
    closeWhenHidden();
    return () => {
      observer.disconnect();
      window.removeEventListener("popstate", close);
    };
  }, [open]);
  return (
    <Select.Root
      open={open}
      onOpenChange={setOpen}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      name={name}
    >
      <Select.Trigger
        ref={trigger}
        id={id}
        className={`training-select-trigger ${className}`}
        aria-label={label}
        aria-labelledby={labelledBy}
      >
        <Select.Value placeholder={placeholder} />
        <Select.Icon className="training-select-icon">
          <ChevronDown size={18} aria-hidden="true" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="training-select-content"
          position="popper"
          sideOffset={6}
          collisionPadding={12}
          align="start"
        >
          <Select.ScrollUpButton className="training-select-scroll" aria-label="向上滚动选项">
            <ChevronUp size={18} aria-hidden="true" />
          </Select.ScrollUpButton>
          <Select.Viewport className="training-select-viewport">
            {options
              .filter((option) => option.value !== "")
              .map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="training-select-item"
                  textValue={option.label}
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator className="training-select-check">
                    <Check size={17} aria-hidden="true" />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="training-select-scroll" aria-label="向下滚动选项">
            <ChevronDown size={18} aria-hidden="true" />
          </Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
