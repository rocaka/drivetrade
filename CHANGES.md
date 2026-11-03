# Changes — advanced track: consistent profit (2026-11-03)

Optional, ungraded track in 学习. The 24-lesson course, the 30-question test, the 12 required exercises and all existing grades are unchanged.

## Lessons (`src/lib/academy/profit-content.ts`)
12 lessons in 4 stations, each with an example, a common trap and a check question:
- 稳定从哪里来: 稳定盈利的三个条件 · 用 R 来记账 · 固定比例风险
- 找到并验证优势: 可重复的入场 · 样本量与连亏 · 只做A级机会
- 小亏大赚: 亏损封顶在 1R · 让盈利跑一段 · 时间止损
- 节奏与复盘: 每天的交易节奏 · 每周复盘看这五个数 · 什么时候可以加大规模

## Practice
- **4 advanced exercises** (`trade-practice-13…16` in `training-lab/trading.ts`): 按 1R 算仓位, 保本保护余仓, 时间止损, 三笔同样的风险. Scored and saved like the others, listed separately (进阶实操 x/4), never counted toward the 12.
- Every exercise's buy ticket now shows the trade's **1R** (loss at the stop including fees); the sizing exercises flag it red/green against the $0.50–$1 band.
- **稳定盈利模拟器** (`profit-sim.ts`, `profit-simulator.tsx`): pick win rate, average win (R) and risk per trade; 400 seeded runs of 100 trades show profitable share, median and worst-decile return, typical drawdown and losing streak, with a plain-language verdict (e.g. a +0.12R method at 20% risk loses 66% in the median run).

## Tests
`training-lab/advanced.test.ts` (each exercise passes with the right behaviour and fails with the wrong one) and `academy/profit-sim.test.ts`.

# Changes — realistic market tape & fitted chart (2026-11-03)

## Market simulation (`engine.ts`, new worlds only)
- New free-mode worlds get `marketTape: "tape-v1"`: coins that drew real trading in the last 5 minutes keep receiving small two-way orders ($0.5–$25 buys, partial sells by actual holders) with short-term momentum, fading out as the coin goes quiet. Charts trade continuously instead of sitting flat and jumping.
- Existing worlds and exams are unchanged (no flag), so their replay and grades stay identical.
- History samples now record `open` (previous close), `high` and `low` from every trade between samples, so candles have real wicks and join up.

## Chart (`price-chart.tsx`)
- Always shows the whole selected range fitted to the width; no panning or zooming that pushes history off-screen. Drag or hover scrubs the readout.
- Range tabs under the chart: 5分 / 15分 / 全部. Candle width follows the range (15 s up to 15 min, 1 min up to 1 h).
- The style toggle is now one icon button next to 市值/价格; the % change is measured from the start of the selected range.
- No "$0" label in the volume band.

# Changes — market chart & trade rebuild (2026-11-02)

## Chart (`price-chart.tsx`, replaces `candlestick-chart.tsx`)
- **分时 (area) view by default**, coloured green/red by the move since the first sample; **K线** with 1m/5m/15m one tap away.
- Candles have outlines, so single-sample (open = close) candles are visible instead of vanishing.
- **Volume bars** along the bottom (per-interval volume from the engine's running total, `intervalVolumes` in `lib/world/chart.ts`, tested).
- Readout (time, value, O/H/L/C, change) sits above the chart instead of over it.
- Young coins fill the width; older ones show the latest 120 samples / 48 candles. "回到最新" appears when you scroll away.
- Average-entry line labelled 均价 and coloured by P&L; a chip offers to bring it into view when it is off-scale.
- No watermark (attribution kept as a footer link); axis never shows negative prices.

## Token page & trade ticket (`token-detail.tsx`, `token-detail.css`)
- New header: name, symbol, chain/platform/age, market cap with change pill, unit price, 4-stat strip.
- Position card: net exit P&L ($ and %), cost, exit value, protection levels shown as market cap (previously "<$0.01"), "卖出一半 / 全部卖出" shortcuts.
- Ticket: green/red buy/sell switch, balance line, large amount field, presets (sell has 全部), always-visible summary (receive, fees, **price impact**, slippage), colour-coded submit, quieter "先不动，观察 1 分钟", slippage presets in settings.
- Phones: a bottom Buy / Sell / Observe bar appears while the ticket is off-screen and jumps to it.
- Desktop (≥960 px): two columns — chart and info left, ticket pinned on the right.
- Trading logic (balance preparation, slippage, risk checks, legacy exam plan fields) is unchanged.

# Changes — ledger UX pass (2026-11-02)

No saved-data formats changed; existing saves and backups load as before.

## Fixes
- **Streak and execution rate follow trade dates**, not array order. Imported or edited trades could previously zero the streak. (`newestFirst` in `src/lib/trading/store.ts`, 4 new tests in `store.test.ts`.)
- **Market: Back returns to the token list.** Opening a token now adds a history entry, so the browser Back button / swipe gesture closes the token instead of leaving the market.
- **Dialogs** (delete trade, delete rule, import backup) share one `Dialog`: Esc and backdrop close it, focus moves in and returns to the opener, Tab stays inside.
- Journal rejects future dates and warns when a loss exceeds the stake.
- Home poster shows "—" instead of a misleading 0% before the first trade.

## Features
- Stats: search by symbol/reason/date, filter counts, new "未平仓" filter, list sorted by date, return % on each trade, "补记平仓" shortcut for open trades.
- Deleting a trade or rule can be undone from the toast.
- Rules: edit in place (the form no longer opens at the bottom of the page), reorder with up/down (order = checklist order), enabled count.
- Checklist: progress bar.
- Home: backup/import tools grouped into one collapsible "数据与备份" section, copy button for the text backup, contextual hints on tiles.

## UI
- Consistent rounded chips, badges and checkboxes; hover states; visible keyboard focus rings; sheet open animation; `prefers-reduced-motion` respected app-wide.

## Academy / training (same pass)
- **Back returns to the hub.** Opening a practice exercise, lesson, practice scenario or the knowledge quiz now adds a history entry, so Back closes it instead of leaving training. Formal exam rounds are deliberately excluded so Back can't abandon a graded attempt.
- **"下一项：…" after passing an exercise** jumps straight to the next unfinished one (wrapping to earlier gaps), with a "本次记录已保存 · 实操达标 n / 12" note. When all 12 are done it points to the exams page.
- The exercise header shows how many exercises are already passed.
- Passed exercises in the 12-exercise list get a green check and green status line.

## Verification
- `npm run typecheck` ✔ · `npm run test:training` 171/171 ✔ · `npm test` ✔ · `npm run build` ✔ · lint 0 errors
- Browser: checklist → journal → stats flow, practice exercise pass → next → Back, delete/undo, dialog Esc/backdrop/focus, rule reorder and inline edit, market Back, 375 px with no horizontal overflow.

# Changes — maintenance pass (2026-11-02)

No gameplay, grading, or saved-data formats were changed. Existing browser saves and backups load as before.

## Install & dependencies
- **Rebuilt `package-lock.json`** against the official npm registry. The old lock was out of sync with `package.json` (so `npm ci` failed) and pulled 10 packages from `registry.npmmirror.com`.
- **Removed 30 unused packages** left over from the app-builder template (most Radix UI components, react-hook-form + resolvers, TanStack Table, cmdk, date-fns, react-day-picker, react-resizable-panels, vaul, class-variance-authority, tw-animate-css). `@radix-ui/react-select` is kept because the app uses it.
- Package renamed `app-builder-workspace` → `drivetrade`; added `engines.node >= 22`.

## AI ledger analysis (`src/lib/trading/analyze.ts`)
The "看这笔账" button's server function previously had no rate limit, timeout or schema, so anyone could repeatedly spend the owner's xAI quota on a public deploy.
- Input validated with zod (summary ≤ 2000 chars, 1–120 lines of ≤ 180 chars).
- Per-instance limits: hourly cap (`XAI_ANALYZE_HOURLY_LIMIT`, default 10) and max 2 concurrent calls.
- 20 s upstream timeout; all network/parse failures return a friendly error instead of throwing.
- Model output validated with zod before reaching the UI.
- Model configurable via `XAI_ANALYZE_MODEL` (falls back to `XAI_TRAINING_MODEL`, then `grok-4.5`).
- System prompt now tells the model to ignore instructions embedded in ledger text.
- Pure logic moved to `src/lib/trading/analysis.ts` with 5 new tests (`analysis.test.ts`, included in `npm run test:training`).
- Client: lines are clipped to the server limit, and a full/blocked localStorage no longer turns a successful analysis into an error.

## Performance
- Home-screen equity sparkline is now a small inline SVG (`equity-spark.tsx`) instead of a recharts chart, and the Stats screen is lazy-loaded. The chart library no longer loads on first visit.
- Main route chunk: **617 kB → 141 kB** (minified); the "chunk larger than 500 kB" build warning is gone.

## Code health
- Fixed all 3 ESLint errors and 8 unused-variable warnings. The remaining 15 warnings are React hook-dependency / fast-refresh notices that were left alone on purpose, because "fixing" them can change effect timing.
- Removed the unused `src/lib/multiplayer/` WebRTC module (it called an `/api/rtc` route that does not exist and nothing imported it).

## Verification
- `npm ci` from a clean directory ✔
- `npm run typecheck` ✔
- `npm run test:training` — 167/167 ✔ (was 162; +5 new)
- `npm test` — 262/262 ✔
- `npm run build` ✔
- Browser check (desktop + 390 px mobile): home, sparkline, stats, market view and the AI button all render with no app console errors and no horizontal overflow.
