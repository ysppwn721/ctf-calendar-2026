#!/usr/bin/env node
/**
 * 覆盖度校验：把月度分片再切成周/半周分片重抓，比较去重数量，
 * 判断月度查询是否被 API 截断（limit 生效情况）。
 */
const UA = 'ctf-calendar-collector/1.0 (+https://github.com/ysppwn721)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function q(startMs, finishMs) {
  const url = `https://ctftime.org/api/v1/events/?limit=100&start=${Math.floor(startMs / 1000)}&finish=${Math.floor(finishMs / 1000)}`;
  for (let i = 1; i <= 4; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.status === 429) { await sleep(4000 * i); continue; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  }
  throw new Error('failed');
}

const targets = [
  ['2026-01', Date.UTC(2026, 0, 1), Date.UTC(2026, 1, 1)],
  ['2026-06', Date.UTC(2026, 5, 1), Date.UTC(2026, 6, 1)],
  ['2026-07', Date.UTC(2026, 6, 1), Date.UTC(2026, 7, 1)],
  ['2026-10', Date.UTC(2026, 9, 1), Date.UTC(2026, 10, 1)],
];

for (const [label, s, e] of targets) {
  const whole = await q(s, e);
  await sleep(1000);
  // 切成 4 段（约每周）
  const step = (e - s) / 4;
  const ids = new Set();
  let raw = 0;
  for (let i = 0; i < 4; i++) {
    const part = await q(s + i * step, s + (i + 1) * step);
    raw += part.length;
    part.forEach((x) => ids.add(x.id));
    await sleep(1000);
  }
  const flat = new Set(whole.map((x) => x.id));
  const missing = [...ids].filter((id) => !flat.has(id));
  console.log(
    `${label}: 月度查询=${whole.length} 条 | 分片查询去重=${ids.size} 条 (原始累加 ${raw}) | 月度遗漏=${missing.length}${missing.length ? ' -> ' + missing.join(',') : ''}`,
  );
}
