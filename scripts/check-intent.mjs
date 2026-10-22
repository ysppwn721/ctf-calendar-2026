// 核对用户指定的 12 个意向赛事在数据中的匹配情况
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const d = require('../data/events.json');

const NAMES = [
  '全球校园人工智能算法精英大赛',
  '全国大学生数字媒体科技作品及创意竞赛',
  '华北五省计算机应用大赛',
  '中国国际大学生创新大赛',
  '信息安全与对抗技术竞赛',
  '全国大学生信息安全竞赛',
  '全国大学生电子商务创新创意及创业挑战赛',
  '羊城杯',
  '中国大学生计算机设计大赛',
  '蓝桥杯',
  'CCF 网络安全智能挑战赛',
  '鲲鹏杯',
];

const norm = (s) => String(s || '')
  .replace(/[“”"'‘’]/g, '')
  .replace(/[（(].*?[)）]/g, '')
  .replace(/\s+/g, '')
  .replace(/20\d{2}年?/g, '')
  .toLowerCase();

for (const n of NAMES) {
  const key = norm(n);
  const hits = d.events.filter((e) => {
    const t = norm(e.title);
    return t.includes(key) || key.includes(t);
  });
  console.log(`【${n}】 → ${hits.length} 条`);
  hits.slice(0, 4).forEach((e) =>
    console.log(`    [${e.category}] ${e.title.slice(0, 50)} | ${(e.contestStart || '日期待定').slice(0, 10)}`));
  if (!hits.length) console.log('    (未收录)');
}
