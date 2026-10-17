/* ============================================================
   CTF 赛事日历 — 核心逻辑（纯函数，无 DOM 依赖）
   浏览器与 Node 测试共用同一份实现，避免"测的不是跑的那份"。
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CTF_CORE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CATEGORY_LABEL = {
    'domestic-technical': '国内赛事',
    'international-technical': '国际赛事',
    catalog: '校内认定学科竞赛',
  };

  const CONF_LABEL = { high: '高可信', medium: '中可信', low: '待核实' };

  const REG_BASIS_LABEL = { stated: '官方明确', derived: '推定', unknown: '未知' };

  /* ---------------- 时区 ---------------- */
  function tzOffsetMs(date, tz) {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const map = {};
    for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
    const asUTC = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour % 24, +map.minute, +map.second);
    return asUTC - date.getTime();
  }

  function zonedToTs(y, mo, d, h, mi, s, tz) {
    const guess = Date.UTC(y, mo, d, h, mi, s);
    const off1 = tzOffsetMs(new Date(guess), tz);
    let t = guess - off1;
    const off2 = tzOffsetMs(new Date(t), tz);
    if (off2 !== off1) t = guess - off2;
    return t;
  }

  function dayStart(dateStr, tz) {
    if (!dateStr) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) return null;
    return zonedToTs(+m[1], +m[2] - 1, +m[3], 0, 0, 0, tz);
  }
  function dayEnd(dateStr, tz) {
    const s = dayStart(dateStr, tz);
    return s == null ? null : s + 86400000 - 1;
  }

  function toTs(iso) {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    return Number.isNaN(t) ? null : t;
  }

  function tzAbbr(tz, date) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
        .formatToParts(date);
      const t = parts.find((p) => p.type === 'timeZoneName');
      return t ? t.value.replace('GMT', 'UTC') : '';
    } catch { return ''; }
  }

  function fmtDT(iso, tz, withTz) {
    const t = toTs(iso);
    if (t == null) return null;
    const d = new Date(t);
    const s = new Intl.DateTimeFormat('zh-CN', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d).replace(/\//g, '-');
    if (!withTz) return s;
    const ab = tzAbbr(tz, d);
    return ab ? `${s} ${ab}` : s;
  }

  function fmtDay(iso, tz) {
    const t = toTs(iso);
    if (t == null) return null;
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(t)).replace(/\//g, '-');
  }

  function monthKey(iso, tz) {
    const t = toTs(iso);
    if (t == null) return 'zzz-tbd';
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' })
      .format(new Date(t)).slice(0, 7);
  }

  function human(ms) {
    if (ms < 0) ms = 0;
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    const mi = Math.floor((ms % 3600000) / 60000);
    if (d > 0) return `${d} 天 ${h} 小时`;
    if (h > 0) return `${h} 小时 ${mi} 分`;
    return `${mi} 分钟`;
  }

  /* ---------------- 状态判定 ----------------
     返回：
       status  —— 主状态，用于筛选与徽标
       contest —— 'ended' | 'ongoing' | 'upcoming' | 'tbd'
       reg     —— 'open' | 'closed' | 'notopen' | 'unknown'
  ------------------------------------------- */
  function computeStatus(ev, now) {
    const cs = toTs(ev.contestStart);
    let ce = toTs(ev.contestEnd);
    if (ce == null && cs != null && ev.durationHours) ce = cs + ev.durationHours * 3600000;
    const rs = toTs(ev.registrationStart);
    const re = toTs(ev.registrationEnd);

    let contest;
    if (cs == null && ce == null) contest = 'tbd';
    else if (ce != null && now >= ce) contest = 'ended';
    else if (cs != null && now >= cs) contest = 'ongoing';
    else if (cs != null) contest = 'upcoming';
    else contest = 'tbd';

    /* 报名状态。
       关键修正：比赛一旦结束，报名必然已关闭——不能因为「没有报名截止字段」
       就一路判成 open（曾经因此让已结束的赛事出现在「现在可报名」筛选里）。
       同理，已开赛且没有公布报名截止的，保守判为已关闭。 */
    let reg;
    if (ce != null && now >= ce) reg = 'closed';
    else if (re != null && now > re) reg = 'closed';
    else if (rs != null && now < rs) reg = 'notopen';
    else if (re != null && (rs == null || now >= rs)) reg = 'open';
    else if (rs != null && re == null && (cs == null || now < cs)) {
      // 没有公布报名截止：用开赛时刻兜底。若连赛程都没有，只在报名开放后 180 天内
      // 视为开放——否则一年前的报名入口会被永久标成「报名中」，属于误导。
      reg = (cs != null || (now - rs) <= 180 * 86400000) ? 'open' : 'unknown';
    }
    else if (cs != null && now >= cs && re == null) reg = 'closed';
    else reg = 'unknown';

    /* 主状态判定。
       注意「报名中」必须要求 registrationBasis === 'stated'：
       推定窗口（derived）在所有赛前赛事上都成立，若也算「报名中」，
       则「报名中」会虚高到几十条，而「待开赛」永远是 0 —— 筛选就废了。 */
    const regVerified = ev.registrationBasis === 'stated';
    let status;
    if (contest === 'ended') status = 'ended';
    else if (contest === 'ongoing') status = 'ongoing';
    else if (contest === 'tbd') status = 'tbd';
    else if (reg === 'open' && regVerified) status = 'reg-open';
    else if (reg === 'closed' && regVerified) status = 'reg-closed';
    else status = 'upcoming';

    return { status, contest, reg, regVerified, cs, ce, rs, re };
  }

  /* 主状态是互斥的六个取值，筛选必须直接按它判。
     曾经「未开始」按比赛维度（contest==='upcoming'）判，会与「报名中」重叠，
     导致各状态计数之和大于总数 —— 这是筛选口径不一致的根因。 */
  function statusMatches(st, filter) {
    if (!filter || filter === 'all') return true;
    return st.status === filter;
  }

  /** 主状态的中文标签（与筛选口径严格一致） */
  const STATUS_LABEL = {
    'reg-open': '报名中',
    'reg-closed': '报名已截止',
    upcoming: '待开赛',
    ongoing: '进行中',
    ended: '已结束',
    tbd: '时间待定',
  };

  /* ---------------- 关键词检索 ----------------
     语法：空格 = AND；| = OR；"短语" = 精确；-词 = 排除
     返回：组数组，命中任意一组即算匹配
  ------------------------------------------- */
  function tokenizeQuery(q) {
    if (!q) return [];
    const groups = [[]];
    const re = /"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(q))) {
      const phrase = m[1] !== undefined;
      const text = phrase ? m[1] : m[2];
      if (!phrase && text === '|') { groups.push([]); continue; }
      let neg = false, t = text;
      if (!phrase && t.length > 1 && t[0] === '-') { neg = true; t = t.slice(1); }
      t = t.trim().toLowerCase();
      if (t) groups[groups.length - 1].push({ text: t, neg, phrase });
    }
    return groups.filter((g) => g.length);
  }

  function haystack(ev) {
    return [
      ev.title, ev.titleEn, (ev.aliases || []).join(' '), ev.organizer, ev.region,
      ev.format, ev.subCategory, ev.restrictions, ev.note, ev.registrationNote,
      ev.prizes, CATEGORY_LABEL[ev.category] || '', String(ev.year || ''),
    ].filter(Boolean).join(' \u0000 ').toLowerCase();
  }

  function queryMatches(hay, groups) {
    if (!groups || !groups.length) return true;
    return groups.some((g) => g.every((tk) => {
      const hit = hay.includes(tk.text);
      return tk.neg ? !hit : hit;
    }));
  }

  /* ---------------- 时间段检索 ----------------
     mode='overlap' 事件区间与查询区间有交集
     mode='contain' 事件区间完全落在查询区间内
     区间端点缺失时用另一端退化处理。
  ------------------------------------------- */
  /** 该赛事在指定维度上是否存在可比较的日期。
   *  用于区分「落在区间外」与「压根没有日期」——后者不该被静默隐藏。 */
  function hasComparableDate(st, field) {
    const f = field || 'contest';
    if ((f === 'contest' || f === 'any') && (st.cs != null || st.ce != null)) return true;
    if ((f === 'registration' || f === 'any') && (st.rs != null || st.re != null)) return true;
    return false;
  }

  function rangeMatches(st, opt) {
    const { field = 'contest', fromTs = null, toTs = null, mode = 'overlap' } = opt || {};
    if (fromTs == null && toTs == null) return true;
    const f = fromTs == null ? -Infinity : fromTs;
    const t = toTs == null ? Infinity : toTs;

    const pairs = [];
    if (field === 'contest' || field === 'any') pairs.push([st.cs, st.ce]);
    if (field === 'registration' || field === 'any') pairs.push([st.rs, st.re]);

    for (const [s, e] of pairs) {
      if (s == null && e == null) continue;
      const ss = s == null ? e : s;
      const ee = e == null ? s : e;
      if (mode === 'contain') { if (ss >= f && ee <= t) return true; }
      else if (ss <= t && ee >= f) return true;
    }
    return false;
  }

  /* ---------------- 排序 ---------------- */
  const MAXI = Number.MAX_SAFE_INTEGER;
  const n = (v) => (v == null ? MAXI : v);

  /* 排序：同日期时按中北级别优先（超级 > 一级 > 二级 > 三级），
     让「时间待定」这一大组里级别高的排在前面。 */
  const LVL_RANK = { '超级': 4, '一级': 3, '二级': 2, '三级': 1 };
  const lvlRank = (ev) => LVL_RANK[ev.nucLevel] || 0;
  const titleCmp = (a, b) => String(a.ev.title).localeCompare(String(b.ev.title), 'zh-CN');

  function sortDecorated(list, key) {
    const cmp = {
      'start-asc': (a, b) => n(a.st.cs) - n(b.st.cs) || lvlRank(b.ev) - lvlRank(a.ev) || titleCmp(a, b),
      'start-desc': (a, b) => n(b.st.cs) - n(a.st.cs) || lvlRank(b.ev) - lvlRank(a.ev) || titleCmp(a, b),
      'reg-asc': (a, b) => n(a.st.rs) - n(b.st.rs) || n(a.st.cs) - n(b.st.cs) || titleCmp(a, b),
      'weight-desc': (a, b) => (b.ev.weight || -1) - (a.ev.weight || -1) || n(a.st.cs) - n(b.st.cs) || titleCmp(a, b),
      'title-asc': (a, b) => titleCmp(a, b),
    }[key];
    return cmp ? list.sort(cmp) : list;
  }

  /** 汇总统计：按互斥主状态计数，各项之和恒等于 total */
  function summarize(decorated) {
    const c = {
      total: decorated.length,
      'reg-open': 0, 'reg-closed': 0, upcoming: 0, ongoing: 0, ended: 0, tbd: 0,
    };
    for (const d of decorated) {
      const k = d.st.status;
      if (c[k] === undefined) c[k] = 0;
      c[k]++;
    }
    return c;
  }

  return {
    CATEGORY_LABEL, CONF_LABEL, REG_BASIS_LABEL, STATUS_LABEL,
    tzOffsetMs, zonedToTs, dayStart, dayEnd, toTs, fmtDT, fmtDay, monthKey, tzAbbr, human,
    computeStatus, statusMatches,
    tokenizeQuery, haystack, queryMatches, rangeMatches, hasComparableDate,
    sortDecorated, summarize,
  };
});
