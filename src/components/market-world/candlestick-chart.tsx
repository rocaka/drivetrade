import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Info, RotateCcw } from "lucide-react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  type AutoscaleInfoProvider,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type Time,
  type UTCTimestamp,
  type WhitespaceData,
} from "lightweight-charts";
import {
  aggregateQuoteCandles,
  formatChartTime,
  quoteLineSegments,
  type PositionChartOverlay,
  type CandleInterval,
} from "@/lib/world/chart";
import { currencyCompact, fullDecimal, money } from "@/lib/world/amount";
import { chartAxisRangeFromTicks, createChartAxisFormatter } from "@/lib/world/chart-axis";
import type { PricePoint } from "@/lib/world/types";
import { Price } from "./shared";
import "./financial-chart.css";

type ChartMode = "marketCap" | "usdPrice";
type ChartStyle = "candle" | "line";
type CandleDatum = CandlestickData<UTCTimestamp> | WhitespaceData<UTCTimestamp>;
type LineDatum = LineData<UTCTimestamp>;
type MainSeries = ISeriesApi<"Candlestick"> | ISeriesApi<"Line">;
type EntryVisibility = "inside" | "above" | "below" | "none";

// An internal UTC coordinate only. All labels convert back to simulation seconds,
// including negative warm-up times and elapsed hours beyond 24.
const SIM_EPOCH = 1_704_067_200;
const toChartTime = (seconds: number) => (SIM_EPOCH + seconds) as UTCTimestamp;
const fromChartTime = (time: Time) => (typeof time === "number" ? time - SIM_EPOCH : NaN);

function equalDatum(a: CandleDatum | LineDatum, b: CandleDatum | LineDatum) {
  return (
    a.time === b.time &&
    ("close" in a
      ? "close" in b &&
        a.open === b.open &&
        a.high === b.high &&
        a.low === b.low &&
        a.close === b.close
      : "value" in a
        ? "value" in b && a.value === b.value
        : !("close" in b) && !("value" in b))
  );
}

/** Updates a changing tail. Replacing a transient live sample must remove the
 * previous sample rather than turning it into invented saved history. */
function syncSeries<T extends CandleDatum | LineDatum>(
  series: { setData: (data: T[]) => void; update: (data: T) => void },
  previous: readonly T[],
  next: T[],
) {
  const stablePrefix =
    previous.length > 0 &&
    next.length >= previous.length &&
    previous.slice(0, -1).every((point, index) => equalDatum(point, next[index])) &&
    previous.at(-1)!.time === next[previous.length - 1]?.time;
  if (!stablePrefix) {
    if (previous.length || next.length) series.setData(next);
    return;
  }
  if (!equalDatum(previous.at(-1)!, next[previous.length - 1]))
    series.update(next[previous.length - 1]);
  for (let index = previous.length; index < next.length; index++) series.update(next[index]);
}

export function CandlestickChart({
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
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candleSeries = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lines = useRef<{ series: ISeriesApi<"Line">; data: LineDatum[] }[]>([]);
  const candleData = useRef<CandleDatum[]>([]);
  const timeline = useRef<number[]>([]);
  const entryLine = useRef<{ series: MainSeries; line: IPriceLine } | null>(null);
  const autoscale = useRef<AutoscaleInfoProvider>((base) => base());
  const axisFormatter = useRef(createChartAxisFormatter(mode, { min: 0, max: 1 }));
  const frame = useRef<number | null>(null);
  const resetNeeded = useRef(true);
  const hasLayout = useRef(false);
  const tooltipId = useId();
  const [interval, setInterval] = useState<CandleInterval>(60);
  const [style, setStyle] = useState<ChartStyle>("candle");
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const [includeEntry, setIncludeEntry] = useState(false);
  const [entryVisibility, setEntryVisibility] = useState<EntryVisibility>("none");
  const [isLive, setIsLive] = useState(true);
  const candles = useMemo(
    () => aggregateQuoteCandles(history, interval, { through: now, scale }),
    [history, interval, now, scale],
  );
  const lineSegments = useMemo(
    () => quoteLineSegments(history, { through: now, scale }),
    [history, now, scale],
  );
  const linePoints = useMemo(() => lineSegments.flat(), [lineSegments]);
  const overlay =
    positionOverlay && positionOverlay.quantity > 0 && Number.isFinite(positionOverlay.entryValue)
      ? positionOverlay
      : null;
  const current = useRef({ mode, style, interval, overlay, includeEntry });
  current.current = { mode, style, interval, overlay, includeEntry };
  const actions = useRef({ reset: () => {}, refreshEntry: () => {} });
  const positionTone =
    overlay && overlay.pnlUsd < 0
      ? "var(--color-bad)"
      : overlay && overlay.pnlUsd > 0
        ? "var(--color-ok)"
        : "var(--color-muted)";
  const active =
    selectedTime === null
      ? candles.at(-1)
      : candles.find((candle) => candle.time === Math.floor(selectedTime / interval) * interval);
  const activePoint =
    selectedTime === null
      ? linePoints.at(-1)
      : linePoints.find((point) => point.t === selectedTime);
  const activeTime =
    style === "line" ? (activePoint?.t ?? selectedTime ?? undefined) : active?.time;
  const priceDirection =
    style === "candle" && active?.samples
      ? active.close! > active.open!
        ? "is-up"
        : active.close! < active.open!
          ? "is-down"
          : ""
      : "";

  useEffect(() => {
    const element = canvas.current;
    const root = container.current;
    if (!element || !root) return;
    const tokens = getComputedStyle(root);
    const color = (name: string) => tokens.getPropertyValue(`--color-${name}`).trim();
    const up = color("ok"),
      down = color("bad"),
      foreground = color("fg"),
      muted = color("muted"),
      background = color("bg"),
      surface = color("surface-2"),
      border = color("line");
    const gridColor = /^#[0-9a-f]{6}$/i.test(border) ? `${border}66` : border;
    const bounds = element.getBoundingClientRect();
    hasLayout.current = bounds.width > 0 && bounds.height > 0;
    const api = createChart(element, {
      width: Math.max(1, Math.floor(bounds.width)),
      height: Math.max(1, Math.floor(bounds.height)),
      layout: {
        background: { type: ColorType.Solid, color: background },
        textColor: muted,
        fontSize: 10,
        fontFamily: tokens.getPropertyValue("--font-sans").trim(),
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: gridColor, style: LineStyle.Solid },
        horzLines: { color: gridColor, style: LineStyle.Solid },
      },
      rightPriceScale: {
        borderVisible: false,
        minimumWidth: 84,
        scaleMargins: { top: 0.25, bottom: 0 },
        autoScale: true,
      },
      leftPriceScale: { visible: false },
      timeScale: {
        borderColor: border,
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 7,
        minBarSpacing: 0.5,
        maxBarSpacing: 18,
        rightOffset: 4,
        lockVisibleTimeRangeOnResize: true,
        shiftVisibleRangeOnNewBar: true,
        allowShiftVisibleRangeOnWhitespaceReplacement: true,
        tickMarkFormatter: (time: Time) => formatChartTime(fromChartTime(time)),
      },
      localization: {
        locale: "zh-CN",
        timeFormatter: (time: Time) => formatChartTime(fromChartTime(time), true),
        priceFormatter: (value: number) => axisFormatter.current(value),
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: muted,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: surface,
        },
        horzLine: {
          color: muted,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: surface,
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
      },
      kineticScroll: { mouse: false, touch: true },
    });
    chart.current = api;
    autoscale.current = (base) => {
      const result = base();
      if (!result?.priceRange) return result;
      const state = current.current;
      let min = Math.max(0, result.priceRange.minValue),
        max = Math.max(min, result.priceRange.maxValue);
      if (state.includeEntry && state.overlay) {
        min = Math.min(min, state.overlay.entryValue);
        max = Math.max(max, state.overlay.entryValue);
      }
      // Only the coordinate range expands for a zero quote; no synthetic price.
      if (max === min)
        max = min + (min > 0 ? min * 0.01 : state.mode === "marketCap" ? 1 : 0.000001);
      axisFormatter.current = createChartAxisFormatter(state.mode, { min, max });
      return { ...result, priceRange: { minValue: min, maxValue: max } };
    };
    const series = api.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      wickUpColor: up,
      wickDownColor: down,
      borderVisible: false,
      wickVisible: true,
      priceLineStyle: LineStyle.Dashed,
      priceLineWidth: 1,
      lastValueVisible: true,
      priceLineVisible: true,
      autoscaleInfoProvider: autoscale.current,
    });
    candleSeries.current = series;

    const refreshEntry = () => {
      frame.current = null;
      const state = current.current;
      const main = state.style === "candle" ? series : lines.current.at(-1)?.series;
      const nextOverlay = state.overlay;
      const range = api.priceScale("right").getVisibleRange();
      if (range) {
        root.dataset.priceMin = String(range.from);
        root.dataset.priceMax = String(range.to);
      }
      if (!nextOverlay || !main || !timeline.current.length) {
        if (entryLine.current) {
          entryLine.current.series.removePriceLine(entryLine.current.line);
          entryLine.current = null;
        }
        setEntryVisibility((old) => (old === "none" ? old : "none"));
        return;
      }
      if (entryLine.current?.series !== main) {
        if (entryLine.current) entryLine.current.series.removePriceLine(entryLine.current.line);
        entryLine.current = {
          series: main,
          line: main.createPriceLine({
            price: nextOverlay.entryValue,
            color: muted,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            title: "均价",
            lineVisible: false,
            axisLabelVisible: false,
            axisLabelColor: surface,
            axisLabelTextColor: foreground,
          }),
        };
      }
      const y = main.priceToCoordinate(nextOverlay.entryValue);
      const paneHeight = api.panes()[0]?.getHeight() ?? 0;
      const visibility: EntryVisibility =
        y === null ? "none" : y < 0 ? "above" : y > paneHeight ? "below" : "inside";
      const options = entryLine.current.line.options(),
        visible = visibility === "inside";
      if (
        options.price !== nextOverlay.entryValue ||
        options.lineVisible !== visible ||
        options.axisLabelVisible !== visible
      )
        entryLine.current.line.applyOptions({
          price: nextOverlay.entryValue,
          lineVisible: visible,
          axisLabelVisible: visible,
        });
      setEntryVisibility((old) => (old === visibility ? old : visibility));
    };
    const scheduleEntry = () => {
      if (frame.current === null) frame.current = requestAnimationFrame(refreshEntry);
    };
    const reset = () => {
      const lastIndex = timeline.current.length - 1;
      if (lastIndex < 0) return;
      const slots = current.current.style === "candle" ? 60 : 240;
      api.timeScale().setVisibleLogicalRange({
        from: lastIndex - slots + 1,
        to: lastIndex + Math.max(4, slots / 20),
      });
      api.priceScale("right").setAutoScale(true);
      api.clearCrosshairPosition();
      setSelectedTime(null);
      scheduleEntry();
    };
    actions.current = { reset, refreshEntry: scheduleEntry };
    const onRangeChange = () => {
      const range = api.timeScale().getVisibleLogicalRange();
      if (range) {
        root.dataset.viewportFrom = String(range.from);
        root.dataset.viewportTo = String(range.to);
        const latest = timeline.current.length - 1;
        setIsLive(range.to >= latest && range.from <= latest);
      }
      scheduleEntry();
    };
    api.subscribeCrosshairMove((event) => {
      const time = event.time === undefined ? null : fromChartTime(event.time);
      setSelectedTime(time !== null && Number.isFinite(time) ? time : null);
      scheduleEntry();
    });
    api.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange);
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        const firstLayout = !hasLayout.current;
        hasLayout.current = true;
        api.resize(Math.floor(rect.width), Math.floor(rect.height));
        if (firstLayout && resetNeeded.current && timeline.current.length) {
          resetNeeded.current = false;
          actions.current.reset();
        }
        scheduleEntry();
      }
    });
    observer.observe(element);
    element.addEventListener("pointermove", scheduleEntry);
    element.addEventListener("pointerup", scheduleEntry);
    element.addEventListener("wheel", scheduleEntry, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("pointermove", scheduleEntry);
      element.removeEventListener("pointerup", scheduleEntry);
      element.removeEventListener("wheel", scheduleEntry);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      api.remove();
      chart.current = null;
      candleSeries.current = null;
      lines.current = [];
      candleData.current = [];
      timeline.current = [];
      entryLine.current = null;
      resetNeeded.current = true;
      hasLayout.current = false;
      actions.current = { reset: () => {}, refreshEntry: () => {} };
    };
  }, []);

  useEffect(() => {
    const api = chart.current,
      series = candleSeries.current,
      root = container.current;
    if (!api || !series || !root) return;
    const previousTimeline = timeline.current,
      previousRange = api.timeScale().getVisibleLogicalRange();
    const wasFollowing = !previousRange || previousRange.to >= previousTimeline.length - 1;
    const tokens = getComputedStyle(root);
    const formatter = (value: number) => axisFormatter.current(value);
    const tickmarksFormatter = (prices: readonly number[]) => {
      const range = chartAxisRangeFromTicks(prices);
      if (range) axisFormatter.current = createChartAxisFormatter(current.current.mode, range);
      const labels = prices.map((value) => axisFormatter.current(value));
      root.dataset.axisLabels = labels.join("|");
      return labels;
    };
    const latestPrice = linePoints.at(-1)?.price ?? 1;
    const minMove =
      latestPrice > 0
        ? Math.max(Number.MIN_VALUE, 10 ** (Math.floor(Math.log10(latestPrice)) - 12))
        : mode === "marketCap"
          ? 0.01
          : 0.000000001;
    const priceFormat = { type: "custom" as const, minMove, formatter, tickmarksFormatter };
    series.applyOptions({ priceFormat, visible: style === "candle" });
    let nextTimeline: number[];
    if (style === "candle") {
      if (entryLine.current && entryLine.current.series !== series) {
        entryLine.current.series.removePriceLine(entryLine.current.line);
        entryLine.current = null;
      }
      for (const line of lines.current) api.removeSeries(line.series);
      lines.current = [];
      const next: CandleDatum[] = candles.map((candle) =>
        candle.samples
          ? {
              time: toChartTime(candle.time),
              open: candle.open!,
              high: candle.high!,
              low: candle.low!,
              close: candle.close!,
            }
          : { time: toChartTime(candle.time) },
      );
      syncSeries(series, candleData.current, next);
      candleData.current = next;
      nextTimeline = candles.map((candle) => candle.time);
    } else {
      // A whitespace timeline preserves real missing intervals. Separate line
      // series prevent Lightweight Charts from joining across those intervals.
      const times = new Set(linePoints.map((point) => point.t)),
        first = linePoints[0]?.t;
      if (first !== undefined)
        for (let time = Math.ceil(first / 15) * 15; time <= now; time += 15) times.add(time);
      nextTimeline = [...times].sort((a, b) => a - b);
      const blanks = nextTimeline.map((time) => ({ time: toChartTime(time) }));
      if (entryLine.current?.series === series) {
        series.removePriceLine(entryLine.current.line);
        entryLine.current = null;
      }
      syncSeries(series, candleData.current, blanks);
      candleData.current = blanks;
      while (lines.current.length > lineSegments.length) {
        const removed = lines.current.pop()!;
        if (entryLine.current?.series === removed.series) entryLine.current = null;
        api.removeSeries(removed.series);
      }
      lineSegments.forEach((segment, index) => {
        let item = lines.current[index];
        if (!item) {
          item = {
            series: api.addSeries(LineSeries, {
              color: tokens.getPropertyValue("--color-ok").trim(),
              lineWidth: 2,
              lineStyle: LineStyle.Solid,
              crosshairMarkerVisible: true,
              pointMarkersRadius: 2,
              priceLineStyle: LineStyle.Dashed,
              autoscaleInfoProvider: autoscale.current,
            }),
            data: [],
          };
          lines.current.push(item);
        }
        item.series.applyOptions({
          priceFormat,
          priceLineVisible: index === lineSegments.length - 1,
          lastValueVisible: index === lineSegments.length - 1,
          pointMarkersVisible: segment.length === 1,
        });
        const next = segment.map((point) => ({ time: toChartTime(point.t), value: point.price }));
        syncSeries(item.series, item.data, next);
        item.data = next;
      });
    }
    timeline.current = nextTimeline;
    root.dataset.timelineCount = String(nextTimeline.length);
    root.dataset.renderedCandles = String(
      style === "candle" ? candles.filter((candle) => candle.samples).length : 0,
    );
    root.dataset.lineSegments = String(style === "line" ? lineSegments.length : 0);
    if (resetNeeded.current && hasLayout.current && nextTimeline.length) {
      resetNeeded.current = false;
      actions.current.reset();
    } else if (!wasFollowing && previousRange && previousTimeline.length && nextTimeline.length) {
      // Retained history can lose its first sample; preserve a panned time anchor.
      const anchorIndex = Math.max(
          0,
          Math.min(previousTimeline.length - 1, Math.ceil(previousRange.from)),
        ),
        nextAnchor = nextTimeline.indexOf(previousTimeline[anchorIndex]);
      if (nextAnchor >= 0 && nextAnchor !== anchorIndex) {
        const offset = nextAnchor - anchorIndex;
        api.timeScale().setVisibleLogicalRange({
          from: previousRange.from + offset,
          to: previousRange.to + offset,
        });
      }
    }
    actions.current.refreshEntry();
  }, [candles, lineSegments, linePoints, now, mode, style]);

  useEffect(() => {
    // Only a scope selection resets vertical scaling; quote/FX ticks preserve a
    // user's manual price-axis zoom just as they preserve horizontal panning.
    chart.current?.priceScale("right").setAutoScale(true);
    actions.current.refreshEntry();
  }, [includeEntry, mode]);

  useEffect(() => {
    if (!overlay && includeEntry) setIncludeEntry(false);
    actions.current.refreshEntry();
  }, [overlay, includeEntry]);

  const readoutRange = active
    ? chartAxisRangeFromTicks(
        [active.open, active.high, active.low, active.close].filter(
          (value): value is number => value !== null,
        ),
      )
    : null;
  const readoutFormatter =
    style === "candle" && readoutRange
      ? createChartAxisFormatter(mode, readoutRange)
      : axisFormatter.current;
  const readValue = (value: number | null | undefined) =>
    value === null || value === undefined ? (
      "—"
    ) : (
      <span title={`${fullDecimal(value)} USD`}>{readoutFormatter(value)}</span>
    );
  const entryHint = (direction: "above" | "below") => (
    <div className="mw-financial-edge" data-direction={direction}>
      {direction === "above" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      <span>均价在{direction === "above" ? "上方" : "下方"}</span>
      <span title={`${fullDecimal(overlay!.entryValue)} USD`}>
        {mode === "marketCap" ? (
          currencyCompact(overlay!.entryValue)
        ) : (
          <Price value={overlay!.entryValue} />
        )}
      </span>
    </div>
  );

  return (
    <div
      className="mw-kline mw-financial-chart"
      ref={container}
      data-testid="market-candlestick-chart"
      data-chart-engine="lightweight-charts"
      data-interval={interval}
      data-mode={mode}
      data-chart-style={style}
      data-candles-count={candles.length}
      data-entry-in-autoscale={includeEntry}
    >
      <div className="mw-financial-toolbar">
        <div className="mw-financial-buttons" aria-label="图表显示">
          {(
            [
              ["marketCap", "市值"],
              ["usdPrice", "单价"],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={mode === value ? "is-active" : ""}
              aria-pressed={mode === value}
              onClick={() => onModeChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mw-financial-buttons" aria-label="图表样式">
          {(
            [
              ["candle", "K线"],
              ["line", "折线"],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={style === value ? "is-active" : ""}
              aria-pressed={style === value}
              onClick={() => {
                if (value !== style) {
                  resetNeeded.current = true;
                  setStyle(value);
                  setSelectedTime(null);
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mw-financial-buttons">
          <button
            type="button"
            onClick={() => actions.current.reset()}
            aria-label="重置图表，回到最新报价"
            title="重置缩放并回到最新"
          >
            <RotateCcw size={15} />
          </button>
          <details
            className="mw-financial-help"
            onKeyDown={(event) => {
              if (event.key === "Escape") event.currentTarget.open = false;
            }}
          >
            <summary aria-label="图表说明" title="图表说明">
              <Info size={16} />
            </summary>
            <div>
              <strong>模拟报价图</strong>
              <p>
                开、高、低、收来自区间内已保存报价，不代表逐笔成交。无样本区间留空，当前区间继续更新；历史不足时保留空白，不补造蜡烛。
              </p>
              <p>
                {mode === "marketCap"
                  ? "市值按当前供应量与汇率换算，未回填历史供应量。"
                  : "美元单价按当前汇率换算。"}
                负时间是开局预热，时间轴使用模拟时间。
              </p>
              <p>
                拖动查看历史，滚轮或双指缩放；十字光标查看报价，键盘左右选择，Esc返回最新。折线使用实际报价时间，缺少15秒采样时断开。
              </p>
              <p>
                持仓均价包含已分摊买入成本；市值模式乘当前供应量。均价默认不改变行情纵轴，选择“显示均价范围”才纳入。净退出盈亏另计卖出成本与链费，不能退出时按零回收估值。
              </p>
            </div>
          </details>
        </div>
      </div>
      <div className="mw-financial-subtoolbar">
        <div className="mw-financial-buttons" aria-label="K线周期">
          {([60, 300, 900] as const).map((value) => (
            <button
              type="button"
              key={value}
              className={interval === value ? "is-active" : ""}
              aria-label={`${value / 60} 分钟K线`}
              aria-pressed={interval === value}
              disabled={style === "line"}
              onClick={() => {
                if (value !== interval) {
                  resetNeeded.current = true;
                  setInterval(value);
                  setSelectedTime(null);
                }
              }}
            >
              {value / 60}m
            </button>
          ))}
        </div>
        {overlay && (
          <button
            type="button"
            className={`mw-financial-entry-toggle${includeEntry ? " is-active" : ""}`}
            aria-pressed={includeEntry}
            onClick={() => setIncludeEntry((value) => !value)}
          >
            {includeEntry ? "恢复行情范围" : "显示均价范围"}
          </button>
        )}
      </div>
      {overlay && (
        <div
          className="mw-financial-position"
          data-testid="market-position-overlay"
          data-can-exit={overlay.canExit}
        >
          <div>
            <span className="mw-financial-position-label">净退出盈亏</span>
            <strong style={{ color: positionTone }} data-testid="market-position-pnl">
              {overlay.pnlUsd < 0 ? "−" : overlay.pnlUsd > 0 ? "+" : ""}$
              {money(Math.abs(overlay.pnlUsd))}{" "}
              <small>
                (
                {overlay.returnPct === null
                  ? "—"
                  : `${overlay.returnPct < 0 ? "−" : overlay.returnPct > 0 ? "+" : ""}${Math.abs(overlay.returnPct).toFixed(2)}%`}
                )
              </small>
            </strong>
          </div>
          <div>
            <span className="mw-financial-position-label">持仓均价</span>
            <Price value={overlay.entryUsd} />
          </div>
          {!overlay.canExit && (
            <p className="mw-bad">
              暂无法退出 · {overlay.exitReason || "退出条件未满足"} · 退出估值 $0.00
            </p>
          )}
        </div>
      )}
      {overlay && entryVisibility === "above" && entryHint("above")}
      <div
        className="mw-financial-plot"
        role="group"
        tabIndex={0}
        aria-label={`${mode === "marketCap" ? "市值" : "单价"}${style === "line" ? "折线图" : `${interval / 60}分钟K线图`}，拖动查看历史，滚轮或双指缩放，左右方向键查看报价`}
        aria-describedby={tooltipId}
        onKeyDown={(event) => {
          const times =
            style === "line"
              ? linePoints.map((point) => point.t)
              : candles.map((point) => point.time);
          if (!times.length) return;
          if (event.key === "Escape") {
            chart.current?.clearCrosshairPosition();
            setSelectedTime(null);
            return;
          }
          let index = selectedTime === null ? times.length - 1 : times.indexOf(selectedTime);
          if (event.key === "ArrowLeft") index--;
          else if (event.key === "ArrowRight") index++;
          else if (event.key === "Home") index = 0;
          else if (event.key === "End") index = times.length - 1;
          else return;
          event.preventDefault();
          index = Math.max(0, Math.min(times.length - 1, index));
          setSelectedTime(times[index]);
          const main =
            style === "candle"
              ? candleSeries.current
              : lines.current.find((line) =>
                  line.data.some((point) => fromChartTime(point.time) === times[index]),
                )?.series;
          const value = style === "candle" ? candles[index].close : linePoints[index].price;
          if (main && value !== null && value !== undefined)
            chart.current?.setCrosshairPosition(value, toChartTime(times[index]), main);
        }}
      >
        <div className="mw-financial-canvas" ref={canvas} />
        <div
          className={`mw-financial-readout ${priceDirection}`}
          id={tooltipId}
          role="tooltip"
          data-testid="market-candle-tooltip"
          data-time={activeTime}
        >
          <div className="mw-financial-readout-meta">
            <time>{activeTime === undefined ? "—" : formatChartTime(activeTime, true)}</time>
            <span>
              {style === "line"
                ? activePoint
                  ? "参考报价"
                  : "无样本"
                : active?.samples
                  ? `${active.samples} 样本${active.time + interval > now ? " · 进行中" : ""}`
                  : "无样本"}
            </span>
          </div>
          <dl>
            {style === "line" ? (
              <div>
                <dt>{mode === "marketCap" ? "市值" : "单价"}</dt>
                <dd>{readValue(activePoint?.price)}</dd>
              </div>
            ) : (
              (
                [
                  ["open", "开"],
                  ["high", "高"],
                  ["low", "低"],
                  ["close", "收"],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{readValue(active?.[key])}</dd>
                </div>
              ))
            )}
          </dl>
        </div>
        {!linePoints.length && <div className="mw-financial-empty">暂无已保存的报价样本</div>}
      </div>
      {overlay && entryVisibility === "below" && entryHint("below")}
      {overlay && (
        <span
          className="sr-only"
          data-testid="market-entry-line"
          data-entry-value={overlay.entryValue}
          data-visibility={entryVisibility}
        >
          持仓均价 {fullDecimal(overlay.entryUsd)} USD/币；
          {mode === "marketCap" ? "对应参考市值" : "图中单价"} {fullDecimal(overlay.entryValue)}{" "}
          USD；
          {entryVisibility === "inside"
            ? "均价线位于图中"
            : entryVisibility === "above"
              ? "均价超出图表上方"
              : entryVisibility === "below"
                ? "均价超出图表下方"
                : "等待报价"}
        </span>
      )}
      <div className="mw-financial-caption">
        <span>{isLive ? "最新报价" : "查看历史"} · 拖动 / 缩放</span>
        <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">
          TradingView Lightweight Charts™
        </a>
      </div>
    </div>
  );
}
