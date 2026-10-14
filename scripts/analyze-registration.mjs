#!/usr/bin/env node
/** 分析所有赛事描述中与「报名」相关的句子，用于改进抽取器 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW = resolve(__dirname, '..', 'data', 'raw', 'ctftime-events.json');

const events = JSON.parse(await readFile(RAW, 'utf8'));

const RE = /regist|sign[\s-]?up|enroll|entry|apply|application|报名|注册/gi;
const sentences = new Map();
let withAny = 0;
let withDate = 0;

for (const ev of events) {
  const desc = (ev.description || '').replace(/\r/g, ' ');
  if (RE.test(desc)) withAny++;
  RE.lastIndex = 0;
  // 按句子切分
  const parts = desc.split(/(?<=[.!?。！？])\s+|\n+/);
  for (const p of parts) {
    if (!RE.test(p)) continue;
    RE.lastIndex = 0;
    const clean = p.trim().replace(/\s+/g, ' ');
    if (clean.length < 8 || clean.length > 220) continue;
    // 是否含年份+日期的迹象
    const hasDate = /\d{4}/.test(clean) && /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}\s*月|\d{1,2}[\/.]\d{1,2})/i.test(clean);
    if (hasDate) withDate++;
    const key = clean.toLowerCase();
    sentences.set(key, (sentences.get(key) || 0) + 1);
  }
}

const arr = [...sentences.entries()].sort((a, b) => b[1] - a[1]);
console.log(`赛事总数: ${events.length}`);
console.log(`描述中出现「报名」相关词的赛事: ${withAny}`);
console.log(`其中含可识别日期片段的句子: ${withDate}`);
console.log(`唯一句子数: ${arr.length}\n`);

const outFile = resolve(__dirname, '..', 'data', 'raw', 'registration-sentences.txt');
await writeFile(outFile, arr.map(([s, n]) => `[${n}] ${s}`).join('\n'), 'utf8');

console.log('=== 含日期的报名句子（前 60 条）===');
let shown = 0;
for (const [s] of arr) {
  if (!/\d{4}/.test(s)) continue;
  if (!/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}\s*月)/i.test(s)) continue;
  console.log('--- ' + s);
  if (++shown >= 60) break;
}
console.log(`\n完整清单: ${outFile}`);
