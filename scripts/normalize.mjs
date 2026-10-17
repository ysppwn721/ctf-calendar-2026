#!/usr/bin/env node
/**
 * 数据归一化：CTFtime 原始数据 + 人工调研数据 → 统一 events.json
 *
 * 统一字段（供前端使用）：
 *   id, title, titleEn, aliases, category, subCategory, region, organizer, format,
 *   officialUrl, registrationStart, registrationEnd, registrationBasis,
 *   contestStart, contestEnd, registrationNote, note, confidence, sources, evidence
 *
 * 时间一律以带时区的 ISO 8601 存储；前端按用户选择时区渲染。
 *
 * 报名字段的三档可信度（registrationBasis）：
 *   stated  —— 从原文/官方通知中抽取到明确日期（唯一可当作事实使用的一档）
 *   derived —— 官方未公布，按「CTF 平台惯例：报名通道开放至开赛时刻」推定，UI 会显著标注「推定」
 *   unknown —— 连推定的依据都没有（比赛时间本身就未知）
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractRegistration } from './lib/registration.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const RAW = resolve(ROOT, 'data', 'raw');
const RESEARCH = resolve(ROOT, 'data', 'research');

/* ------------------------------------------------------------------ *
 * 分类推断
 *
 * 判据只认「参赛对象限制」（CTFtime 的 restrictions 字段）。
 * 曾经的做法是扫描述里有没有 university/student/school —— 那是错的：
 * 公开赛的说明里普遍会提到学生组别，结果 302 场对外开放的赛事被误标成
 * 「大学生竞赛类」。分类必须基于赛事的准入规则，而不是宣传文案。
 *
 * 后续「大学生竞赛」这一档整体取消（对实验室选赛帮助有限）：
 * 准入限制不再单独成类，改由 subCategory 表达（如「高校限定 · 国际公开赛」），
 * 信息不丢失；学生向赛事由人工核验的国内赛事与校内认定目录承担。
 * ------------------------------------------------------------------ */
function inferCategory(ev) {
  const r = (ev.restrictions || '').trim().toLowerCase();
  const where = ev.onsite ? '线下现场赛' : '国际公开赛';

  const label = {
    academic: '高校限定',
    'high-school': '中学限定',
    'high school': '中学限定',
    collegiate: '高校限定',
    student: '学生限定',
    casual: '休闲赛',
    individual: '个人赛',
    prequalified: '需资格赛',
    invited: '邀请制',
  }[r];

  if (label) return { category: 'international-technical', subCategory: `${label} · ${where}` };
  if (r === 'open' || r === '') return { category: 'international-technical', subCategory: where };
  return { category: 'international-technical', subCategory: `${ev.restrictions} · ${where}` };
}

function inferRegion(ev) {
  const loc = (ev.location || '').trim();
  return loc || '线上 / Online';
}

/* ------------------------------------------------------------------ *
 * CTFtime 记录归一化
 * ------------------------------------------------------------------ */
function normalizeCtftime(ev) {
  const year = new Date(ev.start).getUTCFullYear();
  const reg = extractRegistration(ev.description, year);
  const { category, subCategory } = inferCategory(ev);

  let registrationStart = reg.start;
  let registrationEnd = reg.end;
  let registrationBasis = reg.basis;
  let registrationNote;

  // 合理性关卡：报名截止晚于比赛结束，对 CTF 而言几乎必然是误抽取
  //（把赛程表、现场签到时段、申请链接当成了报名窗口）。宁可退回推定档，也不放行可疑值。
  if (registrationBasis === 'stated' && registrationEnd && ev.finish
      && Date.parse(registrationEnd) > Date.parse(ev.finish) + 86400000) {
    console.log(`  ! 丢弃可疑报名时间「${ev.title}」：截止 ${registrationEnd} 晚于比赛结束 ${ev.finish}`);
    registrationStart = null;
    registrationEnd = null;
    registrationBasis = 'unknown';
  }

  if (registrationBasis === 'stated') {
    registrationNote = `自赛事描述抽取原文：${reg.snippets.join(' ／ ')}`;
  } else {
    // 未公布 → 按惯例推定：报名通道开放至开赛时刻
    registrationEnd = ev.start || null;
    registrationStart = null;
    registrationBasis = registrationEnd ? 'derived' : 'unknown';
    registrationNote = registrationBasis === 'derived'
      ? '官方未公布报名起止时间。此处「报名截止」为推定值（CTF 平台惯例：报名通道开放至开赛时刻），仅供参考，请以赛事官网为准。'
      : '官方未公布报名时间。';
  }

  return {
    id: `ctftime-${ev.id}`,
    title: ev.title,
    titleEn: ev.title,
    aliases: [],
    category,
    subCategory,
    region: inferRegion(ev),
    organizer: (ev.organizers || []).map((o) => o.name).join(', '),
    format: ev.format || '',
    onsite: !!ev.onsite,
    restrictions: ev.restrictions || '',
    weight: typeof ev.weight === 'number' ? ev.weight : null,
    officialUrl: ev.url || ev.ctftime_url || '',
    ctftimeUrl: ev.ctftime_url || '',
    registrationStart,
    registrationEnd,
    registrationBasis,
    contestStart: ev.start,
    contestEnd: ev.finish,
    registrationNote,
    note: '',
    year,
    confidence: registrationBasis === 'stated' ? 'medium' : 'low',
    sources: [ev.ctftime_url, ev.url].filter(Boolean),
    evidence: (ev.description || '').slice(0, 300),
    logo: ev.logo || '',
    prizes: ev.prizes || '',
    durationHours: ev.duration ? ev.duration.hours + ev.duration.days * 24 : null,
  };
}

/* ------------------------------------------------------------------ *
 * 去重：两份独立调研难免收录同一赛事（标题写法不同、赛事名带/不带年份）。
 * 用「标题字符二元组 Dice 相似度 + 比赛日期相容性」判定，避免人工漏合并。
 * ------------------------------------------------------------------ */
function titleKey(s) {
  return String(s).toLowerCase()
    .replace(/20\d{2}\s*年?/g, '')
    .replace(/[第届]/g, '')
    .replace(/[\s（）()【】\[\]·、,，:：\-—_""''""'']/g, '');
}

function bigrams(s) {
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  if (s.length === 1) set.add(s);
  return set;
}

function dice(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
}

/** 是否同一赛事：包含关系（强信号）或极高相似度。
 *  注意：短英文标题的 Dice 容易虚高（如 rstconctf vs hitconctf = 0.75），
 *  因此设 0.88 高阈值，且必须满足日期相容。 */
function sameEvent(k1, k2) {
  if (!k1 || !k2) return false;
  if (k1 === k2) return true;
  if (k1.length >= 6 && k2.length >= 6 && (k1.includes(k2) || k2.includes(k1))) return true;
  return dice(k1, k2) >= 0.88;
}

/** 日期相容：两者都未知 / 一方未知 / 相差 ≤2 天 —— 视为同一场赛事 */
function datesCompatible(a, b) {
  const ta = a.contestStart ? Date.parse(a.contestStart) : null;
  const tb = b.contestStart ? Date.parse(b.contestStart) : null;
  if (ta == null || tb == null) return true;
  return Math.abs(ta - tb) <= 2 * 86400000;
}

/** 完整度打分：字段越全、可信度越高越优先保留 */
function completeness(e) {
  const fields = ['organizer', 'format', 'officialUrl', 'registrationStart', 'registrationEnd',
    'contestStart', 'contestEnd', 'registrationNote', 'note', 'evidence', 'region', 'subCategory'];
  let s = fields.reduce((n, f) => n + (e[f] ? 1 : 0), 0);
  if (e.registrationBasis === 'stated') s += 3;
  if (e.confidence === 'high') s += 2;
  else if (e.confidence === 'medium') s += 1;
  s += (e.sources || []).length * 0.5;
  return s;
}

function uniq(arr) { return [...new Set(arr.filter(Boolean))]; }

function mergeTwo(a, b) {
  const [primary, secondary] = completeness(a) >= completeness(b) ? [a, b] : [b, a];
  const out = { ...primary };
  for (const k of Object.keys(secondary)) {
    const v = secondary[k];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (out[k] == null || out[k] === '' || (Array.isArray(out[k]) && !out[k].length)) out[k] = v;
  }
  out.aliases = uniq([...(a.aliases || []), ...(b.aliases || [])]);
  out.sources = uniq([...(a.sources || []), ...(b.sources || [])]);
  const ev = uniq([a.evidence, b.evidence]);
  out.evidence = ev.join(' ／／ ').slice(0, 600);
  if (a.title !== b.title) out.aliases = uniq([...out.aliases, a.title, b.title]).filter((t) => t !== out.title);
  out.mergedFrom = uniq([...(a.mergedFrom || []), ...(b.mergedFrom || []), a.title, b.title]);
  return out;
}

function dedupe(events) {
  const out = [];
  const keys = [];
  let merged = 0;
  for (const e of events) {
    const k = titleKey(e.title);
    let hit = -1;
    for (let i = 0; i < out.length; i++) {
      if (sameEvent(k, keys[i]) && datesCompatible(out[i], e)) { hit = i; break; }
    }
    if (hit >= 0) {
      console.log(`  合并重复: 「${e.title}」 → 「${out[hit].title}」`);
      out[hit] = mergeTwo(out[hit], e);
      keys[hit] = titleKey(out[hit].title);
      merged++;
    } else {
      out.push(e);
      keys.push(k);
    }
  }
  if (merged) console.log(`  共合并 ${merged} 条重复记录`);
  return out;
}

/* ------------------------------------------------------------------ *
 * 中北大学学科竞赛目录（2026版）
 * 该目录只有「竞赛名称 / 负责单位 / 级别 / 国赛官网 / 负责人」，没有日期，
 * 因此不进日历时间线，而是作为独立名录 + 与日历赛事的交叉标注。
 * ------------------------------------------------------------------ */
function normalizeCatalogItem(item, seenNo) {
  const dup = seenNo.has(item.no);
  seenNo.add(item.no);
  return {
    id: `nuc-${item.no}${dup ? '-2' : ''}`,
    no: item.no,
    name: item.name,
    level: item.level,
    dept: item.dept,
    owners: item.owners || [],
    url: item.url || null,
    note: item.note || '',
    security: !!item.security,
    // 以下字段由「赛事时间调研」合并填充（scripts 里的 dates-batch-*.json）
    contestStart: null,
    contestEnd: null,
    registrationStart: null,
    registrationEnd: null,
    dateHint: '',
    confidence: 'low',
    evidence: '',
    sources: [],
  };
}

/** 把目录条目挂到日历赛事的 nuc* 字段上，取最具体（最长）的匹配 */
function attachNucRefs(events, catalog) {
  const cand = catalog
    .map((c) => ({ c, key: titleKey(c.name) }))
    .filter((x) => x.key.length >= 6)
    .sort((a, b) => b.key.length - a.key.length);

  const matched = [];
  for (const e of events) {
    const ek = titleKey(e.title);
    let best = null;
    for (const { c, key } of cand) {
      const contains = ek.includes(key) || key.includes(ek);
      const hit = contains
        ? Math.min(ek.length, key.length) >= 6
        : dice(ek, key) >= 0.9;
      if (hit && (!best || key.length > best.key.length)) best = { c, key };
    }
    if (best) {
      e.nucNo = best.c.no;
      e.nucLevel = best.c.level;
      e.nucDept = best.c.dept;
      e.nucOwners = best.c.owners;
      matched.push({ event: e.title, catalog: best.c.name, level: best.c.level, catalogNo: best.c.no });
    }
  }
  return matched;
}

/* ------------------------------------------------------------------ */
async function readJsonIfExists(p) {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch (err) {
    console.warn(`  ! 解析失败 ${p}: ${err.message}`);
    return null;
  }
}

/** 稳定 ID：中文标题 slug 后会变成空串，必须用摘要避免 ID 冲突 */
function researchId(title) {
  return 'research-' + createHash('sha1').update(String(title)).digest('hex').slice(0, 10);
}

function normalizeResearch(item, fallbackCategory) {
  const rs = item.registrationStart || null;
  const re = item.registrationEnd || null;
  let basis = item.registrationBasis;
  if (!basis) {
    if (rs || re) basis = 'stated';
    else if (item.contestStart) basis = 'derived';
    else basis = 'unknown';
  }
  // 「大学生竞赛」档已取消：人工核验的国内大学生学科竞赛统一归入「国内赛事」
  let cat = item.category || fallbackCategory;
  if (cat === 'college') cat = 'domestic-technical';

  return {
    id: item.id || researchId(item.title),
    title: item.title,
    titleEn: item.titleEn || item.title,
    aliases: item.aliases || [],
    category: cat,
    subCategory: item.subCategory || '',
    region: item.region || '中国',
    organizer: item.organizer || '',
    format: item.format || '',
    onsite: item.onsite ?? null,
    restrictions: item.restrictions || '',
    weight: null,
    officialUrl: item.officialUrl || (item.sources && item.sources[0]) || '',
    ctftimeUrl: '',
    registrationStart: rs,
    registrationEnd: re || (basis === 'derived' ? item.contestStart || null : null),
    registrationBasis: basis,
    contestStart: item.contestStart || null,
    contestEnd: item.contestEnd || null,
    registrationNote: item.registrationNote || (basis === 'derived'
      ? '官方通知未明确报名起止；此处「报名截止」为推定值，请以官方通知为准。' : ''),
    note: item.note || '',
    year: item.year || null,
    confidence: item.confidence || 'medium',
    sources: item.sources || [],
    evidence: item.evidence || '',
    logo: '',
    prizes: item.prizes || '',
    durationHours: null,
  };
}

/* ------------------------------------------------------------------ */
async function main() {
  const ctftimeRaw = (await readJsonIfExists(resolve(RAW, 'ctftime-events.json'))) || [];
  console.log(`CTFtime 原始记录: ${ctftimeRaw.length}`);

  const events = ctftimeRaw.map(normalizeCtftime);

  const college = (await readJsonIfExists(resolve(RESEARCH, 'college-competitions.json'))) || [];
  const domestic = (await readJsonIfExists(resolve(RESEARCH, 'domestic-ctf.json'))) || [];
  console.log(`调研-大学生竞赛: ${college.length} | 调研-国内技术赛: ${domestic.length}`);

  for (const item of college) events.push(normalizeResearch(item, 'college'));
  for (const item of domestic) events.push(normalizeResearch(item, 'domestic-technical'));

  // 年度归属：赛程与 2026 自然年有交集即收录（多阶段赛事常跨年）
  const Y0 = Date.UTC(2026, 0, 1);
  const Y1 = Date.UTC(2027, 0, 1);
  const inScope = events.filter((e) => {
    const s = e.contestStart ? Date.parse(e.contestStart) : null;
    const t = e.contestEnd ? Date.parse(e.contestEnd) : null;
    const a = s == null ? t : s;
    const b = t == null ? s : t;
    if (a == null) return e.year === 2026;          // 无赛程：按标注年份
    return a < Y1 && b >= Y0;                        // 区间与 2026 有交集
  });

  // 去重：标题相似度 + 日期相容性
  const deduped = dedupe(inScope);
  deduped.sort((a, b) => {
    const ta = a.contestStart ? new Date(a.contestStart).getTime() : Infinity;
    const tb = b.contestStart ? new Date(b.contestStart).getTime() : Infinity;
    return ta - tb || String(a.title).localeCompare(String(b.title));
  });

  /* ---- 中北大学竞赛目录 ---- */
  const nucRaw = (await readJsonIfExists(resolve(RESEARCH, 'nuc-catalog.json'))) || [];
  const seenNo = new Set();
  const catalog = nucRaw.map((it) => normalizeCatalogItem(it, seenNo));
  catalog.sort((a, b) => a.no - b.no || a.name.localeCompare(b.name, 'zh-CN'));
  console.log(`中北大学竞赛目录: ${catalog.length} 条`);

  const nucMatches = attachNucRefs(deduped, catalog);
  console.log(`  与日历赛事交叉命中 ${nucMatches.length} 条`);
  for (const m of nucMatches) {
    console.log(`    [${m.level}] ${m.catalog}  ←  ${m.event}`);
  }

  /* 已有真实赛程的目录条目（#23 CISCN、#25 中国大学生计算机设计大赛）以**赛程为准**。
     调研结果不再覆盖它们，否则同一赛事会出现两套互相矛盾的日期
     （实测 #23 的调研结果给出 8/15「左右」，与官网及权威媒体确认的 8/20–22 冲突）。 */
  const referencedNos = new Set(nucMatches.map((m) => m.catalogNo));

  /* ---- 把赛事时间调研结果合并进目录 ---- */
  const dateFixes = [];
  for (let n = 1; n <= 10; n++) {
    const arr = await readJsonIfExists(resolve(RESEARCH, `dates-batch-${n}.json`));
    if (Array.isArray(arr)) {
      dateFixes.push(...arr);
      console.log(`  dates-batch-${n}: ${arr.length} 条`);
    }
  }

  const fixesByNo = new Map();
  for (const f of dateFixes) {
    if (!f || f.no == null) continue;
    const k = String(f.no);
    if (!fixesByNo.has(k)) fixesByNo.set(k, []);
    fixesByNo.get(k).push(f);
  }

  let datedByResearch = 0;
  let hinted = 0;
  let skippedRef = 0;
  for (const c of catalog) {
    const list = fixesByNo.get(String(c.no));
    if (!list || !list.length) continue;

    if (referencedNos.has(c.no)) {
      // 已有真实赛程：只吸收「时段参考」与备注，绝不覆盖日期
      const f = list.shift();
      c.dateHint = f.dateHint || '';
      c.researchNote = f.note || '';
      skippedRef++;
      continue;
    }

    // 同序号可能有多行（如 no=7 的两个子赛项），只给第一行落日期
    const f = list.shift();
    const cs = f.contestStart || null;
    const ce = f.contestEnd || null;
    // 校验：必须是可解析的 ISO，且结束不早于开始；不合格一律丢弃，绝不带着脏数据往下走
    const okPair = cs && ce && Number.isFinite(Date.parse(cs)) && Number.isFinite(Date.parse(ce))
      && Date.parse(ce) >= Date.parse(cs);
    if (cs && !Number.isFinite(Date.parse(cs))) {
      console.warn(`  ! 丢弃无法解析的日期「${c.name}」: ${cs}`);
    }
    c.contestStart = okPair ? cs : null;
    c.contestEnd = okPair ? ce : null;
    c.registrationStart = f.registrationStart && Number.isFinite(Date.parse(f.registrationStart))
      ? f.registrationStart : null;
    c.registrationEnd = f.registrationEnd && Number.isFinite(Date.parse(f.registrationEnd))
      ? f.registrationEnd : null;
    c.dateHint = f.dateHint || '';
    c.confidence = f.confidence || 'low';
    c.evidence = f.evidence || '';
    c.sources = Array.isArray(f.sources) ? f.sources.filter(Boolean) : [];
    c.researchNote = f.note || '';
    if (c.contestStart) datedByResearch++;
    if (c.dateHint) hinted++;
  }
  console.log(`  调研落日期 ${datedByResearch} 条，仅有时段参考(dateHint) ${hinted} 条，`
    + `因已有真实赛程而跳过覆盖 ${skippedRef} 条`);

  /* 把目录里还没有对应赛程的条目，也并入赛事列表。
     实验室要的是「学校认定的全部竞赛」，而不只是已公布日期的那些。
     已经通过交叉引用落到真实赛程上的条目不重复生成，避免同一赛事出现两行。
     （referencedNos 已在上面算好） */
  const synthesized = catalog
    .filter((c) => !referencedNos.has(c.no))
    .map((c) => {
      const hasReg = !!(c.registrationStart || c.registrationEnd);
      const basis = hasReg ? 'stated' : (c.contestStart ? 'derived' : 'unknown');
      // 与 normalizeCtftime 保持同一套推定规则：derived 档的报名截止 = 开赛时刻
      const regEnd = hasReg ? (c.registrationEnd || null)
        : (basis === 'derived' ? c.contestStart : null);
      return ({
      id: `catalog-${c.id}`,
      title: c.name,
      titleEn: c.name,
      aliases: [],
      category: 'catalog',
      subCategory: `校内认定 · ${c.level} · ${c.dept}`,
      region: '中国',
      organizer: c.dept,
      format: '',
      onsite: null,
      restrictions: '',
      weight: null,
      officialUrl: c.url || '',
      ctftimeUrl: '',
      registrationStart: c.registrationStart || null,
      registrationEnd: regEnd,
      registrationBasis: basis,
      contestStart: c.contestStart || null,
      contestEnd: c.contestEnd || null,
      registrationNote: (c.registrationStart || c.registrationEnd)
        ? '报名时间来自 2026 年官方通知（见来源与原文摘录）。'
        : c.contestStart
          ? '官方未公布报名起止；此处「报名截止」按惯例推定为开赛时刻，仅供参考。'
          : '《中北大学学科竞赛目录（2026版）》未提供该竞赛的报名与比赛日期，请以官网通知为准。',
      note: [c.note, c.researchNote].filter(Boolean).join(' ／ '),
      dateHint: c.dateHint || '',
      year: 2026,
      confidence: c.confidence || 'low',
      sources: (c.sources && c.sources.length) ? c.sources : (c.url ? [c.url] : []),
      evidence: c.evidence || '',
      logo: '',
      prizes: '',
      durationHours: null,
      nucNo: c.no,
      nucLevel: c.level,
      nucDept: c.dept,
      nucOwners: c.owners,
      });
    });
  deduped.push(...synthesized);
  deduped.sort((a, b) => {
    const ta = a.contestStart ? new Date(a.contestStart).getTime() : Infinity;
    const tb = b.contestStart ? new Date(b.contestStart).getTime() : Infinity;
    if (ta !== tb) return ta - tb;
    const lv = { '超级': 4, '一级': 3, '二级': 2, '三级': 1 };
    return (lv[b.nucLevel] || 0) - (lv[a.nucLevel] || 0)
      || String(a.title).localeCompare(String(b.title), 'zh-CN');
  });
  console.log(`  目录条目并入赛事列表 ${synthesized.length} 条（已在赛程中的 ${referencedNos.size} 条不重复）`);
  console.log(`  赛事总数 ${deduped.length}`);

  const nucStats = {
    generatedAt: new Date().toISOString(),
    source: '中北大学学科竞赛目录（2026版）',
    sourceType: 'PDF 表格（12 页 / 126 行），文本层无可用 ToUnicode 映射，经页面渲染后逐行人工录入',
    note: '该目录只含竞赛名称/负责单位/级别/国赛官网/负责人，不含任何日期，故不进入日历时间线',
    total: catalog.length,
    byLevel: {},
    byDept: {},
    missingUrl: catalog.filter((c) => !c.url).length,
    securityRelated: catalog.filter((c) => c.security).length,
    withContestDate: catalog.filter((c) => c.contestStart).length,
    withRegistrationDate: catalog.filter((c) => c.registrationStart || c.registrationEnd).length,
    withDateHint: catalog.filter((c) => c.dateHint).length,
    crossReferenced: nucMatches.length,
    crossRefs: nucMatches,
  };
  for (const c of catalog) {
    nucStats.byLevel[c.level] = (nucStats.byLevel[c.level] || 0) + 1;
    nucStats.byDept[c.dept] = (nucStats.byDept[c.dept] || 0) + 1;
  }

  const stats = {
    generatedAt: new Date().toISOString(),
    scope: '2026-01-01 ~ 2026-12-31',
    scopeNote: '赛程与 2026 自然年有交集即收录（多阶段赛事常跨年）；时间为绝对时刻，前端按所选时区渲染',
    total: deduped.length,
    byCategory: {},
    byRegistrationBasis: {},
    byConfidence: {},
    withContestStart: deduped.filter((e) => e.contestStart).length,
    withContestEnd: deduped.filter((e) => e.contestEnd).length,
    withRegistrationStart: deduped.filter((e) => e.registrationStart).length,
    withRegistrationEnd: deduped.filter((e) => e.registrationEnd).length,
    registrationStated: deduped.filter((e) => e.registrationBasis === 'stated').length,
    nucCatalogTotal: catalog.length,
    nucCrossReferenced: nucMatches.length,
  };
  for (const e of deduped) {
    stats.byCategory[e.category] = (stats.byCategory[e.category] || 0) + 1;
    stats.byRegistrationBasis[e.registrationBasis] = (stats.byRegistrationBasis[e.registrationBasis] || 0) + 1;
    stats.byConfidence[e.confidence] = (stats.byConfidence[e.confidence] || 0) + 1;
  }

  await mkdir(resolve(ROOT, 'data'), { recursive: true });
  await writeFile(resolve(ROOT, 'data', 'events.json'), JSON.stringify({ stats, events: deduped }, null, 2), 'utf8');
  await writeFile(resolve(ROOT, 'data', 'nuc-catalog.json'),
    JSON.stringify({ stats: nucStats, entries: catalog }, null, 2), 'utf8');
  console.log('\n=== 归一化完成 ===');
  console.log(JSON.stringify(stats, null, 2));
  console.log('\n=== 中北大学目录 ===');
  console.log(JSON.stringify(nucStats.byLevel, null, 2));
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
