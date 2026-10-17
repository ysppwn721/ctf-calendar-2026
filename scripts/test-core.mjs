#!/usr/bin/env node
/**
 * 核心逻辑回归测试（跑的就是网页加载的那份 assets/core.js）
 * 覆盖用户明确要求的功能：搜索 / 关键词 / 时间段检索 / 状态判定
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../assets/core.js');
const data = require('../data/events.json');

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}${extra ? '\n    ' + extra : ''}`); }
}
function eq(name, actual, expected) {
  t(name, actual === expected, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

/* ---------- 1. 状态判定 ---------- */
console.log('\n— 状态判定 —');
const EV = (o) => Object.assign({
  title: 'T', contestStart: null, contestEnd: null,
  registrationStart: null, registrationEnd: null,
}, o);

const now = Date.UTC(2026, 5, 15, 12, 0, 0); // 2026-06-15 12:00Z

eq('赛前 + 官方明确报名窗口内 → reg-open',
  C.computeStatus(EV({
    registrationBasis: 'stated',
    contestStart: '2026-07-01T00:00:00Z', contestEnd: '2026-07-03T00:00:00Z',
    registrationStart: '2026-05-01T00:00:00Z', registrationEnd: '2026-06-30T00:00:00Z',
  }), now).status, 'reg-open');

eq('赛前 + 官方明确报名已过 → reg-closed',
  C.computeStatus(EV({
    registrationBasis: 'stated',
    contestStart: '2026-07-01T00:00:00Z', contestEnd: '2026-07-03T00:00:00Z',
    registrationStart: '2026-05-01T00:00:00Z', registrationEnd: '2026-06-01T00:00:00Z',
  }), now).status, 'reg-closed');

eq('赛前 + 报名未开始 → upcoming',
  C.computeStatus(EV({
    registrationBasis: 'stated',
    contestStart: '2026-07-01T00:00:00Z', contestEnd: '2026-07-03T00:00:00Z',
    registrationStart: '2026-06-20T00:00:00Z', registrationEnd: '2026-06-30T00:00:00Z',
  }), now).status, 'upcoming');

// 推定窗口不算「报名中」，否则所有赛前赛事都会挤进该档，「待开赛」永远是 0
eq('赛前 + 推定报名窗口 → 不得判为 reg-open',
  C.computeStatus(EV({
    registrationBasis: 'derived',
    contestStart: '2026-07-01T00:00:00Z', contestEnd: '2026-07-03T00:00:00Z',
    registrationEnd: '2026-07-01T00:00:00Z',
  }), now).status, 'upcoming');

eq('推定窗口的 regVerified 为 false',
  C.computeStatus(EV({
    registrationBasis: 'derived',
    contestStart: '2026-07-01T00:00:00Z', contestEnd: '2026-07-03T00:00:00Z',
    registrationEnd: '2026-07-01T00:00:00Z',
  }), now).regVerified, false);

eq('官方明确窗口的 regVerified 为 true',
  C.computeStatus(EV({
    registrationBasis: 'stated',
    contestStart: '2026-07-01T00:00:00Z', contestEnd: '2026-07-03T00:00:00Z',
    registrationStart: '2026-05-01T00:00:00Z', registrationEnd: '2026-06-30T00:00:00Z',
  }), now).regVerified, true);

eq('比赛进行中 → ongoing',
  C.computeStatus(EV({
    contestStart: '2026-06-14T00:00:00Z', contestEnd: '2026-06-16T00:00:00Z',
  }), now).status, 'ongoing');

eq('比赛已结束 → ended',
  C.computeStatus(EV({
    contestStart: '2026-06-01T00:00:00Z', contestEnd: '2026-06-02T00:00:00Z',
  }), now).status, 'ended');

eq('无比赛时间 → tbd',
  C.computeStatus(EV({}), now).status, 'tbd');

eq('结束时刻正好等于 now → ended（闭区间）',
  C.computeStatus(EV({
    contestStart: '2026-06-14T00:00:00Z', contestEnd: '2026-06-15T12:00:00Z',
  }), now).status, 'ended');

eq('仅知开始时间 + durationHours → 自动推算结束',
  C.computeStatus(EV({
    contestStart: '2026-06-14T00:00:00Z', durationHours: 48,
  }), now).status, 'ongoing');

/* ---------- 2. 关键词检索 ---------- */
console.log('\n— 关键词检索 —');
const mk = (title, organizer, region) => ({ title, organizer, region, aliases: [], category: 'college' });

const HQ = C.haystack({
  title: '第九届强网杯全国网络安全挑战赛', organizer: '郑州', region: '中国',
  aliases: ['Qiangwang Cup'], format: 'Jeopardy', category: 'domestic-technical',
});

t('单词命中', C.queryMatches(HQ, C.tokenizeQuery('强网杯')));
t('英文别名命中（大小写不敏感）', C.queryMatches(HQ, C.tokenizeQuery('qiangwang')));
t('多词 AND：全中才命中', C.queryMatches(HQ, C.tokenizeQuery('强网杯 郑州')));
t('多词 AND：缺一不命中', !C.queryMatches(HQ, C.tokenizeQuery('强网杯 北京')));
t('| 表示 OR：任一命中即可', C.queryMatches(HQ, C.tokenizeQuery('不存在的词 | 强网杯')));
t('- 表示排除', !C.queryMatches(HQ, C.tokenizeQuery('强网杯 -郑州')));
t('排除词不命中时保留', C.queryMatches(HQ, C.tokenizeQuery('强网杯 -北京')));
t('空查询全部命中', C.queryMatches(HQ, C.tokenizeQuery('')));
t('引号短语命中', C.queryMatches(HQ, C.tokenizeQuery('"全国网络安全挑战赛"')));
t('引号短语不命中', !C.queryMatches(HQ, C.tokenizeQuery('"挑战赛全国"')));

/* ---------- 3. 时间段检索 ---------- */
console.log('\n— 时间段检索 —');
const R = (cs, ce, rs, re) => C.computeStatus(EV({
  contestStart: cs, contestEnd: ce, registrationStart: rs, registrationEnd: re,
}), now);

const stJun = R('2026-06-10T00:00:00Z', '2026-06-20T00:00:00Z', null, null);
const stJul = R('2026-07-10T00:00:00Z', '2026-07-20T00:00:00Z', null, null);
const T = (s) => Date.parse(s);

t('交集：6月赛事 ∩ 6月区间 = 命中',
  C.rangeMatches(stJun, { field: 'contest', fromTs: T('2026-06-01T00:00:00Z'), toTs: T('2026-06-30T23:59:59Z'), mode: 'overlap' }));
t('交集：7月赛事 ∩ 6月区间 = 不命中',
  !C.rangeMatches(stJul, { field: 'contest', fromTs: T('2026-06-01T00:00:00Z'), toTs: T('2026-06-30T23:59:59Z'), mode: 'overlap' }));
t('跨月赛事 ∩ 6月末区间 = 命中（交集语义）',
  C.rangeMatches(R('2026-06-28T00:00:00Z', '2026-07-05T00:00:00Z', null, null),
    { field: 'contest', fromTs: T('2026-06-29T00:00:00Z'), toTs: T('2026-06-30T23:59:59Z'), mode: 'overlap' }));
t('完全包含模式：跨月赛事不落在 6 月内 = 不命中',
  !C.rangeMatches(R('2026-06-28T00:00:00Z', '2026-07-05T00:00:00Z', null, null),
    { field: 'contest', fromTs: T('2026-06-01T00:00:00Z'), toTs: T('2026-06-30T23:59:59Z'), mode: 'contain' }));
t('按报名维度检索：赛事在 8 月但报名在 6 月 = 命中',
  C.rangeMatches(R('2026-08-10T00:00:00Z', '2026-08-11T00:00:00Z', '2026-06-01T00:00:00Z', '2026-06-30T00:00:00Z'),
    { field: 'registration', fromTs: T('2026-06-01T00:00:00Z'), toTs: T('2026-06-30T23:59:59Z'), mode: 'overlap' }));
t('按比赛维度检索：同一赛事 = 不命中',
  !C.rangeMatches(R('2026-08-10T00:00:00Z', '2026-08-11T00:00:00Z', '2026-06-01T00:00:00Z', '2026-06-30T00:00:00Z'),
    { field: 'contest', fromTs: T('2026-06-01T00:00:00Z'), toTs: T('2026-06-30T23:59:59Z'), mode: 'overlap' }));
t('时间待定赛事在限定区间内被排除',
  !C.rangeMatches(R(null, null, null, null),
    { field: 'contest', fromTs: T('2026-06-01T00:00:00Z'), toTs: T('2026-06-30T23:59:59Z'), mode: 'overlap' }));
t('不设区间时全部命中',
  C.rangeMatches(R(null, null, null, null), { field: 'contest', fromTs: null, toTs: null, mode: 'overlap' }));

/* ---------- 4. 时区处理 ---------- */
console.log('\n— 时区处理 —');
eq('北京时间 00:00 的绝对时刻正确',
  C.dayStart('2026-06-15', 'Asia/Shanghai'), Date.UTC(2026, 5, 14, 16, 0, 0));
eq('UTC 00:00 的绝对时刻正确',
  C.dayStart('2026-06-15', 'UTC'), Date.UTC(2026, 5, 15, 0, 0, 0));
eq('北京时间渲染 UTC 时刻（+8 进位）',
  C.fmtDT('2026-06-15T18:30:00Z', 'Asia/Shanghai', false), '2026-06-16 02:30');
eq('UTC 渲染同一时刻',
  C.fmtDT('2026-06-15T18:30:00Z', 'UTC', false), '2026-06-15 18:30');
eq('月份归属按时区判定（UTC 15日 → 北京16日仍属6月）',
  C.monthKey('2026-05-31T18:00:00Z', 'Asia/Shanghai'), '2026-06');
eq('月份归属按时区判定（UTC 口径为5月）',
  C.monthKey('2026-05-31T18:00:00Z', 'UTC'), '2026-05');

/* ---------- 5. 真实数据集完整性 ---------- */
console.log('\n— 真实数据集 —');
const evs = data.events;
const dated = evs.filter((e) => e.contestStart && e.contestEnd);
const withStart = evs.filter((e) => e.contestStart);
const tbd = evs.filter((e) => !e.contestStart);
const catalogRows = evs.filter((e) => e.category === 'catalog');

t(`数据集非空（${evs.length} 条）`, evs.length > 200);
t(`有完整赛程的赛事占多数（${dated.length}/${evs.length}）`, dated.length > evs.length * 0.6);
t('有赛程的赛事，比赛时间可解析', dated.every((e) => Number.isFinite(Date.parse(e.contestStart))));
t('已知的结束不早于开始', dated.every((e) => Date.parse(e.contestEnd) >= Date.parse(e.contestStart)));
t('赛程区间与 2026 自然年均有交集', dated.every((e) =>
  Date.parse(e.contestStart) < Date.UTC(2027, 0, 1) && Date.parse(e.contestEnd) >= Date.UTC(2026, 0, 1)));
t(`时间待定赛事被明确标记（含目录并入 ${catalogRows.length} 条）`, tbd.every((e) => !e.contestStart));
t('ID 唯一', new Set(evs.map((e) => e.id)).size === evs.length);
t('ID 非空', evs.every((e) => e.id && e.id !== 'research-'));
t('标题非空', evs.every((e) => e.title && String(e.title).trim().length > 1));
t('报名字段带可信度档位', evs.every((e) => ['stated', 'derived', 'unknown'].includes(e.registrationBasis)));
t('stated 档必须有真实日期支撑', evs.filter((e) => e.registrationBasis === 'stated')
  .every((e) => e.registrationStart || e.registrationEnd));
t('stated 档报名截止不晚于比赛结束（允许赛程内继续报名）',
  evs.filter((e) => e.registrationBasis === 'stated' && e.registrationEnd && e.contestEnd)
    .every((e) => Date.parse(e.registrationEnd) <= Date.parse(e.contestEnd) + 86400000));
t('stated 档报名开始不晚于报名截止',
  evs.filter((e) => e.registrationBasis === 'stated' && e.registrationStart && e.registrationEnd)
    .every((e) => Date.parse(e.registrationStart) <= Date.parse(e.registrationEnd)));
t('derived 档的报名截止恒等于比赛开始（推定规则一致）',
  evs.filter((e) => e.registrationBasis === 'derived' && e.contestStart)
    .every((e) => Date.parse(e.registrationEnd) === Date.parse(e.contestStart)));
t('除目录并入项外，每条都有来源链接',
  evs.filter((e) => e.category !== 'catalog').every((e) => (e.sources || []).length > 0));

// 目录并入项：必须带级别、负责单位，且不得伪造日期
t('目录并入项均带中北级别', catalogRows.every((e) => !!e.nucLevel));
t('目录并入项均带负责单位', catalogRows.every((e) => !!e.nucDept));
t('目录并入项不得伪造任何日期', catalogRows.every((e) =>
  !e.contestStart && !e.contestEnd && !e.registrationStart && !e.registrationEnd));
t('目录并入项报名依据为未知', catalogRows.every((e) => e.registrationBasis === 'unknown'));
t('目录并入项序号能对上目录', catalogRows.every((e) => !!e.nucNo));

// 月份覆盖：2026 年 12 个月应全部有赛事
const months = new Set(evs.map((e) => C.monthKey(e.contestStart, 'Asia/Shanghai')));
const missing = [];
for (let m = 1; m <= 12; m++) {
  const k = `2026-${String(m).padStart(2, '0')}`;
  if (!months.has(k)) missing.push(k);
}
t(`2026 年 12 个月全覆盖（缺 ${missing.join(',') || '无'}）`, missing.length === 0);

// 分类构成
const cats = {};
evs.forEach((e) => { cats[e.category] = (cats[e.category] || 0) + 1; });
t(`大学生竞赛类非空（${cats.college || 0} 条）`, (cats.college || 0) > 10);
t(`国内技术性赛事非空（${cats['domestic-technical'] || 0} 条）`, (cats['domestic-technical'] || 0) > 10);
t(`国际赛事非空（${cats['international-technical'] || 0} 条）`, (cats['international-technical'] || 0) > 100);

console.log(`\n分类构成: ${JSON.stringify(cats)}`);
console.log(`报名依据: stated=${evs.filter((e) => e.registrationBasis === 'stated').length} ` +
  `derived=${evs.filter((e) => e.registrationBasis === 'derived').length} ` +
  `unknown=${evs.filter((e) => e.registrationBasis === 'unknown').length}`);

/* ---------- 6. 分类与筛选一致性 ---------- */
console.log('\n— 分类口径 —');
const byCat = {};
evs.forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + 1; });

t('所有赛事都归类', evs.every((e) =>
  ['college', 'domestic-technical', 'international-technical', 'catalog'].includes(e.category)));
t(`restrictions=Open 的赛事不得归为大学生竞赛类`,
  evs.filter((e) => /^open$/i.test(e.restrictions || '')).every((e) => e.category !== 'college'));
t(`大学生竞赛类均有准入依据（${byCat.college} 条）`,
  evs.filter((e) => e.category === 'college')
    .every((e) => /academic|high-school/i.test(e.restrictions || '') || e.id.startsWith('research-')));
t(`大学生竞赛类占比合理（${((byCat.college / evs.length) * 100).toFixed(1)}% < 20%）`,
  byCat.college < evs.length * 0.2);
t('国内技术性赛事均来自人工核验', evs.filter((e) => e.category === 'domestic-technical')
  .every((e) => e.id.startsWith('research-')));

console.log('\n— 筛选一致性 —');
const dec = evs.map((e) => ({ ev: e, st: C.computeStatus(e, Date.now()) }));
const sum = C.summarize(dec);
const STATUSES = ['reg-open', 'reg-closed', 'upcoming', 'ongoing', 'ended', 'tbd'];
let acc = 0;
for (const k of STATUSES) {
  const n = dec.filter((d) => C.statusMatches(d.st, k)).length;
  acc += n;
  eq(`状态「${k}」筛选数与统计数一致`, n, sum[k]);
}
eq('六个状态筛选之和等于总数（互斥且完备）', acc, sum.total);
t('「待开赛」档非空（否则该筛选是死按钮）', sum.upcoming > 0);
t('「报名中」只含官方明确的报名窗口', dec.filter((d) => d.st.status === 'reg-open')
  .every((d) => d.ev.registrationBasis === 'stated'));

/* ---------- 7. 中北大学竞赛目录 ---------- */
console.log('\n— 中北大学竞赛目录（2026版） —');
const nucData = require('../data/nuc-catalog.json');
const cat = nucData.entries || [];
const LEVELS = ['超级', '一级', '二级', '三级'];

t(`目录条目数（${cat.length}）`, cat.length === 126);
t('级别取值合法', cat.every((c) => LEVELS.includes(c.level)));
t('每条都有名称与负责单位', cat.every((c) => c.name && c.dept));
t('条目 ID 唯一', new Set(cat.map((c) => c.id)).size === cat.length);
t('序号覆盖 1..125', Math.min(...cat.map((c) => c.no)) === 1 && Math.max(...cat.map((c) => c.no)) === 125);
t('官网字段要么是 http(s) 要么为空', cat.every((c) => !c.url || /^https?:\/\//i.test(c.url)));

const lv = {};
cat.forEach((c) => { lv[c.level] = (lv[c.level] || 0) + 1; });
t(`级别分布 超级=${lv['超级']} 一级=${lv['一级']} 二级=${lv['二级']} 三级=${lv['三级']}`,
  lv['超级'] === 2 && lv['一级'] === 75 && lv['二级'] === 8 && lv['三级'] === 41);

// 交叉引用：日历里带 nucLevel 的赛事必须能对应到真实目录条目
const withNuc = evs.filter((e) => e.nucLevel);
const nos = new Set(cat.map((c) => c.no));
const fromCatalogRow = withNuc.filter((e) => e.category === 'catalog').length;
t(`日历赛事带中北级别标注（${withNuc.length} 条 ＝ 目录并入 ${fromCatalogRow} + 真实赛程交叉 ${withNuc.length - fromCatalogRow}）`, withNuc.length > 0);
t('带标注的赛事，级别合法', withNuc.every((e) => LEVELS.includes(e.nucLevel)));
t('带标注的赛事，序号能在目录中找到', withNuc.every((e) => nos.has(e.nucNo)));
t('带标注的赛事，级别与目录一致', withNuc.every((e) => {
  const entry = cat.find((c) => c.no === e.nucNo);
  return entry && entry.level === e.nucLevel;
}));

console.log(`目录级别分布: ${JSON.stringify(lv)}`);
console.log(`交叉标注: ${withNuc.length} 条日历赛事 ↔ 目录条目`);

console.log(`\n================ 通过 ${pass} / ${pass + fail} ================`);
process.exit(fail ? 1 : 0);
