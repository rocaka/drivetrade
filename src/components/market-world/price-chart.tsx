import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CandlestickChart, LineChart } from "lucide-react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  type AutoscaleInfoProvider,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  aggregateQuoteCandles,
  formatChartTime,
  intervalVolumes,
  quoteLineSegments,
  type CandleInterval,
  type PositionChartOverlay,
} from "@/lib/world/chart";
import { currencyCompact } from "@/lib/world/amount";
import { createChartAxisFormatter } from "@/lib/world/chart-axis";
import type { PricePoint } from "@/lib/world/types";
import { Price } from "./shared";
import "./price-chart.css";

type ChartMode = "marketCap" | "usdPrice";
type ChartStyle = "area" | "candle";
type ChartRange = 300 | 900 | "all";
type EntryVisibility = "inside" | "above" | "below" | "none";

// Simulation seconds (which start negative during warm-up) mapped onto an internal UTC axis.
const SIM_EPOCH = 1_704_067_200;
const toChartTime = (seconds: number) => (SIM_EPOCH + seconds) as UTCTimestamp;
const fromChartTime = (time: Time) => (typeof time === "number" ? time - SIM_EPOCH : NaN);
const AREA_SAMPLE = 15;
const RANGES: readonly (readonly [ChartRange, string])[] = [
  [300, "5分"],
  [900, "15分"],
  ["all", "全部"],
];

/** Candle width that gives roughly 20–60 bars for the visible span. */
function candleIntervalFor(span: number): CandleInterval {
  return span <= 900 ? 15 : span <= 3600 ? 60 : 300;
}

function withAlpha(color: string, alpha: number) {
  const hex = color.trim().match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!hex) return color;
  const value = parseInt(hex, 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function changePct(from: number | undefined, to: number | undefined) {
  return from && to !== undefined && from > 0 ? (to / from - 1) * 100 : null;
}

export function PriceChart({
  history,
  now,
  scale,
  mode,
  onModeChange,
  positionOverlay,
}: {
  history: readonly PricePoint[];
  now: number;
  scale: number;
  mode: ChartMode;
  onModeChange: (mode: ChartMode) => void;
  positionOverlay?: PositionChartOverlay | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const api = useRef<{
    chart: IChartApi;
    area: ISeriesApi<"Area">;
    candle: ISeriesApi<"Candlestick">;
    volume: ISeriesApi<"Histogram">;
    colors: { up: string; down: string; muted: string; surface: string; fg: string };
  } | null>(null);
  const entryLines = useRef<{ series: ISeriesApi<"Area"> | ISeriesApi<"Candlestick">; line: IPriceLine }[]>(
    [],
  );
  const formatter = useRef(createChartAxisFormatter(mode, { min: 0, max: 1 }));
  const [style, setStyle] = useState<ChartStyle>("area");
  const [range, setRange] = useState<ChartRange>("all");
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [includeEntry, setIncludeEntry] = useState(false);
  const [entryVisibility, setEntryVisibility] = useState<EntryVisibility>("none");

  // The whole chart always fits the width; the range picks how much of the past it covers.
  const from = range === "all" ? -Infinity : now - range;
  const visible = useMemo(() => {
    if (range === "all") return history;
    // Keep one earlier sample so volume deltas and the first open have a predecessor.
    const start = history.findIndex((point) => point.t >= from);
    return start < 0 ? [] : history.slice(Math.max(0, start - 1));
  }, [history, range, from]);
  const span = Math.max(0, now - (visible.find((point) => point.t >= from)?.t ?? now));
  const interval = candleIntervalFor(range === "all" ? span : range);
  const points = useMemo(
    () => quoteLineSegments(visible, { from, through: now, scale }).flat(),
    [visible, from, now, scale],
  );
  const candles = useMemo(
    () =>
      aggregateQuoteCandles(
        visible.filter((point) => point.t >= from),
        interval,
        { through: now, scale },
      ).filter((candle) => candle.samples > 0),
    [visible, from, interval, now, scale],
  );
  const volumes = useMemo(
    () =>
      intervalVolumes(visible, style === "area" ? AREA_SAMPLE : interval, { through: now }).filter(
        (bar) => bar.time >= Math.floor(from / interval) * interval,
      ),
    [visible, from, interval, now, style],
  );
  const overlay =
    positionOverlay && positionOverlay.quantity > 0 && Number.isFinite(positionOverlay.entryValue)
      ? positionOverlay
      : null;
  const settings = useRef({ overlay, includeEntry, mode, style });
  settings.current = { overlay, includeEntry, mode, style };

  const first = style === "candle" ? (candles[0]?.open ?? undefined) : points[0]?.price;
  const last = points.at(-1)?.price;
  const sessionUp = (last ?? 0) >= (first ?? 0);

  // Readout: the hovered bar or sample, otherwise the latest one.
  const hoveredCandle =
    hoverTime === null
      ? undefined
      : candles.find((candle) => candle.time === Math.floor(hoverTime / interval) * interval);
  const hoveredPoint =
    hoverTime === null ? undefined : points.find((point) => point.t === hoverTime);
  const readoutCandle = style === "candle" ? (hoveredCandle ?? candles.at(-1)) : undefined;
  const readoutPoint = style === "area" ? (hoveredPoint ?? points.at(-1)) : undefined;
  const readoutValue = readoutCandle?.close ?? readoutPoint?.price;
  const readoutTime = readoutCandle?.time ?? readoutPoint?.t;
  const readoutChange = changePct(first, readoutValue ?? undefined);

  // Create the chart once.
  useEffect(() => {
    const element = canvas.current,
      container = root.current;
    if (!element || !container) return;
    const tokens = getComputedStyle(container);
    const token = (name: string) => tokens.getPropertyValue(`--color-${name}`).trim();
    const colors = {
      up: token("ok"),
      down: token("bad"),
      muted: token("muted"),
      surface: token("surface-2"),
      fg: token("fg"),
    };
    const line = token("line");
    const chart = createChart(element, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: colors.muted,
        fontSize: 11,
        fontFamily: tokens.getPropertyValue("--font-sans").trim(),
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: withAlpha(line, 0.45), style: LineStyle.Dotted },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.12, bottom: 0.22 },
        minimumWidth: 64,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 2,
        barSpacing: 6,
        minBarSpacing: 0.5,
        fixLeftEdge: true,
        fixRightEdge: true,
        tickMarkFormatter: (time: Time) => formatChartTime(fromChartTime(time)),
      },
      localization: {
        locale: "zh-CN",
        timeFormatter: (time: Time) => formatChartTime(fromChartTime(time), true),
        // The band under the prices is room for volume bars, not a price level worth labelling.
        priceFormatter: (value: number) => (value <= 0 ? "" : formatter.current(value)),
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: colors.muted, style: LineStyle.Dashed, labelBackgroundColor: colors.surface },
        horzLine: { color: colors.muted, style: LineStyle.Dashed, labelBackgroundColor: colors.surface },
      },
      // A fixed, fitted view: dragging scrubs the crosshair instead of panning the history away.
      handleScroll: false,
      handleScale: false,
    });
    const autoscale: AutoscaleInfoProvider = (base) => {
      const result = base();
      if (!result?.priceRange) return result;
      const { overlay: current, includeEntry: include, mode: currentMode } = settings.current;
      let min = Math.max(0, result.priceRange.minValue),
        max = Math.max(min, result.priceRange.maxValue);
      if (include && current) {
        min = Math.min(min, current.entryValue);
        max = Math.max(max, current.entryValue);
      }
      if (max === min) {
        const pad = min > 0 ? min * 0.02 : currentMode === "marketCap" ? 1 : 0.000001;
        min = Math.max(0, min - pad);
        max += pad;
      }
      formatter.current = createChartAxisFormatter(currentMode, { min, max });
      return { ...result, priceRange: { minValue: min, maxValue: max } };
    };
    const area = chart.addSeries(AreaSeries, {
      lineWidth: 2,
      priceLineStyle: LineStyle.Dashed,
      crosshairMarkerRadius: 4,
      autoscaleInfoProvider: autoscale,
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: colors.up,
      downColor: colors.down,
      borderUpColor: colors.up,
      borderDownColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
      // Outlines keep single-sample (open = close) candles visible.
      borderVisible: true,
      priceLineStyle: LineStyle.Dashed,
      visible: false,
      autoscaleInfoProvider: autoscale,
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false });
    api.current = { chart, area, candle, volume, colors };

    const measureEntry = () => {
      const current = settings.current.overlay;
      const main =
        api.current && (settings.current.style === "candle" ? api.current.candle : api.current.area);
      if (!current || !main) return setEntryVisibility("none");
      const y = main.priceToCoordinate(current.entryValue);
      const height = chart.panes()[0]?.getHeight() ?? 0;
      setEntryVisibility(y === null ? "none" : y < 0 ? "above" : y > height ? "below" : "inside");
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => requestAnimationFrame(measureEntry));
    chart.subscribeCrosshairMove((event) => {
      const time = event.time === undefined ? null : fromChartTime(event.time);
      setHoverTime(time !== null && Number.isFinite(time) ? time : null);
    });
    return () => {
      chart.remove();
      api.current = null;
      entryLines.current = [];
    };
  }, []);

  // Feed data and keep the viewport sensible.
  useEffect(() => {
    const current = api.current;
    if (!current) return;
    const { chart, area, candle, volume, colors } = current;
    const values = style === "candle" ? candles.flatMap((c) => [c.low!, c.high!]) : points.map((p) => p.price);
    if (values.length)
      formatter.current = createChartAxisFormatter(mode, {
        min: Math.min(...values),
        max: Math.max(...values),
      });

    const lineColor = sessionUp ? colors.up : colors.down;
    area.applyOptions({
      visible: style === "area",
      lineColor,
      topColor: withAlpha(lineColor, 0.28),
      bottomColor: withAlpha(lineColor, 0.02),
    });
    candle.applyOptions({ visible: style === "candle" });
    area.setData(points.map((p) => ({ time: toChartTime(p.t), value: p.price })));
    candle.setData(
      candles.map((c) => ({
        time: toChartTime(c.time),
        open: c.open!,
        high: c.high!,
        low: c.low!,
        close: c.close!,
      })),
    );

    // Volume bars take the colour of the price move within the same bar.
    const direction = new Map<number, boolean>();
    if (style === "candle") for (const c of candles) direction.set(c.time, c.close! >= c.open!);
    else
      points.forEach((p, index) =>
        direction.set(Math.floor(p.t / AREA_SAMPLE) * AREA_SAMPLE, p.price >= (points[index - 1]?.price ?? p.price)),
      );
    volume.setData(
      volumes.map((bar) => ({
        time: toChartTime(bar.time),
        value: bar.volume,
        color: withAlpha(direction.get(bar.time) === false ? colors.down : colors.up, 0.35),
      })),
    );

    // Average entry line on whichever series is showing.
    for (const { series, line } of entryLines.current) series.removePriceLine(line);
    entryLines.current = [];
    if (overlay) {
      const tone = overlay.pnlUsd < 0 ? colors.down : overlay.pnlUsd > 0 ? colors.up : colors.muted;
      for (const series of [area, candle] as const)
        entryLines.current.push({
          series,
          line: series.createPriceLine({
            price: overlay.entryValue,
            color: tone,
            lineWidth: 1,
            lineStyle: LineStyle.LargeDashed,
            axisLabelVisible: true,
            axisLabelColor: tone,
            axisLabelTextColor: colors.fg,
            title: "均价",
          }),
        });
    }

    chart.timeScale().fitContent();
    chart.priceScale("right").setAutoScale(true);
    requestAnimationFrame(() => {
      const main = style === "candle" ? candle : area;
      if (!overlay) return setEntryVisibility("none");
      const y = main.priceToCoordinate(overlay.entryValue);
      const height = chart.panes()[0]?.getHeight() ?? 0;
      setEntryVisibility(y === null ? "none" : y < 0 ? "above" : y > height ? "below" : "inside");
    });
  }, [points, candles, volumes, style, mode, overlay, includeEntry, sessionUp]);

  const formatValue = (value: number) =>
    mode === "marketCap" ? currencyCompact(value) : <Price value={value} />;
  const formatCompact = (value: number) =>
    mode === "marketCap" ? currencyCompact(value) : formatter.current(value);

  const rangeLabel = RANGES.find(([value]) => value === range)?.[1] ?? "";

  return (
    <div className="pc" ref={root} data-chart-style={style} data-chart-mode={mode}>
      <div className="pc-readout" aria-live="off">
        <span className="pc-readout-time">
          {readoutTime === undefined ? "—" : formatChartTime(readoutTime, style === "area")}
          {hoverTime === null ? <em>最新</em> : null}
        </span>
        {readoutCandle ? (
          <span className="pc-ohlc">
            <span>
              开<b>{formatCompact(readoutCandle.open!)}</b>
            </span>
            <span>
              高<b>{formatCompact(readoutCandle.high!)}</b>
            </span>
            <span>
              低<b>{formatCompact(readoutCandle.low!)}</b>
            </span>
            <span>
              收<b>{formatCompact(readoutCandle.close!)}</b>
            </span>
          </span>
        ) : readoutValue !== undefined ? (
          <span className="pc-readout-value">{formatValue(readoutValue)}</span>
        ) : null}
        {readoutChange !== null ? (
          <span
            className={`pc-readout-change ${readoutChange >= 0 ? "is-up" : "is-down"}`}
            title={`相对${rangeLabel}起点`}
          >
            {readoutChange >= 0 ? "+" : ""}
            {readoutChange.toFixed(2)}%
          </span>
        ) : null}
      </div>

      <div className="pc-stage">
        <div ref={canvas} className="pc-canvas" />
        {points.length < 2 ? (
          <div className="pc-empty" role="status">
            刚上线，行情数据积累中…
          </div>
        ) : null}
        <div className="pc-chips">
          {overlay && entryVisibility !== "inside" && entryVisibility !== "none" ? (
            <button type="button" className="pc-chip" onClick={() => setIncludeEntry(true)}>
              {entryVisibility === "above" ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
              均价 {formatCompact(overlay.entryValue)} · 显示
            </button>
          ) : null}
          {overlay && includeEntry ? (
            <button type="button" className="pc-chip" onClick={() => setIncludeEntry(false)}>
              只看行情
            </button>
          ) : null}
        </div>
      </div>

      <div className="pc-controls">
        <div className="pc-ranges" role="group" aria-label="时间范围">
          {RANGES.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)}>
              {label}
            </button>
          ))}
        </div>
        <div className="pc-tools">
          <div className="pc-segment" role="group" aria-label="图表数值">
            {(
              [
                ["marketCap", "市值"],
                ["usdPrice", "价格"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => onModeChange(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="pc-style"
            aria-label={style === "area" ? "切换到K线" : "切换到分时"}
            title={style === "area" ? "K线" : "分时"}
            onClick={() => setStyle(style === "area" ? "candle" : "area")}
          >
            {style === "area" ? <CandlestickChart size={16} /> : <LineChart size={16} />}
          </button>
        </div>
      </div>

      <p className="pc-footnote">
        <span>
          {style === "candle" ? `每根 ${interval < 60 ? `${interval} 秒` : `${interval / 60} 分钟`} · ` : ""}
          按住或悬停查看任意时刻
        </span>
        <a href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noreferrer">
          Charts by TradingView
        </a>
      </p>
    </div>
  );
}
