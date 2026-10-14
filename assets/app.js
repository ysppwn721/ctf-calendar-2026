/* ============================================================
   CTF 赛事日历 2026 — 界面层
   纯逻辑见 assets/core.js（浏览器与 Node 测试共用）
   功能：关键词检索 / 时间段检索 / 状态实时判定 / 时区切换 / 导出
   ============================================================ */
(function () {
  'use strict';

  const C = window.CTF_CORE;
  const { CATEGORY_LABEL, CONF_LABEL } = C;

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

  const state = {
    events: [], stats: null,
    tzIndex: 0, theme: 'dark',
    q: '', cat: '', rangeField: 'contest', from: '', to: '',
    overlap: 'overlap', sort: 'start-asc', status: 'all',
    nowOverride: null,
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    q: $('q'), qClear: $('qClear'), cat: $('cat'), rangeField: $('rangeField'),
    from: $('from'), to: $('to'), overlap: $('overlap'), sort: $('sort'),
    list: $('list'), empty: $('empty'), count: $('count'), stats: $('stats'),
    activeFilters: $('activeFilters'), statusChips: $('statusChips'),
    btnTz: $('btnTz'), btnTheme: $('btnTheme'), btnReset: $('btnReset'),
    btnReset2: $('btnReset2'), btnCsv: $('btnCsv'), btnIcs: $('btnIcs'),
    genAt: $('genAt'), statTotal: $('statTotal'), cardTpl: $('cardTpl'),
  };

  function effectiveTz() {
    const p = TZ_PRESETS[state.tzIndex];
    if (p.id === 'local') {
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
      catch { return 'UTC'; }
    }
    return p.id;
  }

  const now = () => (state.nowOverride != null ? state.nowOverride : Date.now());
  const TZ = () => effectiveTz();

  /* ---------------- 渲染工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function safeUrl(u) {
    if (!u) return '';
    try {
      const url = new URL(u, location.href);
      return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : '';
    } catch { return ''; }
  }

  function shortUrl(u) {
    try { const x = new URL(u); return x.hostname + (x.pathname.length > 1 ? x.pathname.slice(0, 28) : ''); }
    catch { return u; }
  }

  function slot(iso, extraNote, cls) {
    const v = C.fmtDT(iso, TZ(), false);
    if (v == null) return `<span class="slot-value na">待定</span>`;
    const ab = C.tzAbbr(TZ(), new Date(C.toTs(iso)));
    return `<span class="slot-value ${cls || ''}">${esc(v)}<em>${esc(ab)}${extraNote ? ' · ' + esc(extraNote) : ''}</em></span>`;
  }

  function countdownText(st) {
    const t = now();
    if (st.contest === 'ended') {
      const days = Math.floor((t - st.ce) / 86400000);
      return days <= 0 ? '刚刚结束' : `已结束 ${days} 天`;
    }
    if (st.contest === 'ongoing') {
      if (st.ce == null) return '正在进行中（结束时间未公布）';
      return `进行中 · 距结束 <span class="cd soon">${C.human(st.ce - t)}</span>`;
    }
    if (st.contest === 'tbd') return '比赛时间待官方公布';
    const diff = st.cs - t;
    const cls = diff < 7 * 86400000 ? 'cd soon' : 'cd';
    let extra = '';
    if (st.reg === 'open' && st.re != null) {
      extra = ` · 报名还剩 <span class="${cls}">${C.human(st.re - t)}</span>`;
    } else if (st.reg === 'notopen' && st.rs != null) {
      extra = ` · 报名将于 <span class="cd">${C.fmtDT(new Date(st.rs).toISOString(), TZ(), false)}</span> 开放`;
    }
    return `距开赛 <span class="${cls}">${C.human(diff)}</span>${extra}`;
  }

  function renderCard(ev, st) {
    const node = el.cardTpl.content.firstElementChild.cloneNode(true);
    node.classList.add('is-' + st.status);

    node.querySelector('.card-title').textContent = ev.title;

    const metaBits = [];
    if (ev.organizer) metaBits.push(`<span>${esc(ev.organizer)}</span>`);
    if (ev.region) metaBits.push(`<span>${esc(ev.region)}</span>`);
    if (ev.format) metaBits.push(`<span>${esc(ev.format)}</span>`);
    if (ev.onsite != null) metaBits.push(`<span>${ev.onsite ? '线下' : '线上'}</span>`);
    node.querySelector('.card-meta').innerHTML = metaBits.join('<span class="sep">·</span>');

    const sm = STATUS_META[st.status];
    const badges = node.querySelector('.card-badges');
    const sBadge = badges.querySelector('.badge.status');
    sBadge.textContent = sm.label;
    sBadge.classList.add(sm.cls);

    const derived = ev.registrationBasis === 'derived';
    const regBadge = badges.querySelector('.badge.reg');
    const regMeta = {
      open: ['报名进行中', 'open'],
      closed: ['报名已截止', 'closed'],
      notopen: ['报名未开始', 'notopen'],
      unknown: ['报名时间待定', 'unknown'],
    }[st.reg];
    regBadge.textContent = derived && st.reg === 'open' ? '报名中 · 推定' : regMeta[0];
    regBadge.classList.add(regMeta[1]);
    if (derived) regBadge.title = '官方未公布报名截止时间；此处按「报名通道开放至开赛时刻」惯例推定，仅供参考。';

    const catBadge = document.createElement('span');
    catBadge.className = 'badge cat ' + ev.category;
    catBadge.textContent = CATEGORY_LABEL[ev.category] || ev.category;
    badges.appendChild(catBadge);

    node.querySelector('.reg-start').outerHTML = slot(ev.registrationStart, derived ? '官方未公布' : '', derived ? 'derived' : '');
    node.querySelector('.reg-end').outerHTML = slot(ev.registrationEnd, derived ? '推定值' : '', derived ? 'derived' : '');
    node.querySelector('.c-start').outerHTML = slot(ev.contestStart);
    node.querySelector('.c-end').outerHTML = slot(ev.contestEnd);

    node.querySelector('.countdown').innerHTML = countdownText(st);

    const rows = [];
    if (ev.registrationNote) rows.push(['报名说明', esc(ev.registrationNote)]);
    rows.push(['报名字段', {
      stated: '<span class="conf high">官方明确</span> 报名起止时间取自赛事原文/官方通知',
      derived: '<span class="conf medium">推定</span> 官方未公布报名时间，按「报名通道开放至开赛时刻」惯例推定，请以官网为准',
      unknown: '<span class="conf low">未知</span> 官方未公布任何报名时间信息',
    }[ev.registrationBasis || 'unknown']]);
    if (ev.note) rows.push(['备注', esc(ev.note)]);
    if (ev.prizes) rows.push(['奖项', esc(ev.prizes)]);
    if (ev.restrictions) rows.push(['参赛限制', esc(ev.restrictions)]);
    if (ev.weight != null && ev.weight > 0) rows.push(['CTFtime 权重', ev.weight.toFixed(2)]);
    if (ev.durationHours) rows.push(['赛程时长', ev.durationHours + ' 小时']);
    if (ev.subCategory) rows.push(['分类', esc(ev.subCategory)]);
    if ((ev.aliases || []).length) rows.push(['别名', esc(ev.aliases.join(' / '))]);

    const linkSet = new Set();
    [ev.officialUrl, ev.ctftimeUrl, ...(ev.sources || [])].forEach((s) => {
      const u = safeUrl(s); if (u) linkSet.add(u);
    });
    if (linkSet.size) {
      rows.push(['参考链接', [...linkSet].map((u) =>
        `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(shortUrl(u))}</a>`).join(' · ')]);
    }

    let html = rows.map(([k, v]) =>
      `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${v}</span></div>`).join('');

    const conf = ev.confidence || 'medium';
    html += `<div class="kv"><span class="k">数据可信度</span><span class="v">` +
      `<span class="conf ${esc(conf)}">${esc(CONF_LABEL[conf] || conf)}</span>` +
      (ev.evidence ? `<blockquote>${esc(String(ev.evidence).slice(0, 400))}</blockquote>` : '') +
      `</span></div>`;
    html += `<div class="kv"><span class="k">赛事 ID</span><span class="v">${esc(ev.id)}</span></div>`;
    node.querySelector('.more-body').innerHTML = html;
    return node;
  }

  /* ---------------- 筛选 ---------------- */
  function decorate() {
    const t = now();
    return state.events.map((ev) => ({ ev, st: C.computeStatus(ev, t), hay: C.haystack(ev) }));
  }

  function filterList(decorated) {
    const tz = TZ();
    const fromTs = C.dayStart(state.from, tz);
    const toTs = C.dayEnd(state.to, tz);
    const groups = C.tokenizeQuery(state.q);
    return decorated.filter((d) =>
      (!state.cat || d.ev.category === state.cat) &&
      C.statusMatches(d.st, state.status) &&
      C.queryMatches(d.hay, groups) &&
      C.rangeMatches(d.st, {
        field: state.rangeField, fromTs, toTs, mode: state.overlap,
      }));
  }

  function buildFilterSummary(nGroups) {
    const bits = [];
    if (state.cat) bits.push('类型：' + CATEGORY_LABEL[state.cat]);
    if (state.status !== 'all') bits.push('状态：' + (STATUS_META[state.status] || {}).label);
    if (nGroups) bits.push(`关键词 ${nGroups} 组`);
    if (state.from || state.to) bits.push(`时间 ${state.from || '…'} ~ ${state.to || '…'}`);
    return bits.length ? '　·　' + bits.join('　·　') : '';
  }

  function renderStats(decorated) {
    const c = C.summarize(decorated);
    const cards = [
      ['s-total', c.total, '收录赛事'],
      ['s-reg', c['reg-open'], '正在报名'],
      ['s-ongoing', c.ongoing, '进行中'],
      ['s-upcoming', c.upcoming, '未开始'],
      ['s-ended', c.ended, '已结束'],
      ['s-tbd', c.tbd, '时间待定'],
    ];
    el.stats.innerHTML = cards.map(([cls, num, lbl]) =>
      `<div class="stat ${cls}"><div class="stat-num">${num}</div><div class="stat-lbl">${lbl}</div></div>`).join('');
  }

  /* ---------------- 主渲染 ---------------- */
  function apply() {
    const decorated = decorate();
    const filtered = C.sortDecorated(filterList(decorated), state.sort);

    el.count.textContent = String(filtered.length);
    el.activeFilters.textContent = buildFilterSummary(C.tokenizeQuery(state.q).length);

    el.list.innerHTML = '';
    if (!filtered.length) {
      el.empty.hidden = false;
    } else {
      el.empty.hidden = true;
      const byMonth = new Map();
      for (const d of filtered) {
        const k = C.monthKey(d.ev.contestStart, TZ());
        if (!byMonth.has(k)) byMonth.set(k, []);
        byMonth.get(k).push(d);
      }
      const frag = document.createDocumentFragment();
      for (const [k, arr] of byMonth) {
        const g = document.createElement('section');
        g.className = 'month-group';
        const head = document.createElement('div');
        head.className = 'month-head';
        const label = k === 'zzz-tbd' ? '时间待定' : k.replace('-', ' 年 ') + ' 月';
        head.innerHTML = `<span>${esc(label)}</span><span class="mcount">${arr.length} 场</span><span class="line"></span>`;
        g.appendChild(head);
        for (const d of arr) g.appendChild(renderCard(d.ev, d.st));
        frag.appendChild(g);
      }
      el.list.appendChild(frag);
    }
    renderStats(decorated);
    syncUrl();
  }

  /* ---------------- URL ---------------- */
  function syncUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cat) p.set('cat', state.cat);
    if (state.status !== 'all') p.set('st', state.status);
    if (state.from) p.set('from', state.from);
    if (state.to) p.set('to', state.to);
    if (state.rangeField !== 'contest') p.set('rf', state.rangeField);
    if (state.overlap !== 'overlap') p.set('ov', state.overlap);
    if (state.sort !== 'start-asc') p.set('sort', state.sort);
    if (state.tzIndex !== 0) p.set('tz', String(state.tzIndex));
    const qs = p.toString();
    history.replaceState(null, '', qs ? '?' + qs : location.pathname);
  }

  function loadUrl() {
    const p = new URLSearchParams(location.search);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('cat')) state.cat = p.get('cat');
    if (p.get('st')) state.status = p.get('st');
    if (p.get('from')) state.from = p.get('from');
    if (p.get('to')) state.to = p.get('to');
    if (p.get('rf')) state.rangeField = p.get('rf');
    if (p.get('ov')) state.overlap = p.get('ov');
    if (p.get('sort')) state.sort = p.get('sort');
    if (p.get('tz')) state.tzIndex = Math.min(TZ_PRESETS.length - 1, Math.max(0, +p.get('tz') || 0));
    if (p.get('now')) { const t = new Date(p.get('now')).getTime(); if (!Number.isNaN(t)) state.nowOverride = t; }
  }

  function syncControls() {
    el.q.value = state.q;
    el.qClear.hidden = !state.q;
    el.cat.value = state.cat;
    el.rangeField.value = state.rangeField;
    el.from.value = state.from;
    el.to.value = state.to;
    el.overlap.value = state.overlap;
    el.sort.value = state.sort;
    el.btnTz.textContent = '时区：' + TZ_PRESETS[state.tzIndex].label;
    [...el.statusChips.querySelectorAll('.chip')].forEach((b) => {
      b.classList.toggle('on', b.dataset.status === state.status);
    });
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

  function exportCsv() {
    const rows = C.sortDecorated(filterList(decorate()), state.sort);
    const head = ['赛事名称', '类型', '主办方', '地区', '赛制', '开始报名', '报名截止', '报名依据',
      '比赛开始', '比赛结束', '状态', '报名状态', '官网', '可信度', '来源'];
    const q = (s) => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
    const lines = [head.map(q).join(',')];
    const tz = TZ();
    for (const { ev, st } of rows) {
      lines.push([
        ev.title, CATEGORY_LABEL[ev.category] || ev.category, ev.organizer, ev.region, ev.format,
        C.fmtDT(ev.registrationStart, tz, false) || '待定',
        C.fmtDT(ev.registrationEnd, tz, false) || '待定',
        C.REG_BASIS_LABEL[ev.registrationBasis || 'unknown'],
        C.fmtDT(ev.contestStart, tz, false) || '待定',
        C.fmtDT(ev.contestEnd, tz, false) || '待定',
        STATUS_META[st.status].label,
        { open: '报名中', closed: '已截止', notopen: '未开始', unknown: '待定' }[st.reg],
        ev.officialUrl, CONF_LABEL[ev.confidence] || ev.confidence, (ev.sources || []).join(' '),
      ].map(q).join(','));
    }
    download(`ctf-calendar-2026-${tz.replace(/\//g, '_')}.csv`,
      '\uFEFF' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  }

  const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const icsDate = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  function exportIcs() {
    const rows = C.sortDecorated(filterList(decorate()), state.sort);
    const stamp = icsDate(Date.now());
    const L = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CTF Calendar 2026//CN//',
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:CTF 赛事日历 2026',
    ];
    for (const { ev, st } of rows) {
      if (st.cs != null) {
        const end = st.ce != null ? st.ce : st.cs + 3600000;
        L.push('BEGIN:VEVENT',
          `UID:${icsEsc(ev.id)}-contest@ctf-calendar`,
          `DTSTAMP:${stamp}`,
          `DTSTART:${icsDate(st.cs)}`,
          `DTEND:${icsDate(end)}`,
          `SUMMARY:${icsEsc('[CTF] ' + ev.title)}`,
          `DESCRIPTION:${icsEsc([ev.organizer, ev.format, '状态: ' + STATUS_META[st.status].label, ev.officialUrl].filter(Boolean).join(' | '))}`,
          ev.officialUrl ? `URL:${ev.officialUrl}` : '',
          'END:VEVENT');
      }
      if (st.re != null) {
        L.push('BEGIN:VEVENT',
          `UID:${icsEsc(ev.id)}-regdeadline@ctf-calendar`,
          `DTSTAMP:${stamp}`,
          `DTSTART;VALUE=DATE:${new Date(st.re).toISOString().slice(0, 10).replace(/-/g, '')}`,
          `SUMMARY:${icsEsc('[报名截止] ' + ev.title)}`,
          `DESCRIPTION:${icsEsc(ev.registrationNote || ev.officialUrl || '')}`,
          'END:VEVENT');
      }
    }
    L.push('END:VCALENDAR');
    download('ctf-calendar-2026.ics', L.filter(Boolean).join('\r\n'), 'text/calendar;charset=utf-8');
  }

  /* ---------------- 交互 ---------------- */
  let debounce;
  function bind() {
    el.q.addEventListener('input', () => {
      state.q = el.q.value.trim();
      el.qClear.hidden = !state.q;
      clearTimeout(debounce);
      debounce = setTimeout(apply, 180);
    });
    el.qClear.addEventListener('click', () => {
      el.q.value = ''; state.q = ''; el.qClear.hidden = true; apply(); el.q.focus();
    });
    const onSel = (node, key) => node.addEventListener('change', () => { state[key] = node.value; apply(); });
    onSel(el.cat, 'cat');
    onSel(el.rangeField, 'rangeField');
    onSel(el.overlap, 'overlap');
    onSel(el.sort, 'sort');
    el.from.addEventListener('change', () => { state.from = el.from.value; apply(); });
    el.to.addEventListener('change', () => { state.to = el.to.value; apply(); });

    el.statusChips.addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      state.status = b.dataset.status;
      syncControls(); apply();
    });

    document.querySelectorAll('[data-quick]').forEach((b) => {
      b.addEventListener('click', () => {
        const tz = TZ();
        const today = new Date();
        const mk = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
        const add = (k) => new Date(today.getTime() + k * 86400000);
        const mode = b.dataset.quick;
        state.rangeField = 'contest';
        if (mode === 'today') { state.from = mk(today); state.to = mk(today); }
        else if (mode === 'week') { state.from = mk(today); state.to = mk(add(7)); }
        else if (mode === 'month') { state.from = mk(today); state.to = mk(add(30)); }
        else { state.from = ''; state.to = ''; }
        syncControls(); apply();
      });
    });

    el.btnTz.addEventListener('click', () => {
      state.tzIndex = (state.tzIndex + 1) % TZ_PRESETS.length;
      syncControls(); apply();
    });

    el.btnTheme.addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = state.theme;
      el.btnTheme.textContent = state.theme === 'dark' ? '🌙' : '☀️';
      try { localStorage.setItem('ctf-theme', state.theme); } catch (e) {}
    });

    const reset = () => {
      Object.assign(state, {
        q: '', cat: '', rangeField: 'contest', from: '', to: '',
        overlap: 'overlap', sort: 'start-asc', status: 'all',
      });
      syncControls(); apply();
    };
    el.btnReset.addEventListener('click', reset);
    el.btnReset2.addEventListener('click', reset);
    el.btnCsv.addEventListener('click', exportCsv);
    el.btnIcs.addEventListener('click', exportIcs);
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    loadUrl();
    try {
      const saved = localStorage.getItem('ctf-theme');
      if (saved) state.theme = saved;
    } catch (e) {}
    document.documentElement.dataset.theme = state.theme;
    el.btnTheme.textContent = state.theme === 'dark' ? '🌙' : '☀️';

    try {
      const res = await fetch('data/events.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const payload = await res.json();
      state.events = payload.events || [];
      state.stats = payload.stats || null;
      el.genAt.textContent = state.stats && state.stats.generatedAt
        ? C.fmtDT(state.stats.generatedAt, TZ(), true) : '—';
      el.statTotal.textContent = String(state.events.length);
    } catch (err) {
      el.list.innerHTML = `<div class="empty"><div class="empty-ico">⚠️</div>
        <h2>数据加载失败</h2><p>${esc(err.message)}</p>
        <p class="muted">请通过 HTTP 服务访问本页（<code>fetch</code> 无法从 <code>file://</code> 读取数据）。</p></div>`;
      return;
    }
    syncControls();
    bind();
    apply();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
