/* ============================================================
   详情页 — 赛事 与 中北大学目录条目 共用
   event.html?id=<赛事id>   或   event.html?nuc=<目录序号>
   ============================================================ */
(function () {
  'use strict';

  const C = window.CTF_CORE;
  const { CATEGORY_LABEL, CONF_LABEL, REG_BASIS_LABEL } = C;

  const TZ_PRESETS = [
    { id: 'Asia/Shanghai', label: '北京时间' },
    { id: 'UTC', label: 'UTC' },
    { id: 'local', label: '本机时区' },
  ];

  const STATUS_META = {
    'reg-open': { label: '报名中', cls: 'reg-open' },
    'reg-closed': { label: '报名已截止', cls: 'upcoming' },
    upcoming: { label: '未开始', cls: 'upcoming' },
    ongoing: { label: '进行中', cls: 'ongoing' },
    ended: { label: '已结束', cls: 'ended' },
    tbd: { label: '时间待定', cls: 'tbd' },
  };

  const LEVEL_ORDER = { '超级': 4, '一级': 3, '二级': 2, '三级': 1 };

  const el = {
    detail: document.getElementById('detail'),
    btnTz: document.getElementById('btnTz'),
    btnIcsOne: document.getElementById('btnIcsOne'),
    btnPrint: document.getElementById('btnPrint'),
    btnMine: document.getElementById('btnMine'),
  };

  /* 我的意向：与列表页共用同一个 localStorage 键 */
  const MINE_KEY = 'ctf-my-intent';
  function readMine() {
    try {
      const raw = JSON.parse(localStorage.getItem(MINE_KEY) || '[]');
      return new Set(Array.isArray(raw) ? raw : []);
    } catch (e) { return new Set(); }
  }
  function writeMine(set) {
    try { localStorage.setItem(MINE_KEY, JSON.stringify([...set])); } catch (e) { /* ignore */ }
  }
  function syncMineBtn() {
    if (!el.btnMine || !state.event) return;
    const on = readMine().has(state.event.id);
    el.btnMine.textContent = on ? '★ 已加入我的意向' : '☆ 加入我的意向';
    el.btnMine.classList.toggle('on', on);
  }

  const state = { tzIndex: 0, event: null, catalogEntry: null, catalog: null, events: null };

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function tz() {
    const p = TZ_PRESETS[state.tzIndex];
    if (p.id === 'local') {
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; }
    }
    return p.id;
  }

  function safeUrl(u) {
    if (!u) return '';
    try {
      const x = new URL(u, location.href);
      return (x.protocol === 'http:' || x.protocol === 'https:') ? x.href : '';
    } catch (e) { return ''; }
  }

  function dt(iso, zone, withTz) {
    if (!iso) return null;
    return C.fmtDT(iso, zone, withTz);
  }

  function tzRow(label, iso) {
    const zones = [
      ['Asia/Shanghai', '北京时间'],
      ['UTC', 'UTC'],
    ];
    try {
      const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (local && !zones.some((z) => z[0] === local)) zones.push([local, '本机（' + local + '）']);
    } catch (e) { /* ignore */ }

    const cells = zones.map(([z, name]) => {
      const v = dt(iso, z, true);
      return `<td>${v ? esc(v) : '<span class="na">待定</span>'}</td>`;
    }).join('');
    return `<tr><th>${esc(label)}</th>${cells}</tr>`;
  }

  function headRow() {
    const zones = [['Asia/Shanghai', '北京时间'], ['UTC', 'UTC']];
    let extra = '';
    try {
      const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (local && !zones.some((z) => z[0] === local)) extra = `<th>本机（${esc(local)}）</th>`;
    } catch (e) { /* ignore */ }
    return `<tr><th>时间节点</th>${zones.map((z) => `<th>${z[1]}</th>`).join('')}${extra}</tr>`;
  }

  /* ---------------- 赛事详情 ---------------- */
  function renderEvent(ev) {
    const st = C.computeStatus(ev, Date.now());
    const sm = STATUS_META[st.status];
    const derived = ev.registrationBasis === 'derived';

    const lvl = ev.nucLevel
      ? `<a class="lvl lvl-${LEVEL_ORDER[ev.nucLevel] || 0}" href="event.html?nuc=${ev.nucNo}" title="中北大学学科竞赛目录第 ${ev.nucNo} 项">中北认定 · ${esc(ev.nucLevel)}</a>`
      : '';

    const catBadge = `<span class="badge cat ${esc(ev.category)}">${esc(CATEGORY_LABEL[ev.category] || ev.category)}</span>`;

    const meta = [
      ev.organizer, ev.region, ev.format,
      ev.onsite != null ? (ev.onsite ? '线下' : '线上') : null,
      ev.restrictions,
    ].filter(Boolean).map(esc).join(' · ');

    const intentBadge = ev.intent
      ? `<span class="badge intent" title="实验室有意向参加${ev.intentGroup ? ' · ' + esc(ev.intentGroup) : ''}">★ 同学意向</span>`
      : '';

    const badges = `
      <span class="badge status ${sm.cls}">${esc(sm.label)}</span>
      <span class="badge reg ${st.reg === 'open' ? 'open' : st.reg === 'closed' ? 'closed' : 'unknown'}">${
        derived && st.reg === 'open' ? '报名中 · 推定' : {
          open: '报名进行中', closed: '报名已截止', notopen: '报名未开始', unknown: '报名时间待定',
        }[st.reg]}</span>
      ${catBadge}${lvl}${intentBadge}`;

    const regNotice = {
      stated: `<div class="callout ok"><b>报名字段：官方明确</b>报名起止时间取自赛事原文或官方通知，下方附原文摘录，可直接核实。</div>`,
      derived: `<div class="callout warn"><b>报名字段：推定</b>官方未公布报名时间。表中的「报名截止」是按
        <b>「CTF 平台惯例：报名通道开放至开赛时刻」</b>推定的，<b>不是事实</b>，请以赛事官网为准。</div>`,
      unknown: `<div class="callout bad"><b>报名字段：未知</b>官方未公布任何报名时间信息，且无比赛时间可供推定。</div>`,
    }[ev.registrationBasis || 'unknown'];

    const rows = [];
    const kv = (k, v) => {
      if (v != null && v !== '') rows.push(`<tr><th>${esc(k)}</th><td colspan="3">${v}</td></tr>`);
    };

    const links = [...new Set([ev.officialUrl, ev.ctftimeUrl, ...(ev.sources || [])]
      .map(safeUrl).filter(Boolean))];
    const linkHtml = links.length
      ? links.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`).join('<br>')
      : null;

    kv('主办 / 组织方', esc(ev.organizer));
    kv('地区', esc(ev.region));
    kv('赛制', esc(ev.format));
    kv('参赛限制', esc(ev.restrictions));
    kv('分类', esc(ev.subCategory || CATEGORY_LABEL[ev.category]));
    kv('奖项', esc(ev.prizes));
    kv('赛程时长', ev.durationHours ? ev.durationHours + ' 小时' : null);
    kv('往年赛期参考', ev.dateHint ? esc(ev.dateHint) : null);
    kv('CTFtime 权重', ev.weight != null && ev.weight > 0 ? ev.weight.toFixed(2) : null);
    kv('中北大学认定', ev.nucLevel
      ? `<a class="lvl lvl-${LEVEL_ORDER[ev.nucLevel] || 0}" href="event.html?nuc=${ev.nucNo}">${esc(ev.nucLevel)}</a>（目录第 ${ev.nucNo} 项 · ${esc(ev.nucDept || '')} · 负责人 ${esc((ev.nucOwners || []).join('、'))}）`
      : '<span class="na">该赛事未列入《中北大学学科竞赛目录（2026版）》</span>');
    kv('参考链接', linkHtml);
    kv('数据可信度', `<span class="conf ${esc(ev.confidence || 'medium')}">${esc(CONF_LABEL[ev.confidence] || ev.confidence)}</span>`);

    const detailTable = `
      <table class="kv-table">
        <tbody>${rows.join('')}</tbody>
      </table>`;

    const evidence = ev.evidence
      ? `<section class="det-block"><h3>原文摘录</h3><blockquote>${esc(ev.evidence)}</blockquote></section>`
      : '';

    const regNote = ev.registrationNote
      ? `<section class="det-block"><h3>报名说明</h3><p>${esc(ev.registrationNote)}</p></section>`
      : '';

    const extraNote = ev.note
      ? `<section class="det-block"><h3>备注</h3><p>${esc(ev.note)}</p></section>`
      : '';

    const countdown = (() => {
      const now = Date.now();
      if (st.contest === 'ended') {
        const d = Math.floor((now - st.ce) / 86400000);
        return d <= 0 ? '刚刚结束' : `已结束 ${d} 天`;
      }
      if (st.contest === 'ongoing') {
        return st.ce == null ? '正在进行中' : `进行中 · 距结束 ${C.human(st.ce - now)}`;
      }
      if (st.contest === 'tbd') return '比赛时间待官方公布';
      return `距开赛 ${C.human(st.cs - now)}`;
    })();

    el.detail.innerHTML = `
      <header class="det-head">
        <div class="det-badges">${badges}</div>
        <h1>${esc(ev.title)}</h1>
        ${meta ? `<p class="det-meta">${meta}</p>` : ''}
        <p class="det-countdown">${esc(countdown)}</p>
      </header>

      ${regNotice}

      <section class="det-block">
        <h2>时间节点（同一时刻的多时区对照）</h2>
        <table class="tz-table">
          <thead>${headRow()}</thead>
          <tbody>
            ${tzRow('开始报名', ev.registrationStart)}
            ${tzRow('报名截止', ev.registrationEnd)}
            ${tzRow('比赛开始', ev.contestStart)}
            ${tzRow('比赛结束', ev.contestEnd)}
          </tbody>
        </table>
        <p class="fine-print">
          时间以带时区的绝对时刻存储，因此三个时区显示的是<b>同一时刻</b>，不存在换算误差。
          报名字段：<b>${esc(REG_BASIS_LABEL[ev.registrationBasis || 'unknown'])}</b>。
        </p>
      </section>

      <section class="det-block">
        <h2>赛事信息</h2>
        ${detailTable}
      </section>

      ${regNote}${extraNote}${evidence}

      <p class="fine-print">
        赛事 ID：<code>${esc(ev.id)}</code> ·
        数据生成于 ${esc(C.fmtDT(new Date().toISOString(), 'Asia/Shanghai', true))} ·
        赛事时间以主办方最终通知为准。
      </p>
    `;
  }

  /* ---------------- 目录条目详情 ---------------- */
  function renderCatalog(entry) {
    const related = (state.events || []).filter((e) => e.nucNo === entry.no);

    const relatedHtml = related.length
      ? `<ul class="rel-list">${related.map((e) => {
        const st = C.computeStatus(e, Date.now());
        const sm = STATUS_META[st.status];
        return `<li>
            <a href="event.html?id=${encodeURIComponent(e.id)}">${esc(e.title)}</a>
            <span class="badge status ${sm.cls}">${esc(sm.label)}</span>
            <span class="rel-time">${e.contestStart ? esc(dt(e.contestStart, tz(), true)) : '时间待定'}</span>
          </li>`;
      }).join('')}</ul>`
      : `<p class="na">日历中暂未收录该竞赛 2026 年的具体赛程。</p>`;

    const official = safeUrl(entry.url);

    el.detail.innerHTML = `
      <header class="det-head">
        <div class="det-badges">
          <span class="lvl lvl-${LEVEL_ORDER[entry.level] || 0}">中北认定 · ${esc(entry.level)}</span>
          ${entry.security ? '<span class="badge cat college">网络安全相关</span>' : ''}
        </div>
        <h1>${esc(entry.name)}</h1>
        <p class="det-meta">
          《中北大学学科竞赛目录（2026版）》第 ${entry.no} 项 ·
          负责单位 ${esc(entry.dept)} ·
          负责人 ${esc((entry.owners || []).join('、') || '—')}
        </p>
      </header>

      <div class="callout">
        该目录仅提供「竞赛名称 / 负责单位 / 级别 / 国赛官网 / 负责人」，<b>不含报名与比赛日期</b>。
        具体时间请以官网通知为准。
      </div>

      <section class="det-block">
        <h2>目录信息</h2>
        <table class="kv-table">
          <tbody>
            <tr><th>目录序号</th><td colspan="3">${entry.no}</td></tr>
            <tr><th>级别</th><td colspan="3"><span class="lvl lvl-${LEVEL_ORDER[entry.level] || 0}">${esc(entry.level)}</span></td></tr>
            <tr><th>负责单位</th><td colspan="3">${esc(entry.dept)}</td></tr>
            <tr><th>竞赛负责人</th><td colspan="3">${esc((entry.owners || []).join('、') || '—')}</td></tr>
            <tr><th>国赛参赛官网</th><td colspan="3">${
              official ? `<a href="${esc(official)}" target="_blank" rel="noopener">${esc(official)}</a>` : '<span class="na">目录标注「无」或「暂未公布」</span>'}</td></tr>
            ${entry.contestStart ? `<tr><th>2026 年比赛时间</th><td colspan="3">${
              esc(dt(entry.contestStart, tz(), true))} → ${esc(dt(entry.contestEnd, tz(), true) || '')}</td></tr>` : ''}
            ${(entry.registrationStart || entry.registrationEnd) ? `<tr><th>2026 年报名时间</th><td colspan="3">${
              esc(dt(entry.registrationStart, tz(), true) || '待定')} → ${esc(dt(entry.registrationEnd, tz(), true) || '待定')}</td></tr>` : ''}
            ${entry.dateHint ? `<tr><th>往年赛期参考</th><td colspan="3">${esc(entry.dateHint)}</td></tr>` : ''}
            ${entry.evidence ? `<tr><th>原文摘录</th><td colspan="3"><blockquote>${esc(entry.evidence)}</blockquote></td></tr>` : ''}
            ${(entry.sources && entry.sources.length) ? `<tr><th>来源</th><td colspan="3">${
              entry.sources.map((u) => safeUrl(u) ? `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener">${esc(u)}</a>` : esc(u)).join('<br>')}</td></tr>` : ''}
            ${entry.note ? `<tr><th>备注</th><td colspan="3">${esc(entry.note)}</td></tr>` : ''}
          </tbody>
        </table>
      </section>

      <section class="det-block">
        <h2>本日历已收录的对应赛事</h2>
        ${relatedHtml}
      </section>

      <p class="fine-print">
        来源：《中北大学学科竞赛目录（2026版）》PDF 第 ${Math.min(12, Math.floor((entry.no - 1) / 11) + 1)} 页 ·
        目录条目 ID：<code>${esc(entry.id)}</code>
      </p>
    `;
  }

  /* ---------------- 导出 ---------------- */
  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const icsDate = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  function exportOne() {
    const ev = state.event;
    if (!ev) return;
    const st = C.computeStatus(ev, Date.now());
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CTF Calendar 2026//CN//', 'CALSCALE:GREGORIAN'];
    const stamp = icsDate(Date.now());
    if (st.cs != null) {
      L.push('BEGIN:VEVENT',
        `UID:${icsEsc(ev.id)}@ctf-calendar`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${icsDate(st.cs)}`,
        `DTEND:${icsDate(st.ce != null ? st.ce : st.cs + 3600000)}`,
        `SUMMARY:${icsEsc('[CTF] ' + ev.title)}`,
        `DESCRIPTION:${icsEsc([ev.organizer, ev.format, ev.officialUrl].filter(Boolean).join(' | '))}`,
        ev.officialUrl ? `URL:${ev.officialUrl}` : '',
        'END:VEVENT');
    }
    if (st.re != null) {
      L.push('BEGIN:VEVENT',
        `UID:${icsEsc(ev.id)}-reg@ctf-calendar`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${new Date(st.re).toISOString().slice(0, 10).replace(/-/g, '')}`,
        `SUMMARY:${icsEsc('[报名截止] ' + ev.title)}`,
        `DESCRIPTION:${icsEsc(ev.registrationNote || '')}`,
        'END:VEVENT');
    }
    L.push('END:VCALENDAR');
    download(`${ev.id}.ics`, L.filter(Boolean).join('\r\n'), 'text/calendar;charset=utf-8');
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    const p = new URLSearchParams(location.search);
    const id = p.get('id');
    const nuc = p.get('nuc');

    try {
      const [evRes, nucRes] = await Promise.all([
        fetch('data/events.json', { cache: 'no-cache' }),
        fetch('data/nuc-catalog.json', { cache: 'no-cache' }).catch(() => null),
      ]);
      const evPayload = await evRes.json();
      state.events = evPayload.events || [];
      if (nucRes && nucRes.ok) {
        const nucPayload = await nucRes.json();
        state.catalog = nucPayload.entries || [];
      }
    } catch (err) {
      el.detail.innerHTML = `<div class="empty"><div class="empty-ico">⚠️</div>
        <h2>数据加载失败</h2><p>${esc(err.message)}</p>
        <p class="muted">请通过 HTTP 服务访问本页。</p></div>`;
      return;
    }

    if (nuc) {
      const entry = (state.catalog || []).find((c) => String(c.no) === String(nuc));
      if (!entry) {
        el.detail.innerHTML = `<div class="empty"><div class="empty-ico">🔍</div>
          <h2>未找到目录条目</h2><p>序号 ${esc(nuc)} 不存在。</p></div>`;
        el.btnIcsOne.hidden = true;
        return;
      }
      state.catalogEntry = entry;
      document.title = `${entry.name} · 中北大学竞赛目录`;
      renderCatalog(entry);
      el.btnIcsOne.hidden = true;
      return;
    }

    const ev = state.events.find((e) => e.id === id);
    if (!ev) {
      el.detail.innerHTML = `<div class="empty"><div class="empty-ico">🔍</div>
        <h2>未找到该赛事</h2><p>ID「${esc(id || '')}」不存在或已移除。</p>
        <p><a class="btn" href="index.html">返回列表</a></p></div>`;
      el.btnIcsOne.hidden = true;
      return;
    }
    state.event = ev;
    document.title = `${ev.title} · 赛事详情`;
    renderEvent(ev);
    syncMineBtn();
  }

  function bind() {
    if (el.btnMine) {
      el.btnMine.addEventListener('click', () => {
        if (!state.event) return;
        const s = readMine();
        if (s.has(state.event.id)) s.delete(state.event.id); else s.add(state.event.id);
        writeMine(s);
        syncMineBtn();
      });
    }
    el.btnTz.addEventListener('click', () => {
      state.tzIndex = (state.tzIndex + 1) % TZ_PRESETS.length;
      el.btnTz.textContent = '时区：' + TZ_PRESETS[state.tzIndex].label;
      if (state.event) renderEvent(state.event);
    });
    el.btnIcsOne.addEventListener('click', exportOne);
    el.btnPrint.addEventListener('click', () => window.print());
  }

  document.addEventListener('DOMContentLoaded', () => { bind(); boot(); });
})();
