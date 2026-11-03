export type Dimension = "risk" | "execution" | "review";
export type ScenarioTask = {
  id: string;
  dimension: Dimension;
  weight: number;
  prompt: string;
  options?: string[];
  answer?: number;
  numberAnswer?: number;
  explanation: string;
};
export type Scenario = {
  id: string;
  title: string;
  summary: string;
  lessonId: string;
  chain: string;
  equity: number;
  reserve: number;
  budgetPct: number;
  facts: string[];
  tasks: ScenarioTask[];
  formal: boolean;
};
type Spec = {
  title: string;
  summary: string;
  lessonId: string;
  chain: string;
  facts: string[];
  risk: [string, string[], number, string];
  decision: [string, string[], number, string];
  fact: [string, string[], number, string];
  cause: [string, string[], number, string];
  correction: [string, string[], number, string];
};
const specs: Spec[] = [
  {
    title: "同名项目",
    summary: "名字和图标一样，资产却不同。",
    lessonId: "lesson-4",
    chain: "Solana / Base",
    facts: [
      "关注列表里是 Solana 的 SIM-A01。",
      "详情卡是 Base 的 SIM-B01，名字与图标相同。",
      "尚未确认两者有任何发行关系。",
    ],
    risk: [
      "现在能确认两者是什么关系？",
      ["同一资产", "不同资产，关系未知", "一定是官方跨链版本"],
      1,
      "同名不等于同链同地址。",
    ],
    decision: [
      "你原计划只交易 SIM-A01，此时应怎样处理？",
      ["购买 SIM-B01，因为名字一致", "停止提交，重新核对链和地址", "直接桥钱过去"],
      1,
      "当前标的与冻结条件不一致，应先核对。",
    ],
    fact: [
      "本次已知事实是？",
      ["两个地址不同", "项目肯定会涨", "Base 项目一定骗人"],
      0,
      "地址不同是已知事实，质量与涨跌尚未知。",
    ],
    cause: [
      "误买风险主要来自？",
      ["名称被当作唯一身份", "SOL 的价格", "等待太久"],
      0,
      "应核对链和合约，而不是凭外观。",
    ],
    correction: [
      "下一次具体修改哪项流程？",
      ["提高投入", "每次确认前核对链和短地址", "只看头像更清楚的币"],
      1,
      "这是一项可验证的身份检查。",
    ],
  },
  {
    title: "gas 空了",
    summary: "余额有钱，卖出按钮却无法执行。",
    lessonId: "lesson-5",
    chain: "Base",
    facts: [
      "Base 钱包有 400 稳定资产和持仓。",
      "Base 原生 ETH 可用余额为零。",
      "Solana 钱包有 SOL，但不在 Base。",
    ],
    risk: [
      "当前最直接的执行约束是？",
      ["缺 Base ETH 链费", "缺其他币种名称", "一定是 rug"],
      0,
      "余额充足不能替代本地 gas。",
    ],
    decision: [
      "在市场变动前合理的准备是？",
      ["从 SOL 直接扣 Base gas", "准备 Base ETH 并保留退出费用", "无条件连续提交"],
      1,
      "要准备正确链的原生费用资产。",
    ],
    fact: [
      "哪项资产可直接支付本次 Base 费用？",
      ["Solana SOL", "Base ETH", "任意同名稳定币"],
      1,
      "gas 使用链的原生资产。",
    ],
    cause: [
      "该阻碍说明？",
      ["总权益足够就一定能卖", "链别余额与执行能力不同", "所有池都没有流动性"],
      1,
      "不要把账面总额等同于本地操作能力。",
    ],
    correction: [
      "可验证的改进是？",
      ["每链保留公示费用余量", "扩大滑点到任意值", "删除失败记录"],
      0,
      "建立本地 gas 预算与预警。",
    ],
  },
  {
    title: "曲线尾段",
    summary: "剩余容量不足，不能凭空补足买单。",
    lessonId: "lesson-8",
    chain: "Solana",
    facts: [
      "曲线已接近预设迁移阈值。",
      "本次报价输入超过剩余可售容量。",
      "旧曲线暂未完成迁移，目标池尚未开放。",
    ],
    risk: [
      "虚拟报价储备能补足本次真实交付吗？",
      ["可以，屏幕显示了储备", "不能，虚拟值只用于定价", "可以免费多发给用户"],
      1,
      "虚拟储备不是真实金库。",
    ],
    decision: [
      "订单提示容量超额，应怎样处理？",
      ["重复提交让它多迁一次", "减少数量重新确认，或等待迁移后核对新池", "让后台偷偷部分成交"],
      1,
      "修改订单要重新确认，迁移只能执行一次。",
    ],
    fact: [
      "迁池完成后可以直接推断？",
      ["一定上涨", "交易阶段改变", "风险消失"],
      1,
      "迁移不代表质量和安全。",
    ],
    cause: [
      "超额被拒绝的机制原因？",
      ["真实库存和容量约束", "用户运气差", "系统应该惩罚赚钱"],
      0,
      "不能以剧情突破金库约束。",
    ],
    correction: [
      "下一次要核对？",
      ["剩余容量、阶段和迁移规则", "只看倒计时", "看最高涨幅"],
      0,
      "检查真实交付与阶段。",
    ],
  },
  {
    title: "锁 LP 的大跌",
    summary: "锁住流动性，不代表持币者不能卖。",
    lessonId: "lesson-10",
    chain: "Solana",
    facts: [
      "平台对应的 LP 份额已锁定。",
      "某关联钱包持有大量可转让代币。",
      "该钱包连续正常卖出，储备和价格随成交改变。",
    ],
    risk: [
      "哪项解释与这些事实相容？",
      ["创建者撤走已锁的同一份 LP", "大户出售已有代币", "无 mint 权也凭空增发"],
      1,
      "锁 LP 不阻止持有者按交易规则卖出。",
    ],
    decision: [
      "已达到计划退出条件，你应？",
      ["因为锁 LP 继续忽视退出", "按可执行报价检查费用并提交减险", "给仓位加十倍"],
      1,
      "交易计划与退出条件仍需执行。",
    ],
    fact: [
      "现在能够确认的是？",
      ["大户通过交易卖出", "任何下跌都是 rug", "锁 LP 等于无风险"],
      0,
      "区分正常抛售与撤资攻击。",
    ],
    cause: [
      "先前判断遗漏了？",
      ["持币集中与卖出压力", "图标颜色", "卖单名称"],
      0,
      "权限只解释一类机制，还需看持仓。",
    ],
    correction: [
      "筛选时加入哪项？",
      ["关联簇可卖余额和退出容量", "只保留锁 LP 标签", "提高频率"],
      0,
      "分析真实供应和集中度。",
    ],
  },
  {
    title: "可撤的池子",
    summary: "权限存在时，撤资风险不能当普通波动。",
    lessonId: "lesson-12",
    chain: "BNB",
    facts: [
      "开放池模板允许 LP 持有人撤资。",
      "创建者持有大部分可撤 LP。",
      "当前卖出报价对你的数量已有明显冲击。",
    ],
    risk: [
      "最需要纳入预算的是？",
      ["可能撤资导致无法完整退出", "只会出现小幅止损", "名字带金色就安全"],
      0,
      "全损情形不能靠止损距离消除。",
    ],
    decision: [
      "方案要求退出容量足够，当前不满足，应？",
      ["降低标准先买再说", "放弃或继续观察，不确认这笔投入", "用最高价计算收益"],
      1,
      "条件未满足时可保持空仓。",
    ],
    fact: [
      "如果后来池深度消失，应怎样估值？",
      ["按最后高价全部卖出", "按实际可执行净回款，无法回收部分为零", "复制买单当卖单"],
      1,
      "不能用虚假成交美化净值。",
    ],
    cause: [
      "关键风险来源是？",
      ["可撤权限与集中控制", "不够快的手速", "没选最热的币名"],
      0,
      "风险需与实际能力和控制权对应。",
    ],
    correction: [
      "改进检查项是？",
      ["LP 控制、锁定状态、自己的退出报价", "只看市值", "把止损贴更近扩大仓位"],
      0,
      "三项共同帮助理解退出边界。",
    ],
  },
  {
    title: "卖出被限制",
    summary: "小额成功过，也不能保证以后一直可卖。",
    lessonId: "lesson-15",
    chain: "BNB",
    facts: ["该模板存在卖出限制能力。", "此前一笔小额测试成功。", "本次执行因当前权限状态回退。"],
    risk: [
      "自动止损能覆盖权限限制吗？",
      ["能强制解除限制", "不能，仍受执行条件约束", "会自动退款全部本金"],
      1,
      "应用侧规则不能改变代币权限。",
    ],
    decision: [
      "交易回退后应怎样记录？",
      ["伪造按止损价已卖出", "保留持仓与失败原因，核对已消耗费用", "删除失败交易"],
      1,
      "正确账本不能假设获得了回款。",
    ],
    fact: [
      "小额测试证明的是？",
      ["永远安全", "当时条件下的小额执行成功", "所有数量都可卖"],
      1,
      "结论仅对应当时数量和状态。",
    ],
    cause: [
      "为何退出未完成？",
      ["当前权限限制", "课程分数太低", "每次亏损都代表操作违规"],
      0,
      "区分机制限制与纪律行为。",
    ],
    correction: [
      "下一次仓位如何估计风险？",
      ["将无法退出的全损可能纳入投入预算", "只看止损距离", "只靠小额测试"],
      0,
      "投入必须能承受非连续退出风险。",
    ],
  },
  {
    title: "热闹的假信号",
    summary: "社交信息与真实回款不是同一指标。",
    lessonId: "lesson-16",
    chain: "Base",
    facts: [
      "社交消息数突然上涨。",
      "池真实深度没有相应增加。",
      "信息来源未经证实，关联买卖可能重复。",
    ],
    risk: [
      "可以从热度直接判断什么？",
      ["确定高质量金狗", "没有确定的盈利或退出保证", "必定诈骗"],
      1,
      "热度是带噪声的线索。",
    ],
    decision: [
      "你原定深度充足才考虑，现在应？",
      ["继续观察，不因热度放宽条件", "按消息数量加仓", "忽略费用"],
      0,
      "保持条件一致，不被热度替代证据。",
    ],
    fact: [
      "最能约束自己退出数量的是？",
      ["当前实际池储备", "转发次数", "名称长短"],
      0,
      "可执行回款依赖实际机制。",
    ],
    cause: [
      "最容易出现的偏差是？",
      ["把讨论当作接盘资金", "认为费用有成本", "核对信息来源"],
      0,
      "社交传播不是银行余额。",
    ],
    correction: [
      "应补哪个事实？",
      ["自己的数量下的退出净报价", "更多口号", "事后最高价"],
      0,
      "先检验执行和成本，再讨论机会。",
    ],
  },
  {
    title: "薄池高涨幅",
    summary: "自己抬起的边际价格，不是可兑现利润。",
    lessonId: "lesson-23",
    chain: "Solana",
    facts: [
      "一次小买单后屏幕价格大涨。",
      "池中报价资产仍有限。",
      "立即卖出全部数量将反向影响价格，并再付费用。",
    ],
    risk: [
      "可以按新边际价乘全部数量当净值吗？",
      ["可以", "不能，需要带冲击和费用的退出估值", "可以再把 gas 加回来"],
      1,
      "边际价不是整笔成交均价。",
    ],
    decision: [
      "计划要求成本后空间足够，此时报价不合算，应？",
      ["按真实净报价决定减险或等待，不宣称已赚到", "反复自买自卖印钱", "按最高价记盈利"],
      0,
      "按可执行结果决策与记账。",
    ],
    fact: [
      "没有外部新买盘时，自买自卖怎样？",
      ["必然无风险获利", "会受到反向冲击与费用", "供应会免费增加"],
      1,
      "不能从自己造成的价格变化凭空提款。",
    ],
    cause: [
      "高涨幅与低回款差异来自？",
      ["池深度和价格冲击", "币名不够好", "图表太小"],
      0,
      "小池对数量敏感。",
    ],
    correction: [
      "复盘时同时展示？",
      ["参考市值和预计净退出回款", "只有最高涨幅", "只有胜率"],
      0,
      "两个口径并列可防止误判。",
    ],
  },
  {
    title: "桥还在途中",
    summary: "不能把同一份资产花两次。",
    lessonId: "lesson-6",
    chain: "Solana → Base",
    facts: ["源链已锁定 200 稳定资产。", "目标链尚未确认到账。", "目标链还需要本地 ETH 支付费用。"],
    risk: [
      "在途资产可以计几次？",
      ["两次", "零次并删除", "一次，但尚不可支用"],
      2,
      "权益和可用资金不是同一个口径。",
    ],
    decision: [
      "目标链突然有热点，应？",
      ["用还未到账的钱提前提交", "等待有效到账并核对 gas，或放弃机会", "让两边都恢复可用"],
      1,
      "机会不能突破资金状态。",
    ],
    fact: [
      "源链确认后目标失败，正确处理是？",
      ["进入退款或恢复协议", "把源链历史和费用全部抹掉", "目标仍自动到账两份"],
      0,
      "两侧是不同交易，不能反向取消已发生事实。",
    ],
    cause: [
      "错过机会是否等于违规？",
      ["一定违规", "不等于，需要看计划和已知约束", "只要后来涨就算错"],
      1,
      "合理等待不能按未来涨幅定罪。",
    ],
    correction: [
      "下次需要提前安排？",
      ["链别余额、桥延迟和本地费用", "无上限优先费", "多开同一笔桥"],
      0,
      "可操作的准备比追逐最后一分钟更重要。",
    ],
  },
  {
    title: "拥堵与回退",
    summary: "执行失败和本地拒绝要分开。",
    lessonId: "lesson-14",
    chain: "Base",
    facts: [
      "命令已进入模拟链队列。",
      "执行时最终回款低于 minOut，交易回退。",
      "该链配置规定消耗的执行费用仍需支付。",
    ],
    risk: [
      "增加优先费是否保证成交？",
      ["保证", "不保证，只影响声明的调度倾向", "保证价格不变"],
      1,
      "优先费不是价格或顺序保险。",
    ],
    decision: [
      "回退后应怎样处理？",
      ["检查状态与费用，再决定是否用新条件确认", "疯狂重复点击同一意图", "偷偷降低原 minOut"],
      0,
      "先防重复，再作新的明确决定。",
    ],
    fact: [
      "回退的资产交换应？",
      ["完整回滚，链费按已消耗规则记录", "保持代币到账且退本金", "完全不记录"],
      0,
      "不能将资产与 gas 混成一个开关。",
    ],
    cause: [
      "执行价偏离原报价说明？",
      ["报价状态与执行状态有差异", "系统应直接送钱", "用户必须扩大仓位"],
      0,
      "队列期间市场可以变化。",
    ],
    correction: [
      "下一次要关注？",
      ["deadline、minOut、队列状态和费用", "只看成功动画", "最大化提交次数"],
      0,
      "观察可验证的执行边界。",
    ],
  },
  {
    title: "一起下跌",
    summary: "相关项目的合计风险才是问题。",
    lessonId: "lesson-3",
    chain: "多链",
    facts: [
      "三个名字不同的项目来自同一创建者资金簇。",
      "每个项目均有持仓，合计超出公示关联预算。",
      "共享叙事退潮，它们同时受到资金流出。",
    ],
    risk: [
      "应如何计算关联暴露？",
      ["分开名字便不关联", "按簇合并，待执行买单也计入", "只计盈利项目"],
      1,
      "独立名称不能分散共同控制与资金风险。",
    ],
    decision: [
      "当前已超出关联预算，合理动作是？",
      ["继续增加相同簇暴露", "检查可执行报价并优先减险", "忽略合计只看单笔"],
      1,
      "预算约束作用于组合，不仅每个按钮。",
    ],
    fact: [
      "同时下跌是否必定证明三个合约都 rug？",
      ["不能，需区分抛售、需求衰退与权限事件", "必定", "价格图就能证明攻击者"],
      0,
      "价格结果不能代替机制证据。",
    ],
    cause: [
      "先前预算缺陷是？",
      ["遗漏共同风险", "没换头像", "关注太少消息"],
      0,
      "合并审视关联持仓。",
    ],
    correction: [
      "下一轮保留哪项规则？",
      ["簇级预算并检查全部待执行风险", "只看币的数量", "只选最高涨幅"],
      0,
      "这是能从事件中复算的组合约束。",
    ],
  },
  {
    title: "连亏后的选择",
    summary: "不要用下一笔偿还上一笔的情绪。",
    lessonId: "lesson-22",
    chain: "多链",
    facts: [
      "已发生两笔按计划退出的亏损。",
      "账户触发当前模拟日停止新增风险线。",
      "市场仍不断产出新币，也有后来上涨的项目。",
    ],
    risk: [
      "此时公示的停止线要求？",
      ["禁止新增风险但允许减险", "必须马上回本", "买最热的币可例外"],
      0,
      "停止规则不能因为热点出现便失效。",
    ],
    decision: [
      "下一步选择？",
      ["十倍投入追偿", "等待、保留现有保护并复盘", "删掉两笔亏损重考"],
      1,
      "合规停手是有效行动。",
    ],
    fact: [
      "按计划亏损是否本身构成重大违规？",
      ["是", "不是，需看可控操作是否越界", "只有盈利才算合规"],
      1,
      "结果和纪律应分开评价。",
    ],
    cause: [
      "冲动加码主要改变什么？",
      ["必然提高胜率", "只改变名称", "增加风险，并不保证机会更好"],
      2,
      "亏损不会自动改善下一次条件。",
    ],
    correction: [
      "可验证的修正是？",
      ["遵守锁存停止窗口，复核风险与策略版本", "缩短止损来大幅放仓", "找一句看涨消息"],
      0,
      "先执行自己的边界，再研究变化。",
    ],
  },
];

function choice(
  id: string,
  dimension: Dimension,
  weight: number,
  s: [string, string[], number, string],
): ScenarioTask {
  return { id, dimension, weight, prompt: s[0], options: s[1], answer: s[2], explanation: s[3] };
}
export function makeScenario(index: number, formal = false): Scenario {
  const spec = specs[index % specs.length];
  const equity = formal ? 12000 + (index % 4) * 2000 : 10000;
  const reserve = formal ? 3 + (index % 3) : 2;
  const budgetPct = 1;
  return {
    id: `${formal ? "exam" : "practice"}-${index + 1}`,
    title: spec.title,
    summary: spec.summary,
    lessonId: spec.lessonId,
    chain: spec.chain,
    equity,
    reserve,
    budgetPct,
    facts: spec.facts,
    formal,
    tasks: [
      {
        id: "budget",
        dimension: "risk",
        weight: 60,
        prompt: `本场权益 ${equity.toLocaleString("zh-CN")}，单项目全损预算 ${budgetPct}%，预计必要费用 ${reserve}。最大本金投入是多少训练美元？`,
        numberAnswer: equity * 0.01 - reserve,
        explanation: `最大本金 = ${equity} × 1% − ${reserve} = ${equity * 0.01 - reserve}；止损不减少全损预算。`,
      },
      choice("risk", "risk", 40, spec.risk),
      choice("decision", "execution", 100, spec.decision),
      choice("fact", "review", 30, spec.fact),
      choice("cause", "review", 30, spec.cause),
      choice("correction", "review", 40, spec.correction),
    ],
  };
}
export const PRACTICE_SCENARIOS = specs.map((_, i) => makeScenario(i));
// Distinct changed numbers, no hints until a formal group is submitted.
export const FORMAL_SCENARIOS = [0, 2, 3, 5, 6, 8, 9, 11].map((i) => makeScenario(i + 12, true));
export type ScenarioAnswers = Record<string, number>;
export function gradeScenario(s: Scenario, answers: ScenarioAnswers) {
  const dimensions = { risk: 0, execution: 0, review: 0 };
  const totals = { risk: 0, execution: 0, review: 0 };
  const evidence = s.tasks.map((task) => {
    const response = answers[task.id];
    const answered = typeof response === "number" && Number.isFinite(response);
    const correct =
      answered &&
      (task.numberAnswer !== undefined
        ? Math.abs(response - task.numberAnswer) < 0.011
        : response === task.answer);
    totals[task.dimension] += task.weight;
    if (correct) dimensions[task.dimension] += task.weight;
    return {
      objectiveId: task.id,
      dimension: task.dimension,
      weight: task.weight,
      response: answered ? response : null,
      correct,
      explanation: task.explanation,
    };
  });
  for (const dimension of ["risk", "execution", "review"] as const)
    dimensions[dimension] = totals[dimension]
      ? (dimensions[dimension] / totals[dimension]) * 100
      : 0;
  return { ...dimensions, complete: evidence.every((e) => e.response !== null), evidence };
}
