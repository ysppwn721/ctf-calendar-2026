#!/usr/bin/env node
/**
 * CTFtime 赛事采集器
 * 按月分片调用公开 API：/api/v1/events/?limit=100&start=<unix>&finish=<unix>
 * 输出原始 JSON 到 data/raw/
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const RAW = resolve(ROOT, 'data', 'raw');

const UA = 'ctf-calendar-collector/1.0 (+https://github.com/ysppwn721)';
const LIMIT = 100;

/** 采集窗口：2026 自然年（含边界缓冲，覆盖跨年赛事） */
const WINDOW_START = Date.UTC(2025, 11, 1);   // 2025-12-01
const WINDOW_END = Date.UTC(2027, 1, 1);     // 2027-02-01

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWindow(startMs, finishMs, attempt = 1) {
  const start = Math.floor(startMs / 1000);
  const finish = Math.floor(finishMs / 1000);
  const url = `https://ctftime.org/api/v1/events/?limit=${LIMIT}&start=${start}&finish=${finish}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.status === 429) {
      if (attempt > 5) throw new Error('rate limited, giving up');
      const wait = 5000 * attempt;
      console.warn(`  429 rate-limited, waiting ${wait}ms (attempt ${attempt})`);
      await sleep(wait);
      return fetchWindow(startMs, finishMs, attempt + 1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = await res.json();
    if (!Array.isArray(json)) throw new Error('unexpected payload: ' + JSON.stringify(json).slice(0, 200));
    return json;
  } catch (err) {
    if (attempt > 4) throw err;
    const wait = 2000 * attempt;
    console.warn(`  error (${err.message}), retry in ${wait}ms`);
    await sleep(wait);
    return fetchWindow(startMs, finishMs, attempt + 1);
  }
}

function monthChunks(fromMs, toMs) {
  const chunks = [];
  let cur = new Date(fromMs);
  cur = Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), 1);
  while (cur < toMs) {
    const d = new Date(cur);
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    chunks.push([cur, Math.min(next, toMs)]);
    cur = next;
  }
  return chunks;
}

async function main() {
  await mkdir(RAW, { recursive: true });
  const chunks = monthChunks(WINDOW_START, WINDOW_END);
  const byId = new Map();
  const report = [];

  console.log(`采集窗口 ${new Date(WINDOW_START).toISOString()} → ${new Date(WINDOW_END).toISOString()}`);
  console.log(`共 ${chunks.length} 个月度分片\n`);

  for (const [s, e] of chunks) {
    const label = new Date(s).toISOString().slice(0, 7);
    process.stdout.write(`[${label}] 抓取中... `);
    const events = await fetchWindow(s, e);
    let added = 0;
    for (const ev of events) {
      if (!byId.has(ev.id)) { byId.set(ev.id, ev); added++; }
    }
    console.log(`${events.length} 条 (新增 ${added})`);
    report.push({ month: label, returned: events.length, added });
    await sleep(1200); // 礼貌节流，避免触发 CTFtime 限流
  }

  const all = [...byId.values()].sort((a, b) => new Date(a.start) - new Date(b.start));
  const outFile = resolve(RAW, 'ctftime-events.json');
  await writeFile(outFile, JSON.stringify(all, null, 2), 'utf8');
  await writeFile(resolve(RAW, 'ctftime-fetch-report.json'), JSON.stringify(report, null, 2), 'utf8');

  console.log(`\n共采集去重后 ${all.length} 条赛事 → ${outFile}`);
  const inScope = all.filter((e) => {
    const t = new Date(e.start).getTime();
    return t >= Date.UTC(2026, 0, 1) && t < Date.UTC(2027, 0, 1);
  });
  console.log(`其中 ${inScope.length} 条开始时间落在 2026 自然年内`);
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
