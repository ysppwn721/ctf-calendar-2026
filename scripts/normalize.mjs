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
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractRegistration } from './lib/registration.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const RAW = resolve(ROOT, 'data', 'raw');
const RESEARCH = resolve(ROOT, 'data', 'research');

/* ------------------------------------------------------------------ *
 * 分类推断
 * ------------------------------------------------------------------ */
function inferCategory(ev) {
  const r = (ev.restrictions || '').toLowerCase();
  const d = `${ev.description || ''} ${ev.title || ''}`.toLowerCase();
  if (r === 'academic') return { category: 'college', subCategory: '高校/学术限定' };
  if (/university|college|student|school|students|academic|collegiate/.test(d)) {
    return { category: 'college', subCategory: '高校/学生向' };
  }
  if (ev.onsite) return { category: 'international-technical', subCategory: '线下现场赛' };
  return { category: 'international-technical', subCategory: '国际公开赛' };
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

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
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
  return {
    id: item.id || `research-${slug(item.title)}`,
    title: item.title,
    titleEn: item.titleEn || item.title,
    aliases: item.aliases || [],
    category: item.category || fallbackCategory,
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

  // 只保留 2026 自然年
  const inScope = events.filter((e) => {
    if (e.contestStart) {
      const t = new Date(e.contestStart).getTime();
      return t >= Date.UTC(2026, 0, 1) && t < Date.UTC(2027, 0, 1);
    }
    return e.year === 2026;
  });

  // 去重：同名 + 同开始时间
  const seen = new Set();
  const deduped = [];
  for (const e of inScope) {
    const key = `${String(e.title).trim().toLowerCase()}|${e.contestStart || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }
  deduped.sort((a, b) => {
    const ta = a.contestStart ? new Date(a.contestStart).getTime() : Infinity;
    const tb = b.contestStart ? new Date(b.contestStart).getTime() : Infinity;
    return ta - tb || String(a.title).localeCompare(String(b.title));
  });

  const stats = {
    generatedAt: new Date().toISOString(),
    scope: '2026-01-01 ~ 2026-12-31',
    scopeNote: '按比赛开始时间归属自然年；时间为绝对时刻，前端按所选时区渲染',
    total: deduped.length,
    byCategory: {},
    byRegistrationBasis: {},
    byConfidence: {},
    withContestStart: deduped.filter((e) => e.contestStart).length,
    withContestEnd: deduped.filter((e) => e.contestEnd).length,
    withRegistrationStart: deduped.filter((e) => e.registrationStart).length,
    withRegistrationEnd: deduped.filter((e) => e.registrationEnd).length,
    registrationStated: deduped.filter((e) => e.registrationBasis === 'stated').length,
  };
  for (const e of deduped) {
    stats.byCategory[e.category] = (stats.byCategory[e.category] || 0) + 1;
    stats.byRegistrationBasis[e.registrationBasis] = (stats.byRegistrationBasis[e.registrationBasis] || 0) + 1;
    stats.byConfidence[e.confidence] = (stats.byConfidence[e.confidence] || 0) + 1;
  }

  await mkdir(resolve(ROOT, 'data'), { recursive: true });
  await writeFile(resolve(ROOT, 'data', 'events.json'), JSON.stringify({ stats, events: deduped }, null, 2), 'utf8');
  console.log('\n=== 归一化完成 ===');
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
