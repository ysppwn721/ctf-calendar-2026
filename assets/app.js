/* ============================================================
   CTF 赛事日历 2026 — 界面层
   纯逻辑见 assets/core.js（浏览器与 Node 测试共用）
   视图：① 赛事日历（检索/筛选/导出） ② 中北大学竞赛目录（含级别标注）
   ============================================================ */
(function () {
  'use strict';

  const C = window.CTF_CORE;
  const { CATEGORY_LABEL, CONF_LABEL } = C;
  const LEVEL_ORDER = { '超级': 4, '一级': 3, '二级': 2, '三级': 1 };

  const TZ_PRESETS = [
    { id: 'Asia/Shanghai', label: '北京时间' },
    { id: 'UTC', label: 'UTC' },
    { id: 'local', label: '本机时区' },
  ];

  const STATUS_META = {
    'reg-open': { label: '报名中', cls: 'reg-open' },
    'reg-closed': { label: '报名已截止', cls: 'upcoming' },
    upcoming: { label: '待开赛', cls: 'upcoming' },
    ongoing: { label: '进行中', cls: 'ongoing' },
    ended: { label: '已结束', cls: 'ended' },
    tbd: { label: '时间待定', cls: 'tbd' },
  };

  /* 分类定义：只按「参赛对象准入限制」划分，不按宣传文案里的关键词 */
  const CATEGORY_DESC = {
    'domestic-technical': '中国境内举办的竞赛（公开技术赛与全国性大学生学科竞赛）',
    'international-technical': '境外举办或无地域限定的公开赛（准入限制显示在副标签里，如「高校限定」「个人赛」「邀请制」）',
    catalog: '《中北大学学科竞赛目录（2026版）》收录的校内认定竞赛，覆盖各学科方向',
  };

  const state = {
    events: [], stats: null,
    nuc: [], nucStats: null,
    tab: 'calendar',
    tzIndex: 0, theme: 'dark',
    q: '', cat: '', level: '', rangeField: 'contest', from: '', to: '',
    overlap: 'overlap', sort: 'start-asc', status: 'all', openable: false,
    nq: '', nlevel: 'all', ndept: '', nsort: 'no-asc',
    nowOverride: null,
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    q: $('q'), qClear: $('qClear'), cat: $('cat'), catHint: $('catHint'), level: $('level'),
    rangeField: $('rangeField'), from: $('from'), to: $('to'),
    overlap: $('overlap'), sort: $('sort'),
    list: $('list'), empty: $('empty'), count: $('count'), stats: $('stats'),
    activeFilters: $('activeFilters'), statusChips: $('statusChips'),
    btnTz: $('btnTz'), btnTheme: $('btnTheme'), btnReset: $('btnReset'),
    btnReset2: $('btnReset2'), btnCsv: $('btnCsv'), btnIcs: $('btnIcs'),
    genAt: $('genAt'), statTotal: $('statTotal'), cardTpl: $('cardTpl'),
    // tabs
    tabCalendar: $('tabCalendar'), tabCatalog: $('tabCatalog'),
    viewCalendar: $('viewCalendar'), viewCatalog: $('viewCatalog'),
    tabNCalendar: $('tabNCalendar'), tabNCatalog: $('tabNCatalog'),
    // catalog
    nucTotal: $('nucTotal'), nucList: $('nucList'), nucEmpty: $('nucEmpty'),
    nucCount: $('nucCount'), nucActiveFilters: $('nucActiveFilters'),
    nq: $('nq'), nqClear: $('nqClear'), ndept: $('ndept'), nsort: $('nsort'),
    levelChips: $('levelChips'), nucReset: $('nucReset'), nucCsv: $('nucCsv'),
    nucPrint: $('nucPrint'), nucCrossRefHint: $('nucCrossRefHint'),
    nucRowTpl: $('nucRowTpl'),
  };

  function effectiveTz() {
    const p = TZ_PRESETS[state.tzIndex];
    if (p.id === 'local') {
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
      catch (e) { return 'UTC'; }
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
      const x = new URL(u, location.href);
      return (x.protocol === 'http:' || x.protocol === 'https:') ? x.href : '';
    } catch (e) { return ''; }
  }
  function shortUrl(u) {
    try { const x = new URL(u); return x.hostname + (x.pathname.length > 1 ? x.pathname.slice(0, 28) : ''); }
    catch (e) { return u; }
  }

  function levelBadge(lv, extraClass) {
    if (!lv) return '';
    return `<span class="lvl lvl-${LEVEL_ORDER[lv] || 0} ${extraClass || ''}">中北认定 · ${esc(lv)}</span>`;
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
    if (st.regVerified && st.reg === 'open' && st.re != null) {
      extra = ` · 报名还剩 <span class="${cls}">${C.human(st.re - t)}</span>`;
    } else if (st.regVerified && st.reg === 'notopen' && st.rs != null) {
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
    if (derived) {
      regBadge.textContent = '报名时间未公布';
      regBadge.classList.add('unknown');
      regBadge.title = '官方未公布报名起止时间；表中「报名截止」为按惯例的推定值，仅供参考。';
    } else {
      const regMeta = {
        open: ['报名进行中', 'open'],
        closed: ['报名已截止', 'closed'],
        notopen: ['报名未开始', 'notopen'],
        unknown: ['报名时间待定', 'unknown'],
      }[st.reg];
      regBadge.textContent = regMeta[0];
      regBadge.classList.add(regMeta[1]);
    }

    const catBadge = document.createElement('span');
    catBadge.className = 'badge cat ' + ev.category;
    catBadge.textContent = CATEGORY_LABEL[ev.category] || ev.category;
    badges.appendChild(catBadge);

    if (ev.nucLevel) {
      const lb = document.createElement('a');
      lb.className = `lvl lvl-${LEVEL_ORDER[ev.nucLevel] || 0}`;
      lb.href = `event.html?nuc=${ev.nucNo}`;
      lb.title = `《中北大学学科竞赛目录（2026版）》第 ${ev.nucNo} 项`;
      lb.textContent = `中北 · ${ev.nucLevel}`;
      badges.appendChild(lb);
    }

    node.querySelector('.reg-start').outerHTML = slot(ev.registrationStart, derived ? '官方未公布' : '', derived ? 'derived' : '');
    node.querySelector('.reg-end').outerHTML = slot(ev.registrationEnd, derived ? '推定值' : '', derived ? 'derived' : '');
    node.querySelector('.c-start').outerHTML = slot(ev.contestStart);
    node.querySelector('.c-end').outerHTML = slot(ev.contestEnd);

    const hint = ev.dateHint
      ? (ev.dateHint.length > 56 ? ev.dateHint.slice(0, 56) + '…' : ev.dateHint)
      : '';
    node.querySelector('.countdown').innerHTML = countdownText(st)
      + (hint ? ` <span class="date-hint" title="官方未公布 2026 年确切日期，此处为检索到的时段参考，非事实">参考：${esc(hint)}</span>` : '');
    const link = node.querySelector('.detail-link');
    if (link) link.href = `event.html?id=${encodeURIComponent(ev.id)}`;
    return node;
  }

  /* ---------------- 赛事筛选 ---------------- */
  function decorate() {
    const t = now();
    return state.events.map((ev) => ({ ev, st: C.computeStatus(ev, t), hay: C.haystack(ev) }));
  }

  function filterList(decorated) {
    const tz = TZ();
    const fromTs = C.dayStart(state.from, tz);
    const toTs = C.dayEnd(state.to, tz);
    const groups = C.tokenizeQuery(state.q);
    return decorated.filter((d) => {
      if (state.cat && d.ev.category !== state.cat) return false;
      if (state.level === 'none') { if (d.ev.nucLevel) return false; }
      else if (state.level) { if (d.ev.nucLevel !== state.level) return false; }
      // 独立开关：只看「报名通道现在开着」的（含推定的推定窗口）
      if (state.openable && d.st.reg !== 'open') return false;
      return C.statusMatches(d.st, state.status)
        && C.queryMatches(d.hay, groups)
        && C.rangeMatches(d.st, { field: state.rangeField, fromTs, toTs, mode: state.overlap });
    });
  }

  function buildFilterSummary(nGroups) {
    const bits = [];
    if (state.cat) bits.push('类型：' + CATEGORY_LABEL[state.cat]);
    if (state.level) bits.push('级别：' + (state.level === 'none' ? '目录未收录' : state.level));
    if (state.status !== 'all') bits.push('状态：' + (STATUS_META[state.status] || {}).label);
    if (state.openable) bits.push('只看现在可报名');
    if (nGroups) bits.push(`关键词 ${nGroups} 组`);
    if (state.from || state.to) bits.push(`时间 ${state.from || '…'} ~ ${state.to || '…'}`);
    return bits.length ? '　·　' + bits.join('　·　') : '';
  }

  /** 「现在可报名」计数：报名窗口尚未关闭（含推定窗口） */
  function updateOpenable(decorated) {
    const list = decorated || decorate();
    const n = list.filter((d) => d.st.reg === 'open').length;
    const badge = $('cntOpenable');
    if (badge) badge.textContent = String(n);
    const chip = $('chipOpenable');
    if (chip) chip.classList.toggle('on', state.openable);
  }

  function renderStats(decorated) {
    const c = C.summarize(decorated);
    const cards = [
      ['s-total', c.total, '收录赛事'],
      ['s-reg', c['reg-open'], '报名中'],
      ['s-regclosed', c['reg-closed'], '报名已截止'],
      ['s-upcoming', c.upcoming, '待开赛'],
      ['s-ongoing', c.ongoing, '进行中'],
      ['s-ended', c.ended, '已结束'],
      ['s-tbd', c.tbd, '时间待定'],
    ];
    el.stats.innerHTML = cards.map(([cls, num, lbl]) =>
      `<div class="stat ${cls}"><div class="stat-num">${num}</div><div class="stat-lbl">${lbl}</div></div>`).join('');
  }

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
    updateOpenable(decorated);
    syncUrl();
  }

  /* ---------------- 中北目录视图 ---------------- */
  function nucFiltered() {
    const groups = C.tokenizeQuery(state.nq);
    const list = state.nuc.filter((c) => {
      if (state.nlevel !== 'all' && c.level !== state.nlevel) return false;
      if (state.ndept && c.dept !== state.ndept) return false;
      if (groups.length) {
        const hay = [c.name, c.dept, (c.owners || []).join(' '), c.note, c.level,
          c.security ? '网络安全 安全' : ''].filter(Boolean).join(' ').toLowerCase();
        if (!C.queryMatches(hay, groups)) return false;
      }
      return true;
    });

    if (state.nsort === 'level') {
      list.sort((a, b) => (LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level]) || (a.no - b.no));
    } else if (state.nsort === 'name-asc') {
      list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    } else {
      list.sort((a, b) => a.no - b.no || a.name.localeCompare(b.name, 'zh-CN'));
    }
    return list;
  }

  function renderNuc() {
    const list = nucFiltered();
    el.nucCount.textContent = String(list.length);

    const bits = [];
    if (state.nlevel !== 'all') bits.push('级别：' + state.nlevel);
    if (state.ndept) bits.push('单位：' + state.ndept);
    if (state.nq) bits.push(`关键词 ${C.tokenizeQuery(state.nq).length} 组`);
    el.nucActiveFilters.textContent = bits.length ? '　·　' + bits.join('　·　') : '';

    el.nucList.innerHTML = '';
    if (!list.length) { el.nucEmpty.hidden = false; return; }
    el.nucEmpty.hidden = true;

    const frag = document.createDocumentFragment();
    for (const c of list) {
      const node = el.nucRowTpl.content.firstElementChild.cloneNode(true);
      node.dataset.level = c.level;
      node.querySelector('.nuc-no').textContent = c.no;
      node.querySelector('.nuc-name').textContent = c.name;

      const meta = [];
      if (c.dept) meta.push(esc(c.dept));
      if ((c.owners || []).length) meta.push('负责人 ' + esc(c.owners.join('、')));
      if (c.note) meta.push(esc(c.note));
      node.querySelector('.nuc-meta').innerHTML = meta.join('<span class="sep">·</span>');

      const lb = node.querySelector('.lvl');
      lb.textContent = c.level;
      lb.classList.add('lvl-' + (LEVEL_ORDER[c.level] || 0));

      const siteLink = node.querySelector('.nuc-link');
      const u = safeUrl(c.url);
      if (u) { siteLink.href = u; siteLink.title = c.url; }
      else { siteLink.hidden = true; }

      node.querySelector('.nuc-detail').href = `event.html?nuc=${c.no}`;
      frag.appendChild(node);
    }
    el.nucList.appendChild(frag);
  }

  function initCatalog() {
    el.nucTotal.textContent = String(state.nuc.length);
    el.tabNCatalog.textContent = String(state.nuc.length);

    const counts = {};
    for (const c of state.nuc) counts[c.level] = (counts[c.level] || 0) + 1;
    document.querySelectorAll('[data-cnt]').forEach((b) => {
      b.textContent = String(counts[b.dataset.cnt] || 0);
    });

    const depts = [...new Set(state.nuc.map((c) => c.dept))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    el.ndept.innerHTML = '<option value="">全部单位</option>'
      + depts.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('');

    const xref = state.nucStats ? state.nucStats.crossReferenced : 0;
    el.nucCrossRefHint.textContent = xref
      ? `本目录与日历已交叉标注 ${xref} 条赛事（卡片上的「中北 · 级别」徽标）`
      : '';
  }

  /* ---------------- URL 同步 ---------------- */
  function syncUrl() {
    const p = new URLSearchParams();
    if (state.tab !== 'calendar') p.set('view', state.tab);
    if (state.q) p.set('q', state.q);
    if (state.cat) p.set('cat', state.cat);
    if (state.level) p.set('lvl', state.level);
    if (state.status !== 'all') p.set('st', state.status);
    if (state.from) p.set('from', state.from);
    if (state.to) p.set('to', state.to);
    if (state.rangeField !== 'contest') p.set('rf', state.rangeField);
    if (state.overlap !== 'overlap') p.set('ov', state.overlap);
    if (state.sort !== 'start-asc') p.set('sort', state.sort);
    if (state.tzIndex !== 0) p.set('tz', String(state.tzIndex));
    if (state.openable) p.set('open', '1');
    if (state.nq) p.set('nq', state.nq);
    if (state.nlevel !== 'all') p.set('nlvl', state.nlevel);
    if (state.ndept) p.set('ndept', state.ndept);
    if (state.nsort !== 'no-asc') p.set('nsort', state.nsort);
    const qs = p.toString();
    history.replaceState(null, '', qs ? '?' + qs : location.pathname);
  }

  function loadUrl() {
    const p = new URLSearchParams(location.search);
    if (p.get('view') === 'catalog') state.tab = 'catalog';
    if (p.get('q')) state.q = p.get('q');
    if (p.get('cat')) state.cat = p.get('cat');
    if (p.get('lvl')) state.level = p.get('lvl');
    if (p.get('st')) state.status = p.get('st');
    if (p.get('from')) state.from = p.get('from');
    if (p.get('to')) state.to = p.get('to');
    if (p.get('rf')) state.rangeField = p.get('rf');
    if (p.get('ov')) state.overlap = p.get('ov');
    if (p.get('sort')) state.sort = p.get('sort');
    if (p.get('tz')) state.tzIndex = Math.min(TZ_PRESETS.length - 1, Math.max(0, +p.get('tz') || 0));
    if (p.get('nq')) state.nq = p.get('nq');
    if (p.get('nlvl')) state.nlevel = p.get('nlvl');
    if (p.get('ndept')) state.ndept = p.get('ndept');
    if (p.get('nsort')) state.nsort = p.get('nsort');
    if (p.get('now')) { const t = new Date(p.get('now')).getTime(); if (!Number.isNaN(t)) state.nowOverride = t; }
    if (p.get('open') === '1') state.openable = true;
  }

  function updateCatHint() {
    if (!el.catHint) return;
    el.catHint.textContent = state.cat
      ? CATEGORY_DESC[state.cat]
      : '按赛事举办地域与性质划分；参赛准入限制见各处详情页';
  }

  function syncControls() {
    el.q.value = state.q;
    el.qClear.hidden = !state.q;
    el.cat.value = state.cat;
    el.level.value = state.level;
    updateCatHint();
    el.rangeField.value = state.rangeField;
    el.from.value = state.from;
    el.to.value = state.to;
    el.overlap.value = state.overlap;
    el.sort.value = state.sort;
    el.btnTz.textContent = '时区：' + TZ_PRESETS[state.tzIndex].label;
    [...el.statusChips.querySelectorAll('.chip')].forEach((b) => {
      b.classList.toggle('on', b.dataset.status === state.status);
    });
    el.nq.value = state.nq;
    el.nqClear.hidden = !state.nq;
    el.ndept.value = state.ndept;
    el.nsort.value = state.nsort;
    [...el.levelChips.querySelectorAll('.chip')].forEach((b) => {
      b.classList.toggle('on', b.dataset.level === state.nlevel);
    });
  }

  function setTab(tab) {
    state.tab = tab;
    const isCal = tab === 'calendar';
    el.viewCalendar.hidden = !isCal;
    el.viewCatalog.hidden = isCal;
    el.tabCalendar.classList.toggle('on', isCal);
    el.tabCatalog.classList.toggle('on', !isCal);
    el.tabCalendar.setAttribute('aria-selected', String(isCal));
    el.tabCatalog.setAttribute('aria-selected', String(!isCal));
    if (!isCal) renderNuc();
    syncUrl();
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
    const head = ['赛事名称', '类型', '中北级别', '中北负责单位', '主办方', '地区', '赛制',
      '开始报名', '报名截止', '报名依据', '比赛开始', '比赛结束', '状态', '报名状态', '官网', '可信度', '来源'];
    const q = (s) => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
    const lines = [head.map(q).join(',')];
    const tz = TZ();
    for (const { ev, st } of rows) {
      lines.push([
        ev.title, CATEGORY_LABEL[ev.category] || ev.category,
        ev.nucLevel || '', ev.nucDept || '',
        ev.organizer, ev.region, ev.format,
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

  function exportNucCsv() {
    const list = nucFiltered();
    const head = ['序号', '竞赛名称', '级别', '负责单位', '竞赛负责人', '国赛参赛官网', '备注'];
    const q = (s) => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
    const lines = [head.map(q).join(',')];
    for (const c of list) {
      lines.push([c.no, c.name, c.level, c.dept, (c.owners || []).join('、'), c.url || '', c.note || '']
        .map(q).join(','));
    }
    download('中北大学学科竞赛目录-2026.csv', '\uFEFF' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  }

  const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const icsDate = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  function exportIcs() {
    const rows = C.sortDecorated(filterList(decorate()), state.sort);
    const stamp = icsDate(Date.now());
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CTF Calendar 2026//CN//',
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:CTF 赛事日历 2026'];
    for (const { ev, st } of rows) {
      if (st.cs != null) {
        const end = st.ce != null ? st.ce : st.cs + 3600000;
        L.push('BEGIN:VEVENT',
          `UID:${icsEsc(ev.id)}-contest@ctf-calendar`, `DTSTAMP:${stamp}`,
          `DTSTART:${icsDate(st.cs)}`, `DTEND:${icsDate(end)}`,
          `SUMMARY:${icsEsc('[CTF] ' + ev.title)}`,
          `DESCRIPTION:${icsEsc([ev.organizer, ev.format, '状态: ' + STATUS_META[st.status].label, ev.officialUrl].filter(Boolean).join(' | '))}`,
          ev.officialUrl ? `URL:${ev.officialUrl}` : '', 'END:VEVENT');
      }
      if (st.re != null) {
        L.push('BEGIN:VEVENT',
          `UID:${icsEsc(ev.id)}-regdeadline@ctf-calendar`, `DTSTAMP:${stamp}`,
          `DTSTART;VALUE=DATE:${new Date(st.re).toISOString().slice(0, 10).replace(/-/g, '')}`,
          `SUMMARY:${icsEsc('[报名截止] ' + ev.title)}`,
          `DESCRIPTION:${icsEsc(ev.registrationNote || ev.officialUrl || '')}`, 'END:VEVENT');
      }
    }
    L.push('END:VCALENDAR');
    download('ctf-calendar-2026.ics', L.filter(Boolean).join('\r\n'), 'text/calendar;charset=utf-8');
  }

  /* ---------------- 交互 ---------------- */
  let debounce, ndebounce;
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
    const onSel = (node, key, cb) => node && node.addEventListener('change', () => {
      state[key] = node.value; (cb || apply)();
    });
    onSel(el.cat, 'cat', () => { syncControls(); apply(); });
    onSel(el.level, 'level');
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

    const chipOpen = $('chipOpenable');
    if (chipOpen) {
      chipOpen.addEventListener('click', () => {
        state.openable = !state.openable;
        apply();
      });
    }

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
      if (state.tab === 'catalog') renderNuc();
    });

    el.btnTheme.addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = state.theme;
      el.btnTheme.textContent = state.theme === 'dark' ? '🌙' : '☀️';
      try { localStorage.setItem('ctf-theme', state.theme); } catch (e) { /* ignore */ }
    });

    const reset = () => {
      Object.assign(state, {
        q: '', cat: '', level: '', rangeField: 'contest', from: '', to: '',
        overlap: 'overlap', sort: 'start-asc', status: 'all', openable: false,
      });
      syncControls(); apply();
    };
    el.btnReset.addEventListener('click', reset);
    el.btnReset2.addEventListener('click', reset);
    el.btnCsv.addEventListener('click', exportCsv);
    el.btnIcs.addEventListener('click', exportIcs);

    // tabs
    el.tabCalendar.addEventListener('click', () => setTab('calendar'));
    el.tabCatalog.addEventListener('click', () => setTab('catalog'));

    // catalog controls
    el.nq.addEventListener('input', () => {
      state.nq = el.nq.value.trim();
      el.nqClear.hidden = !state.nq;
      clearTimeout(ndebounce);
      ndebounce = setTimeout(() => { renderNuc(); syncUrl(); }, 150);
    });
    el.nqClear.addEventListener('click', () => {
      el.nq.value = ''; state.nq = ''; el.nqClear.hidden = true; renderNuc(); syncUrl(); el.nq.focus();
    });
    onSel(el.ndept, 'ndept', () => { renderNuc(); syncUrl(); });
    onSel(el.nsort, 'nsort', () => { renderNuc(); syncUrl(); });

    el.levelChips.addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      state.nlevel = b.dataset.level;
      syncControls(); renderNuc(); syncUrl();
    });

    el.nucReset.addEventListener('click', () => {
      state.nq = ''; state.nlevel = 'all'; state.ndept = ''; state.nsort = 'no-asc';
      syncControls(); renderNuc(); syncUrl();
    });
    el.nucCsv.addEventListener('click', exportNucCsv);
    if (el.nucPrint) el.nucPrint.addEventListener('click', () => window.print());
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    loadUrl();
    try {
      const saved = localStorage.getItem('ctf-theme');
      if (saved) state.theme = saved;
    } catch (e) { /* ignore */ }
    document.documentElement.dataset.theme = state.theme;
    el.btnTheme.textContent = state.theme === 'dark' ? '🌙' : '☀️';

    try {
      const [evRes, nucRes] = await Promise.all([
        fetch('data/events.json', { cache: 'no-cache' }),
        fetch('data/nuc-catalog.json', { cache: 'no-cache' }).catch(() => null),
      ]);
      if (!evRes.ok) throw new Error('HTTP ' + evRes.status);
      const payload = await evRes.json();
      state.events = payload.events || [];
      state.stats = payload.stats || null;

      if (nucRes && nucRes.ok) {
        const nucPayload = await nucRes.json();
        state.nuc = nucPayload.entries || [];
        state.nucStats = nucPayload.stats || null;
      }

      el.genAt.textContent = state.stats && state.stats.generatedAt
        ? C.fmtDT(state.stats.generatedAt, TZ(), true) : '—';
      el.statTotal.textContent = String(state.events.length);
      el.tabNCalendar.textContent = String(state.events.length);
    } catch (err) {
      el.list.innerHTML = `<div class="empty"><div class="empty-ico">⚠️</div>
        <h2>数据加载失败</h2><p>${esc(err.message)}</p>
        <p class="muted">请通过 HTTP 服务访问本页（<code>fetch</code> 无法从 <code>file://</code> 读取数据）。</p></div>`;
      return;
    }
    syncControls();
    initCatalog();
    bind();
    apply();
    setTab(state.tab);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
