import { priceParts } from "@/lib/world/amount";

export type PriceValueProps = {
  value: number;
  currency?: boolean;
  significantDigits?: 3 | 4;
  className?: string;
};

/** Compact visual price with the original full decimal exposed to assistive technology. */
export function PriceValue({
  value,
  currency = false,
  significantDigits = 4,
  className = "",
}: PriceValueProps) {
  const parts = priceParts(value, significantDigits);
  const valid = Number.isFinite(value);
  const prefix = currency && valid ? "$" : "";
  const unsigned = parts.sign ? parts.text.slice(1) : parts.text;
  const full = currency && valid ? `${parts.full} USD` : parts.full;
  return (
    <span className={className} title={full} style={{ fontVariantNumeric: "tabular-nums" }}>
      <span className="sr-only">{full}</span>
      <span aria-hidden="true">
        {parts.sign}
        {prefix}
        {parts.zeroCount > 0 ? (
          <>
            0.0<sub style={{ fontSize: "0.65em", lineHeight: 0 }}>{parts.zeroCount}</sub>
            {parts.digits}
          </>
        ) : (
          unsigned
        )}
      </span>
    </span>
  );
}
