/**
 * 报名时间抽取器
 *
 * 设计原则：**只从原文抽取，绝不臆测**。
 *  - 抽到明确日期 → basis = 'stated'，并保留原文片段作为证据
 *  - 抽不到        → basis = 'unknown'，字段留空（由归一化层决定是否给出「推定」值）
 *
 * 处理能力：
 *  - 日期格式：`14 Dec 2025` / `March 27, 2026` / `June 3` / `march 23(mon)` / `2026-03-27` / `2026年3月27日`
 *  - 无年份日期：从同一子句内其他日期或赛事年份回填
 *  - 区间表述：`June 3 – August 29, 2026` / `March 23 to April 22, 2026`
 *  - 方向判定：deadline/closes/until/through/by → 截止；opens/starts/from → 开始
 *  - 时刻与时区：`12:00 PM (KST)` → 换算为带偏移的 ISO
 */

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const WEEKDAY = '(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*';

/** 时区缩写 → 偏移（分钟） */
const TZ_OFFSETS = {
  utc: 0, gmt: 0, z: 0,
  cet: 60, cest: 120, bst: 60, west: 0, west1: 60,
  est: -300, edt: -240, cst: -360, cdt: -300, mst: -420, mdt: -360, pst: -480, pdt: -420,
  msk: 180, trt: 180, eet: 120, eest: 180,
  ist: 330, kst: 540, jst: 540, sgt: 480, hkt: 480, cst_china: 480, aest: 600, aedt: 660,
  nzst: 720, nzdt: 780, brt: -180, art: -180, sast: 120,
};

function pad(n, w = 2) { return String(n).padStart(w, '0'); }
function tzToOffsetMin(tz) {
  if (!tz) return 0;
  const t = tz.toLowerCase().replace(/[^a-z0-9+:-]/g, '');
  if (TZ_OFFSETS[t] !== undefined) return TZ_OFFSETS[t];
  // utc+5 / gmt-3 / utc+05:30
  let m = /^(?:utc|gmt)([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(t);
  if (m) {
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (+m[2] * 60 + (+(m[3] || 0)));
  }
  return 0;
}
function offsetStr(min) {
  const s = min < 0 ? '-' : '+';
  const a = Math.abs(min);
  return `${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/* ---------------- 日期识别 ---------------- */
const RE_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const RE_CN = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(?:(\d{1,2})\s*日?)?/g;
const RE_CN_MD = /(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;
const RE_DMY = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s.]+(${MONTH_ALT})\\.?,?\\s*(\\d{4})?\\b`, 'gi');
const RE_MDY = new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*\\(${WEEKDAY}\\))?,?\\s*(\\d{4})?\\b`, 'gi');
const RE_MY = new RegExp(`\\b(${MONTH_ALT})\\.?,?\\s+(\\d{4})\\b`, 'gi');

function collect(re, text, map, out) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    const r = map(m);
    if (r) out.push({ ...r, idx: m.index, len: m[0].length, raw: m[0] });
    if (m.index === re.lastIndex) re.lastIndex++;
  }
}

/** 找出文本中所有日期，按位置排序并去除重叠 */
export function findDates(text) {
  const out = [];
  collect(RE_ISO, text, (m) => ({ y: +m[1], mo: +m[2] - 1, d: +m[3], hasYear: true }), out);
  collect(RE_CN, text, (m) => (m[3] ? { y: +m[1], mo: +m[2] - 1, d: +m[3], hasYear: true } : null), out);
  collect(RE_CN_MD, text, (m) => ({ y: null, mo: +m[1] - 1, d: +m[2], hasYear: false }), out);
  collect(RE_DMY, text, (m) => {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo === undefined || +m[1] < 1 || +m[1] > 31) return null;
    return { y: m[3] ? +m[3] : null, mo, d: +m[1], hasYear: !!m[3] };
  }, out);
  collect(RE_MDY, text, (m) => {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo === undefined || +m[2] < 1 || +m[2] > 31) return null;
    return { y: m[3] ? +m[3] : null, mo, d: +m[2], hasYear: !!m[3] };
  }, out);
  collect(RE_MY, text, (m) => {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo === undefined) return null;
    return { y: +m[2], mo, d: 1, hasYear: true, monthOnly: true };
  }, out);

  out.sort((a, b) => a.idx - b.idx || b.len - a.len);
  const kept = [];
  for (const c of out) {
    if (kept.some((k) => c.idx < k.idx + k.len && k.idx < c.idx + c.len)) continue;
    kept.push(c);
  }
  return kept;
}

/** 在日期附近找时刻，如 "12:00 PM" / "at 09:00" */
function findTimeNear(text, from, to) {
  const seg = text.slice(from, to);
  const m = /(\d{1,2}):(\d{2})\s*(am|pm)?/i.exec(seg);
  if (!m) return null;
  let h = +m[1];
  const mi = +m[2];
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  return { h, mi };
}

/** 在日期附近找时区缩写，如 "(KST)" / "CEST" / "UTC+5" */
function findTzNear(text, from, to) {
  const seg = text.slice(from, to);
  let m = /\b(utc|gmt)\s*([+-]\d{1,2}(?::?\d{2})?)\b/i.exec(seg);
  if (m) return m[1] + m[2];
  const re = new RegExp(`\\b(${Object.keys(TZ_OFFSETS).join('|')})\\b`, 'i');
  m = re.exec(seg);
  if (m) return m[1];
  m = /\b([A-Z]{2,5})\b/.exec(seg);
  return null;
}

/* ---------------- 子句方向判定 ---------------- */
/* 注意：中文字符不属于 \w，因此中文关键词**不能**被 \b 包裹，否则永不匹配。
   英文用 \b 锚定，中文单独一支。 */
const REG_KW = /\b(?:regist(?:er|ration|rations|ering)?|sign[\s-]?up|enrol(?:l)?ment|enrol(?:l)?|application|apply|entry)\b|报名|注册|参赛申请/gi;

/** 截止语义（越靠近日期越权威） */
const END_RE = /\b(?:deadline|closes?|closed|closing|end(?:s|ing)?|until|through|thru|till|by|before|latest|due|no\s+later\s+than|last\s+day)\b|截止|结束|之前|前完成/gi;
/** 开始语义 */
const START_RE = /\b(?:open(?:s|ing)?|start(?:s|ing)?|begin(?:s|ning)?|from|since|live)\b|开始|开放|起/gi;

const RANGE_SEP = /\s*(?:–|—|─|~|～|\bto\b|\buntil\b|\bthrough\b|\bthru\b|-|至|到)\s*/i;
const RANGE_SEP_G = new RegExp(RANGE_SEP.source, 'gi');

/**
 * 判定方向：取「离日期最近的那个方向词」。
 * 这样 "is OPEN through Sept 30"（open 在前、through 在后）会正确判为「截止」，
 * 而 "registrations open: May 02" 判为「开始」。
 */
function direction(text) {
  let lastEnd = -1, lastStart = -1, m;
  END_RE.lastIndex = 0;
  while ((m = END_RE.exec(text))) lastEnd = m.index + m[0].length;
  START_RE.lastIndex = 0;
  while ((m = START_RE.exec(text))) lastStart = m.index + m[0].length;
  if (lastEnd === -1 && lastStart === -1) return null;
  if (lastEnd === -1) return 'start';
  if (lastStart === -1) return 'end';
  return lastEnd >= lastStart ? 'end' : 'start';
}

function toIso(y, mo, d, h = 0, mi = 0, offMin = 0) {
  return `${y}-${pad(mo + 1)}-${pad(d)}T${pad(h)}:${pad(mi)}:00${offsetStr(offMin)}`;
}

function saneTs(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const y = new Date(iso).getUTCFullYear();
  return y >= 2000 && y <= 2100;
}

/**
 * 主入口
 * @param {string} description 赛事描述
 * @param {number} eventYear    赛事年份（用于回填无年份日期）
 * @returns {{start:?string, end:?string, snippets:string[], basis:'stated'|'unknown'}}
 */
export function extractRegistration(description, eventYear) {
  const res = { start: null, end: null, snippets: [], basis: 'unknown' };
  if (!description) return res;

  const text = String(description).replace(/\r/g, ' ').replace(/\s+/g, ' ');
  // 切成子句，避免跨语义串味
  const clauses = [];
  let last = 0;
  const splitRe = /(?<=[.!?。！？;；])\s+|\n+|\s{2,}/g;
  let sm;
  while ((sm = splitRe.exec(text))) {
    clauses.push({ text: text.slice(last, sm.index), idx: last });
    last = sm.index + sm[0].length;
  }
  clauses.push({ text: text.slice(last), idx: last });

  for (const cl of clauses) {
    const ctext = cl.text;
    if (!ctext || ctext.length < 6) continue;

    // 收集本子句内所有报名关键词的位置
    const kwPos = [];
    REG_KW.lastIndex = 0;
    let km;
    while ((km = REG_KW.exec(ctext))) {
      kwPos.push({ start: km.index, end: km.index + km[0].length });
      if (km.index === REG_KW.lastIndex) REG_KW.lastIndex++;
    }
    if (!kwPos.length) continue;

    const dates = findDates(ctext);
    if (!dates.length) continue;

    // 尝试一次区间解析（两个日期 + 中间有区间符）
    // 收紧条件，避免把「赛程表 / 现场签到时段 / 申请链接」误当报名窗口：
    //   1) 子句内出现 ≥3 个日期 → 判定为赛程表，整体跳过
    //   2) 区间必须紧跟在报名关键词之后（≤45 字符）
    //   3) 关键词与首个日期之间不能是 URL
    //   4) 两个日期之间不能含具体时刻（那是赛程条目，不是日期区间）
    const isScheduleLike = dates.length >= 3 || (ctext.match(/\d{1,2}:\d{2}/g) || []).length >= 2;
    if (dates.length >= 2 && !isScheduleLike) {
      for (let i = 0; i < dates.length - 1; i++) {
        const a = dates[i], b = dates[i + 1];
        const kw = [...kwPos].reverse().find((k) => k.end <= a.idx);
        if (!kw) continue;
        const gap = a.idx - kw.end;
        if (gap < 0 || gap > 45) continue;
        const bridge = ctext.slice(kw.end, a.idx);
        if (/https?:\/\//i.test(bridge)) continue;

        const between = ctext.slice(a.idx + a.len, b.idx);
        if (/\d{1,2}:\d{2}/.test(between)) continue;
        if (RANGE_SEP.test(between) && between.replace(RANGE_SEP_G, '').trim().length <= 12) {
          const yRef = a.y || b.y || eventYear;
          const aIso = build(a, yRef, ctext, 0, 0, false);
          const bIso = build(b, yRef, ctext, 23, 59, true);
          if (aIso && bIso && aIso < bIso) {
            if (!res.start || aIso < res.start) res.start = aIso;
            if (!res.end || bIso > res.end) res.end = bIso;
            res.snippets.push(ctext.trim().slice(0, 160));
            res.basis = 'stated';
          }
          break;
        }
      }
    }

    if (res.start && res.end) continue;

    // 单日期方向判定
    for (const dt of dates) {
      const before = ctext.slice(Math.max(0, dt.idx - 90), dt.idx);
      // 关键词与日期之间夹着 URL → 多半是「申请链接」而非报名日期
      const lastKw = [...kwPos].reverse().find((k) => k.end <= dt.idx);
      if (lastKw && /https?:\/\//i.test(ctext.slice(lastKw.end, dt.idx))) continue;
      const dir = direction(before.slice(-60));
      const yRef = dt.y || eventYear;
      if (dir === 'end') {
        const iso = build(dt, yRef, ctext, 23, 59, true);
        if (iso && (!res.end || iso > res.end)) {
          res.end = iso; res.basis = 'stated';
          res.snippets.push(ctext.trim().slice(0, 160));
        }
      } else if (dir === 'start') {
        const iso = build(dt, yRef, ctext, 0, 0, false);
        if (iso && (!res.start || iso < res.start)) {
          res.start = iso; res.basis = 'stated';
          res.snippets.push(ctext.trim().slice(0, 160));
        }
      }
    }
  }

  if (res.start && res.end && res.start > res.end) {
    const t = res.start; res.start = res.end; res.end = t;
  }
  res.snippets = [...new Set(res.snippets)].slice(0, 3);
  return res;
}

function build(dt, year, ctext, dh, dmi, preferEnd) {
  if (!dt || !year) return null;
  const t = findTimeNear(ctext, Math.max(0, dt.idx - 30), dt.idx + dt.len + 30);
  let h = dh, mi = dmi, off = 0;
  if (t) {
    h = t.h; mi = t.mi;
    const tz = findTzNear(ctext, dt.idx + dt.len, dt.idx + dt.len + 30)
      || findTzNear(ctext, Math.max(0, dt.idx - 30), dt.idx);
    if (tz) off = tzToOffsetMin(tz);
  } else if (preferEnd) {
    h = 23; mi = 59;
  }
  let y = year;
  // 2 月 29 日在非闰年 → 顺延到 3 月 1 日，避免 Invalid Date
  if (dt.mo === 1 && dt.d === 29 && !isLeap(y)) { return toIso(y, 2, 1, h, mi, off); }
  const iso = toIso(y, dt.mo, dt.d, h, mi, off);
  return saneTs(iso) ? iso : null;
}

function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
