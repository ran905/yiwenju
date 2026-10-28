/* 前沿切片 · 前端逻辑（零依赖，原生 ES 模块） */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const STORE_KEY = 'frontier-slice:saved';

const state = {
  fields: [],
  papers: [],
  field: 'all',
  currentField: null,
  query: '',
  sort: 'new',
  savedOnly: false,
  saved: new Set(loadSaved()),
};

/* ---------- 工具函数 ---------- */

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
  } catch {
    return [];
  }
}

function persistSaved() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...state.saved]));
  } catch {
    /* 隐私模式下忽略 */
  }
}

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fieldOf = (id) => state.fields.find((f) => f.id === id) || { id, name: id, color: '#191712' };

function fmtDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

const STAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.6 5.4 6 .9-4.3 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.4 9.9l6-.9z"/></svg>`;
const ARROW = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
const BACK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>`;

/* ---------- 路由 ---------- */

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  if (parts[0] === 'p' && parts[1]) return { name: 'paper', id: decodeURIComponent(parts[1]) };
  if (parts[0] === 'about') return { name: 'about' };
  if (parts[0] === 'saved') return { name: 'feed', field: 'all', savedOnly: true };
  if (parts[0] === 'f' && parts[1]) return { name: 'feed', field: parts[1] };
  return { name: 'feed', field: 'all', savedOnly: false };
}

function route() {
  const r = parseRoute();
  state.savedOnly = Boolean(r.savedOnly);
  state.field = r.field || 'all';
  state.query = '';
  state.currentField =
    r.name === 'paper' ? state.papers.find((p) => p.id === r.id)?.field || null : null;

  if (r.name === 'paper') renderPaper(r.id);
  else if (r.name === 'about') renderAbout();
  else renderFeed();

  syncNav();
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}

function syncNav() {
  const activeField = state.currentField || (state.savedOnly ? null : state.field);
  $$('.nav-link').forEach((a) => {
    if (a.dataset.field === activeField) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const savedLink = $('#savedLink');
  if (state.savedOnly) savedLink.setAttribute('aria-current', 'page');
  else savedLink.removeAttribute('aria-current');
}

/* ---------- 列表数据 ---------- */

function sortedPapers() {
  const q = state.query.trim().toLowerCase();
  const list = state.papers.filter((p) => {
    if (state.field !== 'all' && p.field !== state.field) return false;
    if (state.savedOnly && !state.saved.has(p.id)) return false;
    if (!q) return true;
    const f = fieldOf(p.field);
    return [p.title_zh, p.title_en, p.one_liner, p.why, f.name, ...(p.tags || [])]
      .join(' ')
      .toLowerCase()
      .includes(q);
  });

  const byDate = (a, b) => b.published.localeCompare(a.published) || a.id.localeCompare(b.id);
  switch (state.sort) {
    case 'pick':
      list.sort((a, b) => Number(b.pick) - Number(a.pick) || byDate(a, b));
      break;
    case 'quick':
      list.sort((a, b) => a.minutes - b.minutes || byDate(a, b));
      break;
    case 'easy':
      list.sort((a, b) => a.difficulty - b.difficulty || byDate(a, b));
      break;
    default:
      list.sort(byDate);
  }
  return list;
}

/* ---------- 渲染：首页 ---------- */

function renderFeed() {
  const app = $('#app');
  const isHome = state.field === 'all' && !state.savedOnly;
  const field = fieldOf(state.field);
  document.title = '前沿切片 · 高中生也能读懂的科研速递';

  const head = state.savedOnly
    ? `<section class="page-head"><h1>我的收藏</h1><p>存在这台设备的浏览器里，换设备不会同步。</p></section>`
    : isHome
      ? heroHTML()
      : `<section class="page-head">
           <h1><span class="dot" style="--c:${field.color}"></span>${esc(field.name)}</h1>
           <p>${esc(field.blurb)}</p>
         </section>`;

  app.innerHTML = `
    <div class="view">
      ${head}
      <div class="layout">
        <div class="feed-col">
          ${toolbarHTML()}
          ${metaHTML()}
          <div class="feed" id="feed"></div>
        </div>
        ${asideHTML()}
      </div>
    </div>`;

  refreshList();
}

function refreshList() {
  const list = sortedPapers();
  const feed = $('#feed');
  if (!feed) return;
  feed.innerHTML = list.length ? list.map(cardHTML).join('') : emptyHTML();
  const meta = $('#feedMeta');
  if (meta) meta.outerHTML = metaHTML(list);
}

function heroHTML() {
  const latest = [...state.papers].sort((a, b) => b.published.localeCompare(a.published))[0];
  return `<section class="hero">
    <p class="hero-eyebrow"><span class="pulse"></span>${todayLabel()} · 每日更新</p>
    <h1>把论文，切成<br /><mark>高中生能消化</mark>的小块。</h1>
    <p class="hero-lede">每天从 arXiv 抓取集成电路、数学、物理、化学、生物的最新研究，用 AI 翻成中文，写成 3 分钟就能读完的版本。</p>
    <div class="hero-stats">
      <div><strong>${state.papers.length}</strong><span>篇精选</span></div>
      <div><strong>${state.fields.length}</strong><span>个领域</span></div>
      <div><strong>${latest ? fmtDate(latest.published) : '—'}</strong><span>最近更新</span></div>
    </div>
  </section>`;
}

function todayLabel() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

function toolbarHTML() {
  const opt = (value, label) =>
    `<option value="${value}"${state.sort === value ? ' selected' : ''}>${label}</option>`;
  return `<div class="toolbar">
    <label class="search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
      <input id="search" type="search" placeholder="搜索标题、关键词…" autocomplete="off" value="${esc(state.query)}" />
      <kbd>/</kbd>
    </label>
    <div class="sort">
      <select id="sort" aria-label="排序方式">
        ${opt('new', '最新发布')}
        ${opt('pick', '编辑推荐')}
        ${opt('quick', '最快读完')}
        ${opt('easy', '由易到难')}
      </select>
    </div>
  </div>`;
}

function metaHTML(list = sortedPapers()) {
  const total = state.papers.length;
  const parts = [];
  if (state.savedOnly) parts.push(`已收藏 ${list.length} 篇`);
  else if (state.query) parts.push(`找到 ${list.length} 篇`);
  else if (state.field !== 'all') parts.push(`${fieldOf(state.field).name} · ${list.length} 篇`);
  else parts.push(`共 ${total} 篇`);

  const clear =
    state.query || state.savedOnly
      ? `<button class="clear" id="clearFilter">${state.savedOnly ? '返回全部' : '清除搜索'}</button>`
      : `<span>按发布时间排序，点击卡片查看精读</span>`;

  return `<div class="feed-meta" id="feedMeta"><span>${parts.join(' · ')}</span>${clear}</div>`;
}

function cardHTML(p) {
  const f = fieldOf(p.field);
  const tags = (p.tags || []).map((t) => `<li>#${esc(t)}</li>`).join('');
  const dots = [1, 2, 3].map((i) => `<i class="${i <= p.difficulty ? 'on' : ''}"></i>`).join('');
  const saved = state.saved.has(p.id);

  return `<article class="card ${p.pick ? 'card--pick' : ''}" style="--c:${f.color}" data-id="${esc(p.id)}">
    <div class="card-head">
      <span class="tag">${esc(f.name)}</span>
      ${p.pick ? '<span class="pick">★ 编辑推荐</span>' : ''}
      <span class="sep"></span>
      <time datetime="${p.published}">${fmtDate(p.published)}</time>
      <span class="sep"></span>
      <span>${p.minutes} 分钟</span>
      <span class="sep"></span>
      <span class="difficulty" title="难度 ${p.difficulty} / 3" aria-label="难度 ${p.difficulty} / 3">${dots}</span>
      <button class="star" data-star="${esc(p.id)}" aria-pressed="${saved}" aria-label="${saved ? '取消收藏' : '收藏这篇'}">${STAR}</button>
    </div>
    <a class="card-body" href="#/p/${esc(p.id)}">
      <h2 class="card-title">${esc(p.title_zh)}</h2>
      <p class="card-en">${esc(p.title_en)}</p>
      <p class="card-one">${esc(p.one_liner)}</p>
    </a>
    <div class="card-foot">
      <ul class="pill-list">${tags}</ul>
      <a class="card-more" href="#/p/${esc(p.id)}">读全文 <span class="arrow">→</span></a>
    </div>
  </article>`;
}

function asideHTML() {
  const counts = state.fields
    .map((f) => {
      const n = state.papers.filter((p) => p.field === f.id).length;
      return `<li><a href="#/f/${f.id}"><span class="swatch" style="--c:${f.color}"></span>${esc(f.name)}<span class="num">${n}</span></a></li>`;
    })
    .join('');

  return `<aside class="aside">
    <div class="panel">
      <h2>本期速览</h2>
      <ul class="count-list">${counts}</ul>
    </div>
    <div class="panel">
      <h2>怎么读</h2>
      <ul class="tips">
        <li><span class="n">01</span><span>先读「一句话」，30 秒判断这篇跟你有没有关系。</span></li>
        <li><span class="n">02</span><span>再看「打个比方」，把陌生概念挂到你熟悉的东西上。</span></li>
        <li><span class="n">03</span><span>有兴趣就点开原文，摘要通常只有一段。</span></li>
      </ul>
    </div>
    <div class="panel">
      <h2>关于</h2>
      <p class="aside-note">论文每天自动抓取、翻译、改写。内容由 AI 生成，可能有偏差，重要结论请以原文为准。</p>
      <p style="margin:12px 0 0"><a class="ghost-btn" href="#/about">了解制作方式</a></p>
    </div>
  </aside>`;
}

/* ---------- 渲染：详情 ---------- */

function renderPaper(id) {
  const p = state.papers.find((x) => x.id === id);
  const app = $('#app');

  if (!p) {
    document.title = '没有找到这篇 · 前沿切片';
    app.innerHTML = `<div class="about view"><h1>没有找到这篇</h1><p class="lead">它可能已经被移出本期列表。</p><p><a class="btn" href="#/">← 返回首页</a></p></div>`;
    return;
  }

  document.title = `${p.title_zh} · 前沿切片`;

  const f = fieldOf(p.field);
  const sorted = [...state.papers].sort((a, b) => b.published.localeCompare(a.published));
  const idx = sorted.findIndex((x) => x.id === p.id);
  const prev = sorted[idx + 1];
  const next = sorted[idx - 1];
  const authors =
    p.authors.length > 3 ? `${p.authors.slice(0, 3).join('、')} 等 ${p.authors.length} 人` : p.authors.join('、');
  const dots = [1, 2, 3].map((i) => `<i class="${i <= p.difficulty ? 'on' : ''}"></i>`).join('');
  const saved = state.saved.has(p.id);

  app.innerHTML = `<div class="view layout layout--single">
    <article class="paper" style="--c:${f.color}">
      <a class="back" href="#/">${BACK}<span>返回列表</span></a>

      <div class="paper-meta">
        <span class="tag">${esc(f.name)}</span>
        <span>${p.source_label}</span>
        <span>·</span>
        <time datetime="${p.published}">${fmtDate(p.published)}</time>
        <span>·</span>
        <span>${p.minutes} 分钟读完</span>
        <span class="difficulty" title="难度 ${p.difficulty} / 3">${dots}</span>
      </div>

      <h1>${esc(p.title_zh)}</h1>
      <p class="paper-en">${esc(p.title_en)}</p>

      <p class="lede">${esc(p.one_liner)}</p>
      <p class="why"><b>为什么值得看</b>${esc(p.why)}</p>

      <div class="paper-actions">
        <a class="btn btn--dark" href="${p.url}" target="_blank" rel="noreferrer">阅读原文 ${ARROW}</a>
        <a class="btn" href="${p.pdf}" target="_blank" rel="noreferrer">PDF</a>
        <button class="btn" data-star="${esc(p.id)}" aria-pressed="${saved}">${STAR}<span>${saved ? '已收藏' : '收藏'}</span></button>
        <span style="margin-left:auto;font-size:12px;color:var(--faint)">${esc(authors)}</span>
      </div>

      <section class="paper-section">
        <h2><span class="n">01</span>这件事的背景</h2>
        <p>${esc(p.sections.background)}</p>
      </section>
      <section class="paper-section">
        <h2><span class="n">02</span>他们是怎么做的</h2>
        <p>${esc(p.sections.method)}</p>
      </section>
      <section class="paper-section">
        <h2><span class="n">03</span>发现了什么</h2>
        <p>${esc(p.sections.finding)}</p>
      </section>
      <section class="paper-section">
        <h2><span class="n">04</span>为什么重要</h2>
        <p>${esc(p.sections.impact)}</p>
      </section>

      <div class="analogy">
        <h2>打个比方</h2>
        <p>${esc(p.analogy)}</p>
      </div>

      <section class="terms">
        <h2>术语小词典</h2>
        <dl>${p.terms.map((t) => `<div class="term"><dt>${esc(t.t)}</dt><dd>${esc(t.d)}</dd></div>`).join('')}</dl>
      </section>

      <details class="abstract-box">
        <summary>英文摘要原文</summary>
        <p class="en-abs">${esc(p.abstract)}</p>
      </details>

      <p class="disclaimer">
        本文由 AI 根据论文摘要改写，目的是帮你快速建立印象，不是严谨的学术译介。数字、结论和术语若有出入，请以
        <a href="${p.url}" target="_blank" rel="noreferrer" style="text-decoration:underline">arXiv 原文</a> 为准。
      </p>

      <nav class="pager">
        ${prev ? `<a href="#/p/${esc(prev.id)}"><span>← 更早一篇</span><strong>${esc(prev.title_zh)}</strong></a>` : '<span></span>'}
        ${next ? `<a class="next" href="#/p/${esc(next.id)}"><span>更新一篇 →</span><strong>${esc(next.title_zh)}</strong></a>` : ''}
      </nav>
    </article>
  </div>`;
}

/* ---------- 渲染：关于 ---------- */

function renderAbout() {
  document.title = '关于 · 前沿切片';
  $('#app').innerHTML = `<div class="view about">
    <a class="back" href="#/">${BACK}<span>返回首页</span></a>
    <h1>关于前沿切片</h1>
    <p class="lead">给高中生看的科研速递：每天挑几篇值得读的新论文，翻成中文，讲成人话。</p>

    <h2>它怎么运转</h2>
    <ol>
      <li><b>抓取</b>：每天定时从 arXiv 拉取集成电路、数学、物理、化学、生物几个方向的最新论文元数据。</li>
      <li><b>筛选</b>：按「能不能讲清楚」「跟高中生有没有关系」挑出少量篇目，而不是把整页列表塞给你。</li>
      <li><b>改写</b>：用大模型把摘要翻成中文，拆成「背景 / 怎么做 / 发现了什么 / 为什么重要」，再补一个生活化的比喻和术语解释。</li>
      <li><b>发布</b>：生成静态 JSON，前端直接读取。没有数据库，也没有账号系统。</li>
    </ol>

    <h2>为什么值得看</h2>
    <p>课本里的知识往往已经沉淀了几十年。而前沿论文里有正在发生的事：新的芯片结构、新的数学猜想、新的天文观测。你不需要看懂全部细节，只需要知道「原来还有人在这样想问题」。</p>
    <p>保持对前沿的敏感，不是要你现在就会做研究，而是让你在选专业、做课题、写作文的时候，脑子里有几个真实的坐标。</p>

    <h2>诚实说明</h2>
    <p>所有中文内容都是 AI 改写的，会简化、会省略、也可能理解错。每篇都附了原文链接，重要结论请回去核对。这个站点的目标不是替代论文，而是帮你决定「要不要点开这篇论文」。</p>

    <h2>自己搭一个</h2>
    <p>整个站点是纯静态的，数据在 <code>data/papers.json</code>，抓取与改写脚本在 <code>scripts/</code>。把仓库 fork 一份，配好 API Key，就能改成你自己的领域和语气。</p>

    <p style="margin-top:36px"><a class="btn btn--dark" href="https://arxiv.org" target="_blank" rel="noreferrer">去 arXiv 逛逛 ${ARROW}</a></p>
  </div>`;
}

/* ---------- 交互 ---------- */

function updateSavedCount() {
  $('#savedCount').textContent = String(state.saved.size);
}

function toggleSaved(id) {
  if (state.saved.has(id)) state.saved.delete(id);
  else state.saved.add(id);
  persistSaved();
  updateSavedCount();

  $$(`[data-star="${CSS.escape(id)}"]`).forEach((btn) => {
    const on = state.saved.has(id);
    btn.setAttribute('aria-pressed', String(on));
    if (btn.classList.contains('star')) btn.setAttribute('aria-label', on ? '取消收藏' : '收藏这篇');
    const label = btn.querySelector('span');
    if (label) label.textContent = on ? '已收藏' : '收藏';
  });

  if (state.savedOnly) refreshList();
}

function emptyHTML() {
  if (state.savedOnly) {
    return `<div class="empty"><p>还没有收藏任何论文。</p><p class="hint">在列表里点右上角的 ☆，就会出现在这里。</p></div>`;
  }
  if (state.query) {
    return `<div class="empty"><p>没有找到匹配的论文。</p><p class="hint">试试更短的关键词，比如「芯片」「量子」「DNA」。</p></div>`;
  }
  return `<div class="empty"><p>这里还没有内容。</p><p class="hint">过几天再来看看。</p></div>`;
}

function bindGlobal() {
  document.addEventListener('click', (e) => {
    const star = e.target.closest('[data-star]');
    if (star) {
      e.preventDefault();
      toggleSaved(star.dataset.star);
      return;
    }
    if (e.target.closest('#clearFilter')) {
      if (state.savedOnly) {
        location.hash = '#/';
        return;
      }
      state.query = '';
      const input = $('#search');
      if (input) input.value = '';
      refreshList();
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id !== 'search') return;
    state.query = e.target.value;
    clearTimeout(bindGlobal._t);
    bindGlobal._t = setTimeout(refreshList, 120);
  });

  document.addEventListener('change', (e) => {
    if (e.target.id !== 'sort') return;
    state.sort = e.target.value;
    refreshList();
  });

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (e.key === '/' && !typing) {
      e.preventDefault();
      const input = $('#search');
      if (input) input.focus();
    }
    if (e.key === 'Escape' && document.activeElement?.id === 'search') {
      document.activeElement.value = '';
      state.query = '';
      refreshList();
    }
  });

  window.addEventListener('hashchange', route);
}

async function init() {
  try {
    const [papersRes, fieldsRes] = await Promise.all([
      fetch('data/papers.json', { cache: 'no-cache' }),
      fetch('data/fields.json', { cache: 'no-cache' }),
    ]);
    if (!papersRes.ok || !fieldsRes.ok) throw new Error(`HTTP ${papersRes.status}/${fieldsRes.status}`);
    const papersData = await papersRes.json();
    state.papers = papersData.papers || [];
    state.fields = await fieldsRes.json();
  } catch (err) {
    $('#app').innerHTML = `<div class="empty"><p>数据加载失败：${esc(err.message)}</p><p class="hint">请通过本地服务器打开（node scripts/serve.mjs），不要直接双击 HTML 文件。</p></div>`;
    return;
  }

  const all = `<a class="nav-link" href="#/" data-field="all">全部</a>`;
  const links = state.fields
    .map(
      (f) =>
        `<a class="nav-link" href="#/f/${f.id}" data-field="${f.id}" style="--c:${f.color}"><span class="dot"></span>${esc(f.name)}</a>`,
    )
    .join('');
  $('#nav').innerHTML = all + links;

  bindGlobal();
  updateSavedCount();
  route();
}

init();
