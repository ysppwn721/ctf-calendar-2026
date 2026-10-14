#!/usr/bin/env node
/**
 * 组装可部署的静态站点到 dist/
 * 只包含运行时真正需要的文件，避免把 node_modules / 脚本 / 原始数据一起上传。
 */
import { mkdir, copyFile, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');

const FILES = [
  ['index.html', 'index.html'],
  ['assets/core.js', 'assets/core.js'],
  ['assets/app.js', 'assets/app.js'],
  ['assets/styles.css', 'assets/styles.css'],
  ['data/events.json', 'data/events.json'],
];

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  let total = 0;
  for (const [src, dst] of FILES) {
    const s = resolve(ROOT, src);
    const d = join(DIST, dst);
    await mkdir(dirname(d), { recursive: true });
    await copyFile(s, d);
    const sz = (await stat(d)).size;
    total += sz;
    console.log(`  ${src.padEnd(22)} → dist/${dst.padEnd(22)} ${(sz / 1024).toFixed(1)} KB`);
  }

  // 校验数据可被解析
  const payload = JSON.parse(await readFile(join(DIST, 'data', 'events.json'), 'utf8'));
  if (!payload.events || !payload.events.length) throw new Error('events.json 为空');

  // SPA/静态站无需路由规则；补一份 _headers 以控制缓存
  await writeFile(join(DIST, '_headers'), [
    '/data/events.json',
    '  Cache-Control: public, max-age=1800',
    '/*',
    '  X-Content-Type-Options: nosniff',
    '',
  ].join('\n'), 'utf8');

  console.log(`\ndist/ 就绪：${payload.events.length} 条赛事，共 ${(total / 1024).toFixed(1)} KB`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
