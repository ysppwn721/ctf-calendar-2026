#!/usr/bin/env node
/** 报名抽取器回归测试：用例全部取自真实赛事描述 */
import { extractRegistration } from './lib/registration.mjs';

const CASES = [
  ['registration: June 3 – August 29, 2026', 2026, '2026-06-03', '2026-08-29'],
  ['(Registration deadline: 14 Dec 2025)', 2025, null, '2025-12-14'],
  ['(Registration deadline: 11 Jan 2026)', 2026, null, '2026-01-11'],
  ['Registration deadline: March 27, 2026', 2026, null, '2026-03-27'],
  ['Registration closes: 28 March 2026', 2026, null, '2026-03-28'],
  ['❍ Application period: March 23(Mon) to April 22(Wed), 2026', 2026, '2026-03-23', '2026-04-22'],
  ['Registrations open: May 02, 2026', 2026, '2026-05-02', null],
  ['Online registration opens on July 27, 2026, at 12:00 PM (KST) via the CTFd platform.', 2026, '2026-07-27', null],
  ['Registration deadline: 30 September 2026, 23:59 (UTC+5)', 2026, null, '2026-09-30'],
  ['(Registration deadline: 20 Oct 2026)', 2026, null, '2026-10-20'],
  ['Registration is OPEN through September 30th', 2026, null, '2026-09-30'],
  ['报名截止时间：2026年3月27日', 2026, null, '2026-03-27'],
  ['报名时间：2026年3月1日至4月22日', 2026, '2026-03-01', '2026-04-22'],
  ['Registration is open from 2026-03-01 until 2026-04-20.', 2026, '2026-03-01', '2026-04-20'],
  // 不应被误判为报名时间（这是赛程安排，不是报名窗口）
  ['- 23 May 2026, 08:00–09:30 CEST: participant registration', 2026, null, null],
  ['Register: https://unstop.com/hackathons/example-123', 2026, null, null],
  ['No registration information is available.', 2026, null, null],
];

let pass = 0, fail = 0;
for (const [text, year, expStart, expEnd] of CASES) {
  const r = extractRegistration(text, year);
  const okStart = expStart === null ? r.start === null : (r.start || '').startsWith(expStart);
  const okEnd = expEnd === null ? r.end === null : (r.end || '').startsWith(expEnd);
  const ok = okStart && okEnd;
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✓' : '✗'} ${text.slice(0, 62)}`);
  if (!ok) {
    console.log(`    期望 start=${expStart} end=${expEnd}`);
    console.log(`    实际 start=${r.start} end=${r.end} basis=${r.basis}`);
    if (r.snippets.length) console.log(`    片段=${r.snippets.join(' | ')}`);
  }
}
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);
