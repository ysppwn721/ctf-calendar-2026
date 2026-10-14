# CTF 赛事日历 2026

2026 年全年 CTF 与网络安全竞赛日历。一个零依赖的静态站点，支持**关键词检索**、**时间段检索**、**报名/比赛时间四栏展示**与**实时状态判定**（报名中 / 报名已截止 / 未开始 / 进行中 / 已结束 / 时间待定）。

## 在线访问

| 入口 | 地址 |
| --- | --- |
| Cloudflare Pages（主） | <https://ctf-calendar-2026.pages.dev/> |
| GitHub Pages（备） | <https://ysppwn721.github.io/ctf-calendar-2026/> |

收录 **338** 场赛事：大学生竞赛类 144 场、国内技术性赛事 18 场、国际赛事 176 场。

---

## 功能

| 功能 | 说明 |
| --- | --- |
| 关键词检索 | 匹配赛事名称、英文名、别名、主办方、地区、赛制、分类、备注。支持 `空格`=AND、`\|`=OR、`"短语"`=精确、`-词`=排除 |
| 时间段检索 | 任选「比赛时间 / 报名时间 / 任意」维度，指定起止日期。支持**有交集**与**完全包含**两种匹配语义 |
| 状态判定 | 基于浏览器当前时间实时计算，时间轴变化即时反映，无需重新拉数据 |
| 时区切换 | 一键在**北京时间 / UTC / 本机时区**之间切换。日期筛选按所选时区的自然日解释 |
| 快捷筛选 | 今天 / 未来 7 天 / 未来 30 天 / 全年 |
| 导出 | CSV（含报名字段可信度列）与 ICS 日历（含比赛事件与报名截止提醒） |
| 可分享链接 | 所有筛选条件同步到 URL query，复制链接即可复现同一视图 |
| 界面 | 暗/亮主题、月份分组、响应式（移动端可用）、打印友好 |

状态优先级：`已结束` > `进行中` > `时间待定` > `报名中` > `报名已截止` > `未开始`。

---

## 数据来源

| 来源 | 覆盖 | 说明 |
| --- | --- | --- |
| [CTFtime](https://ctftime.org) 公开 API `/api/v1/events/` | 国际赛事、线上公开赛 | 按月分片抓取，已做覆盖度校验（见下） |
| 各赛事官方通知 / 主办方公告 | 中国大学生竞赛、国内技术性赛事 | 人工调研 + 原文核验，逐条附来源 URL 与原文摘录 |

### 采集窗口

收录范围为**赛程与 2026 自然年有交集**的赛事（多阶段赛事常跨年，例如某赛事线上初赛在 2025-12、总决赛在 2026-08）。CTFtime 原始抓取留有边界缓冲（2025-12 ~ 2027-01）以正确处理跨年赛事。

### 覆盖度校验

CTFtime API 的 `limit` 上限为 100。为避免"某月赛事超过上限被静默截断"，`scripts/verify-coverage.mjs` 会把月度查询再切成 4 个子区间重抓并比对去重结果。实测 2026 年 1/6/7/10 月**零遗漏**，月度分片即完整集合。

---

## 关于「报名时间」的诚实说明（重要）

CTFtime **不提供报名字段**。对全部 325 条原始记录做文本分析后：仅 70 条描述提及报名，其中只有 13 条含可识别日期。

因此本项目把报名时间分成**三档可信度**，并在界面上显著区分，绝不把推定值伪装成事实：

| 档位 | 界面标识 | 含义 | 当前条数 |
| --- | --- | --- | --- |
| `stated` | 绿色「官方明确」 | 从赛事描述原文或官方通知中抽取到明确日期，附原文片段为证 | 28 |
| `derived` | 紫色「推定」 | 官方未公布报名时间，按 **「CTF 平台惯例：报名通道开放至开赛时刻」** 推定。仅作参考，务必以官网为准 | 306 |
| `unknown` | 红色「未知」 | 连比赛时间都未知，无从推定 | 4 |

- `开始报名` 一栏**只在 `stated` 档出现**，其余一律显示「待定」——不做任何推测。
- 界面上的 `推定` 标记带 tooltip 说明；CSV 导出的「报名依据」列同样标注。
- 每条赛事在「详情」中附**来源链接**与**原文摘录**，可直接核实。

### 抽取器的精度防线

从自由文本里抽日期最常见的失败模式，是把**赛程表、现场签到时段、申请链接**误当成报名窗口。抽取器针对性地设了多道关卡，并有回归测试锁定：

1. 中文关键词不被 `\b` 包裹（中文字符不属于 `\w`，否则永不匹配）
2. 方向判定取「离日期最近的方向词」——`is OPEN through Sept 30` 判为截止，`registrations open: May 02` 判为开始
3. 子句内出现 ≥3 个日期 → 判定为赛程表，整条跳过
4. 区间必须紧跟在报名关键词之后（≤45 字符）
5. 关键词与日期之间夹着 URL → 判为申请链接，跳过
6. 两个日期之间含具体时刻 → 那是赛程条目，不是日期区间
7. **合理性关卡**：报名截止晚于比赛结束 → 判定误抽取，退回推定档（宁可保守，不放行可疑值）

以上每一条都由 `scripts/test-registration.mjs` 中的真实案例覆盖。

---

## 本地运行

站点是纯静态文件，但需要经 HTTP 访问（`fetch` 不能读 `file://`）：

```bash
node scripts/serve.mjs 8123
# 打开 http://127.0.0.1:8123/
```

## 重新生成数据

```bash
node scripts/fetch-ctftime.mjs     # 抓取 CTFtime 原始数据 → data/raw/
node scripts/verify-coverage.mjs   # 覆盖度校验（抽查若干月份）
node scripts/normalize.mjs         # 归一化 + 报名抽取 → data/events.json
```

## 测试

```bash
node scripts/test-registration.mjs  # 报名抽取器回归（17 例，取自真实赛事描述）
node scripts/test-core.mjs          # 核心逻辑回归（状态/搜索/时间段/时区/数据集完整性）
```

`scripts/test-core.mjs` 直接 `require('../assets/core.js')`——**跑的就是网页加载的那一份实现**，不存在"测的与跑的不是同一份"的问题。

---

## 项目结构

```
index.html                  页面骨架
assets/core.js              纯逻辑：时区、状态判定、检索、时间段匹配、排序（浏览器与 Node 共用）
assets/app.js               界面层：渲染、交互、导出
assets/styles.css           样式（暗/亮主题）
data/events.json            站点数据（归一化产物，含 stats）
data/raw/                   CTFtime 原始抓取与抓取报告
data/research/              人工调研的国内赛事数据（含来源与原文摘录）
scripts/fetch-ctftime.mjs   采集器
scripts/verify-coverage.mjs 覆盖度校验
scripts/normalize.mjs       归一化管道
scripts/lib/registration.mjs 报名时间抽取器
scripts/test-*.mjs          回归测试
scripts/serve.mjs           本地静态服务器
```

## 数据模型

```jsonc
{
  "id": "ctftime-3440",
  "title": "FortID CTF 2026",
  "category": "college | domestic-technical | international-technical",
  "region": "中国",
  "organizer": "TBTL",
  "format": "Jeopardy",
  "officialUrl": "https://ctf.fortid.com/",
  "registrationStart": "2026-06-03T00:00:00+00:00",  // null = 未知
  "registrationEnd":   "2026-08-30T23:59:00+00:00",
  "registrationBasis": "stated | derived | unknown",
  "contestStart": "2026-12-01T15:14:00+00:00",
  "contestEnd":   "2026-12-03T15:14:00+00:00",
  "registrationNote": "自赛事描述抽取原文：…",
  "confidence": "high | medium | low",
  "sources": ["https://ctftime.org/event/3440"],
  "evidence": "原文摘录…"
}
```

时间一律存为**带时区的 ISO 8601 绝对时刻**，展示时再按所选时区渲染——因此不存在"存的时区变了导致日期错位"的问题。

---

## 部署

站点为纯静态产物，`scripts/build-site.mjs` 会把运行时真正需要的文件组装到 `dist/`（不含脚本与原始数据）：

```bash
node scripts/build-site.mjs                              # 组装 dist/
npx wrangler pages deploy dist --project-name=ctf-calendar-2026 --branch=main
```

- **Cloudflare Pages**：`ctf-calendar-2026` 项目，生产分支 `main`，全球 CDN 边缘分发
- **GitHub Pages**：仓库 `main` 分支根目录直接托管

两处同源同内容，互为备份。

---

## 免责声明

赛事时间以主办方最终通知为准。本项目的 `derived` 档报名时间与任何标注「推定」的内容均为惯例推断，**不构成事实**。若发现数据有误，欢迎提 Issue 并附官方来源链接。
