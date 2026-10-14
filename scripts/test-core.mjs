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

eq('赛前 + 报名窗口内 → reg-open',
  C.computeStatus(EV({
    contestStart: '2026-07-01T00:00:00Z', contestEnd: '2026-07-03T00:00:00Z',
    registrationStart: '2026-05-01T00:00:00Z', registrationEnd: '2026-06-30T00:00:00Z',
  }), now).status, 'reg-open');

eq('赛前 + 报名已过 → reg-closed',
  C.computeStatus(EV({
    contestStart: '2026-07-01T00:00:00Z', contestEnd: '2026-07-03T00:00:00Z',
    registrationStart: '2026-05-01T00:00:00Z', registrationEnd: '2026-06-01T00:00:00Z',
  }), now).status, 'reg-closed');

eq('赛前 + 报名未开始 → upcoming',
  C.computeStatus(EV({
    contestStart: '2026-07-01T00:00:00Z', contestEnd: '2026-07-03T00:00:00Z',
    registrationStart: '2026-06-20T00:00:00Z', registrationEnd: '2026-06-30T00:00:00Z',
  }), now).status, 'upcoming');

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
t(`数据集非空（${evs.length} 条）`, evs.length > 200);
t('每条都有比赛开始时间', evs.every((e) => !!e.contestStart));
t('每条都有比赛结束时间', evs.every((e) => !!e.contestEnd));
t('结束不早于开始', evs.every((e) => Date.parse(e.contestEnd) >= Date.parse(e.contestStart)));
t('全部落在 2026 自然年', evs.every((e) => {
  const t0 = Date.parse(e.contestStart);
  return t0 >= Date.UTC(2026, 0, 1) && t0 < Date.UTC(2027, 0, 1);
}));
t('ID 唯一', new Set(evs.map((e) => e.id)).size === evs.length);
t('报名字段带可信度档位', evs.every((e) => ['stated', 'derived', 'unknown'].includes(e.registrationBasis)));
t('stated 档必须有真实日期支撑', evs.filter((e) => e.registrationBasis === 'stated')
  .every((e) => e.registrationStart || e.registrationEnd));

// 月份覆盖：应覆盖 12 个月
const months = new Set(evs.map((e) => C.monthKey(e.contestStart, 'Asia/Shanghai')));
t(`覆盖 12 个自然月（实际 ${months.size}）`, months.size === 12);

console.log(`\n================ 通过 ${pass} / ${pass + fail} ================`);
process.exit(fail ? 1 : 0);
