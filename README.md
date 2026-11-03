# DriveTrade · 交易纪律助手

交易记录、铁律与加密货币模拟训练。界面沿用 Grok 的蓝黑配色与文字动效，核心操作为选金额、买入、观察与卖出。

## 功能

- 原交易账本、铁律管理、统计与资金曲线。
- 持续生成的多币种、多链模拟市场，包含不同币龄、发射平台及 BTC/ETH 等模拟彩蛋。
- K线/折线、持仓入场线与浮动盈亏、统一虚拟账户、交易记录和自动复盘。
- 12项交易实操与24场模拟交易考核；课程与知识题为选做。
- 本地保存、完整备份恢复和旧版记录兼容。完整导出包含当前新增的交易铁律。
- 可选的服务端 xAI 摘要解释；AI不参与交易判分或毕业。

所有行情、资产与交易均为模拟，不连接真实钱包或执行实盘下单。模拟毕业不代表现实盈利保证。

## 运行

建议使用 Node.js 24。

```sh
npm ci
npm run dev
```

开发默认端口为8080；需要覆盖时：

```sh
npm run dev -- --port 8090
```

```sh
npm run typecheck
npm run test:training
npm test
npm run build
npm run preview
```

启动、构建与预览均保留原 `scripts/with-app-env.mjs` 包装器。`.grok/app-env.json` 默认关闭登录与外部数据库，本地训练不需要配置密钥。浏览器存储按来源隔离；更换端口、主机名或设备前请使用完整备份迁移。

## 服务端配置

通过运行环境或部署平台的私密环境变量提供凭据，不要把密钥提交到Git，也不要使用 `VITE_` 前缀暴露密钥。

| 变量 | 用途 |
| --- | --- |
| `XAI_API_KEY` | 可选AI解释；未配置时使用本地规则复盘 |
| `XAI_TRAINING_MODEL` | 可选训练解释模型 |
| `DATABASE_URL` | 可选外部数据库；本地训练不依赖它 |
| `GROK_AUTH_CLIENT_ID`、`GROK_AUTH_CLIENT_SECRET` | 启用登录时使用的部署OAuth凭据 |
| `GROK_PREVIEW_CLIENT_SECRET` | 使用Grok共享预览登录时，由服务端环境提供 |

启用登录必须配置有效凭据；缺失时拒绝启动登录服务，不回退成已登录的开发用户。原部署注入的 `GROK_AUTH_*` 优先级保留。

## 项目结构

```text
src/components/discipline/   原账本与铁律界面
src/components/academy/      实操、课程、考核与记录
src/components/market-world/ 市场、图表、买卖、账户与复盘
src/lib/training-lab/        可重放的教学实操引擎
src/lib/world/               随机市场、交易、资金、判分与存档
src/lib/academy/             课程、评分、进度与备份校验
src/workers/                市场计算Worker
scripts/                    启动包装器、检查、测试与模型审计
public/                     静态资源、平台资源与第三方许可证
```

Grok启动、PWA品牌/安装及Vercel配置保留。图表依赖与许可证见 `public/licenses/`。本地依赖、构建产物、测试截图、备份和凭据不纳入仓库。
