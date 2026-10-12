/* ============================================================
 * 界面与路由
 *   路由用 hash（#/...），这样 GitHub Pages 上刷新任何页面都不会 404
 *     #/                     首页
 *     #/test                 答题
 *     #/me                   我的档案（本机记忆）
 *     #/d/<sign>/<v0..v4>    分享查看（无后端时的自带数据链接）
 *     #/r/<short>            分享查看（后端短链接）
 *     #/stats                全局统计
 * ============================================================ */
(function () {
  const D = window.QUIZ_DATA;
  const E = window.Engine;
  const S = window.Store;
  const cfg = window.APP_CONFIG || {};
  const app = document.getElementById('app');

  const esc = s => String(s === undefined || s === null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = { ans: [], qi: 0, pivot: null, result: null };
  const siteName = cfg.SITE_NAME || '前世身份档案';

  /* ---------------- 基础 ---------------- */
  function render(html) { app.innerHTML = html; try { window.scrollTo(0, 0); } catch (e) {} }

  let toastTimer = null;
  function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
  }

  /* 换地址栏但不触发 hashchange，避免和渲染打架 */
  function setUrl(hash) {
    try { history.replaceState(null, '', hash); } catch (e) { location.hash = hash; }
  }

  function topbar(active) {
    return '<div class="topbar">' +
      '<a class="brand" href="#/">' + esc(siteName) + '</a>' +
      '<nav>' +
        (S.enabled && cfg.SHOW_STATS !== false ? '<a href="#/stats" class="' + (active === 'stats' ? 'on' : '') + '">统计</a>' : '') +
        '<a href="#/" class="' + (active === 'home' ? 'on' : '') + '">重测</a>' +
      '</nav></div>';
  }

  function footNote() {
    return '<p class="footnote">本测评为娱乐性质的人格投射，不构成心理诊断或专业建议。<br>' +
      '所有历史人物评价均依据公开史料与主流共识。</p>';
  }

  /* ---------------- 首页 ---------------- */
  function intro() {
    const prog = S.mem.loadProgress();
    const last = S.mem.loadLast();
    const resumable = prog && prog.ans && prog.qi > 0 && prog.qi < E.TOTAL_Q;

    render(topbar('home') + '<div class="hero">' +
      '<div class="seal">前世</div>' +
      '<h1>' + esc(siteName) + '</h1>' +
      '<div class="sub">A PAST-LIFE PERSONA FILE</div>' +
      '<p>这不是一个「你是哪位古人」的随机分配。我们从五个性格维度测量你的选择倾向，再与 ' + D.archetypes.length +
      ' 位历史人物的性格坐标做距离匹配，得出与你最接近的那一个。</p>' +
      '<p>题目没有标准答案，也不存在更好或更差的性格。请凭第一反应作答，不要反复权衡。</p>' +
      '<div class="meta">' +
        '<div><b>' + E.TOTAL_Q + '</b><span>道情境题</span></div>' +
        '<div><b>' + D.dims.length + '</b><span>个维度</span></div>' +
        '<div><b>' + D.archetypes.length + '</b><span>种原型</span></div>' +
      '</div>' +
      '<button class="btn" data-go="start">开始测评</button>' +
      (resumable ? '<div style="height:10px"></div><button class="btn ghost" data-go="resume">继续上次 · 第 ' + (prog.qi + 1) + ' 题</button>' : '') +
      (last && last.a ? '<div style="height:10px"></div><button class="btn ghost" data-go="me">查看我的档案</button>' : '') +
      '<div class="statline" id="statline"></div>' +
      '</div>' + footNote());

    loadStatline();
  }

  async function loadStatline() {
    const el = document.getElementById('statline');
    if (!el) return;
    const st = await S.stats();
    if (!el.isConnected) return;
    if (st && st.total > 0) {
      el.innerHTML = st.source === 'cloud'
        ? '<span class="dot"></span>已有 <b>' + st.total + '</b> 份前世档案被生成' + (st.today ? '，今天 <b>' + st.today + '</b> 份' : '')
        : '<span class="dot"></span>本机已生成 <b>' + st.total + '</b> 份档案';
      el.classList.add('on');
    } else if (!S.enabled) {
      el.innerHTML = '<span class="dot loc"></span>当前为本地模式·结果不跨设备共享';
      el.classList.add('on');
    } else {
      el.innerHTML = '<span class="dot"></span>还没有人测过，你会是第一个';
      el.classList.add('on');
    }
  }

  /* ---------------- 答题 ---------------- */
  function startQuiz() {
    state.ans = new Array(E.TOTAL_Q).fill(null);
    state.qi = 0; state.pivot = null;
    S.mem.saveProgress({ ans: state.ans, qi: 0 });
    setUrl('#/test'); renderQ();
  }

  function resumeQuiz() {
    const p = S.mem.loadProgress();
    if (!p) return startQuiz();
    state.ans = (p.ans && p.ans.length === E.TOTAL_Q) ? p.ans.slice() : new Array(E.TOTAL_Q).fill(null);
    state.qi = Math.min(Math.max(p.qi || 0, 0), E.TOTAL_Q - 1);
    state.pivot = null;
    setUrl('#/test'); renderQ();
  }

  const progressPct = step => (step / (E.TOTAL_Q + 1) * 100).toFixed(0);

  function renderQ() {
    const q = D.questions[state.qi];
    render(topbar() + '<div class="qwrap">' +
      '<div class="bar"><i style="width:' + progressPct(state.qi) + '%"></i></div>' +
      '<div class="qnum">第 ' + (state.qi + 1) + ' / ' + (E.TOTAL_Q + 1) + ' 题</div>' +
      '<div class="qtext">' + esc(q.q) + '</div>' +
      '<div id="opts">' + q.o.map((o, i) =>
        '<button class="opt" data-i="' + i + '"><span class="lt">' + 'ABCD'[i] + '</span><span>' + esc(o.t) + '</span></button>'
      ).join('') + '</div>' +
      (state.qi > 0 ? '<button class="back" data-go="prev">← 上一题</button>' : '') +
      '</div>');
  }

  function pick(i) {
    document.querySelectorAll('.opt').forEach(el => el.classList.remove('sel'));
    const cur = document.querySelector('.opt[data-i="' + i + '"]');
    if (cur) cur.classList.add('sel');
    state.ans[state.qi] = i;
    S.mem.saveProgress({ ans: state.ans, qi: state.qi });
    setTimeout(() => {
      if (state.qi < E.TOTAL_Q - 1) {
        state.qi++;
        S.mem.saveProgress({ ans: state.ans, qi: state.qi });
        renderQ();
      } else renderPivot();
    }, 240);
  }

  function renderPivot() {
    render(topbar() + '<div class="qwrap">' +
      '<div class="bar"><i style="width:' + progressPct(E.TOTAL_Q) + '%"></i></div>' +
      '<div class="qnum">第 ' + (E.TOTAL_Q + 1) + ' / ' + (E.TOTAL_Q + 1) + ' 题 · 点睛题</div>' +
      '<div class="qtext">' + esc(D.pivot.q) + '</div>' +
      '<div id="opts" data-mode="pivot">' + D.pivot.opts.map((o, i) =>
        '<button class="opt" data-i="' + i + '"><span class="lt">' + 'ABCD'[i] + '</span><span>' + esc(o.t) + '</span></button>'
      ).join('') + '</div>' +
      '<button class="back" data-go="prevQ">← 上一题</button>' +
      '</div>');
  }

  function pivot(i) {
    document.querySelectorAll('.opt').forEach(el => el.classList.remove('sel'));
    const cur = document.querySelector('.opt[data-i="' + i + '"]');
    if (cur) cur.classList.add('sel');
    state.pivot = i;
    setTimeout(finish, 240);
  }

  /* ---------------- 完成 ---------------- */
  async function finish() {
    const vec = E.calcScores(state.ans);
    const sign = D.pivot.opts[state.pivot].s;
    const res = E.buildResult(vec, sign);
    state.result = res;

    S.mem.clearProgress();
    S.mem.saveLast(res);
    render(archiveHTML(res, { self: true }));
    setUrl('#/me');
    fillDynamic(res, true);          // 先用「自带数据链接」把分享区填上，不等后端

    // 异步写入后端；成功则升级成短链接
    const id = await S.save(res);
    if (id) {
      res.short = id;
      S.mem.saveLast(res);
      setUrl('#/r/' + id);
      fillDynamic(res, true);
    } else {
      setUrl('#/d/' + E.encodePayload(res));
      fillDynamic(res, true);
    }
  }

  /* ---------------- 档案正文 ---------------- */
  function archiveHTML(res, opt) {
    opt = opt || {};
    const a = E.BY_ID[res.a], second = E.BY_ID[res.s2];
    const h = [];

    h.push('<div class="reshead">');
    if (res.short) h.push('<div class="fileno">档案编号 ' + esc(res.short) + '</div>');
    h.push('<div class="dyn">' + esc(a.dyn) + '</div>');
    h.push('<h2>' + esc(a.name) + '</h2>');
    h.push('<div class="ttl">' + esc(a.title) + '</div>');
    h.push('<div class="sim">匹配度 ' + res.m.toFixed(1) + '%</div>');
    h.push('</div>');

    h.push('<div class="resbody">');
    h.push('<div class="verdict">「' + esc(a.verdict) + '」</div>');
    h.push(E.radarSVG(res.v, a.color));

    h.push('<div class="sect"><h3>你的五维画像</h3><p>' + esc(a.pic) + '</p></div>');
    h.push('<div class="sect"><h3>为什么是' + esc(a.name) + '</h3><p>' + esc(a.story) + '</p></div>');
    h.push('<div class="sect"><h3>你的性格在哪几个点上最像他</h3><ul class="reslist">' +
      a.res.map(r => '<li>' + esc(r) + '</li>').join('') + '</ul></div>');

    h.push('<div class="sect"><h3>你的高光与代价</h3><div class="lc">' +
      '<div><h4>你的高光</h4><ul>' + a.light.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></div>' +
      '<div><h4>你的代价</h4><ul>' + a.cost.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></div>' +
      '</div></div>');

    h.push('<div class="bless"><p>' + esc(a.bless) + '</p><span class="sign">—— 来自一位「' + esc(res.s) + '」的千年寄语</span></div>');

    if (res.mixed) {
      h.push('<div class="mix"><b>你同时是一个混合型人格。</b>你的得分与最接近的两种原型差距很小——你身上既有 <b>' +
        esc(a.name) + '</b> 的底色，也有 <b>' + esc(second.name) + '</b> 的投射。这种「双重性」本身就是你的特征：' +
        '你比单一类型的人更能理解两种活法，代价是偶尔会觉得自己不属于任何一边。</div>');
    }

    h.push('<div class="sect"><h3>灵魂副调</h3><p>除了' + esc(a.name) + '，你身上还有 <b>' +
      esc(second.title) + ' · ' + esc(second.name) + '</b> 的影子（匹配度 ' + res.m2.toFixed(1) + '%）。' +
      esc(second.kw.join(' · ')) + '。</p></div>');

    h.push('<div class="sect" id="myStat"></div>');
    h.push('<div class="sect" id="shareBox"></div>');
    h.push('<div class="sect" id="voteBox"></div>');
    h.push('</div>');

    h.push('<div class="foot">');
    if (opt.self) {
      h.push('<button class="btn" data-act="copyText">复制分享文案</button>');
      h.push('<div style="height:10px"></div>');
      h.push('<button class="btn ghost" data-act="copyLink">复制链接，让朋友直接看我的档案</button>');
      h.push('<div style="height:10px"></div>');
    } else {
      h.push('<button class="btn" data-go="start">我也要测一次</button>');
      h.push('<div style="height:10px"></div>');
    }
    h.push('<button class="btn ghost" data-go="home">回到首页</button>');
    h.push(footNote());
    h.push('</div>');

    return (opt.self ? topbar() : topbar('home')) + '<div class="sheet">' + h.join('') + '</div>';
  }

  function shareUrl(res) {
    const origin = location.origin + location.pathname;
    return res.short ? origin + '#/r/' + res.short : origin + '#/d/' + E.encodePayload(res);
  }

  function shareBoxHTML(res) {
    return '<h3>发出去的文案，可以直接复制</h3>' +
      '<div class="share" id="shareText">' + esc(E.shareText(res)) + '</div>' +
      '<div class="linkrow"><code id="shareUrl">' + esc(shareUrl(res)) + '</code></div>';
  }

  function voteBoxHTML(res) {
    if (!S.enabled || !res.short) return '';
    return '<h3>这份档案准吗</h3>' +
      '<div class="voterow">' +
        '<button class="vbtn" data-vote="accurate">准，说中了我</button>' +
        '<button class="vbtn" data-vote="inaccurate">不太像</button>' +
      '</div>';
  }

  /* 正文渲染完后，把依赖异步数据的区块补进去 */
  function fillDynamic(res, self) {
    const head = document.querySelector('.fileno');
    if (res.short) {
      if (head) head.textContent = '档案编号 ' + res.short;
      else {
        const rh = document.querySelector('.reshead');
        if (rh) rh.insertAdjacentHTML('afterbegin', '<div class="fileno">档案编号 ' + esc(res.short) + '</div>');
      }
    }
    const box = document.getElementById('shareBox');
    if (box && self) box.innerHTML = shareBoxHTML(res);
    const vb = document.getElementById('voteBox');
    if (vb) vb.innerHTML = voteBoxHTML(res);
    loadMyStat(res);
  }

  async function loadMyStat(res) {
    const el = document.getElementById('myStat');
    if (!el || !S.enabled) return;
    const st = await S.stats();
    if (!el.isConnected || !st || !st.total) return;
    const same = (st.byArchetype && st.byArchetype[res.a]) || 0;
    const pct = st.total ? (same / st.total * 100).toFixed(1) : '0';
    el.innerHTML = '<h3>你和多少人一样</h3><p>在所有已生成的档案里，<b>' + esc(E.BY_ID[res.a].name) +
      '</b> 出现了 <b>' + same + '</b> 次，占 <b>' + pct + '%</b>。共 ' + st.total + ' 份档案。</p>';
  }

  /* ---------------- 我的档案 / 分享查看 ---------------- */
  function myArchive() {
    const last = S.mem.loadLast();
    const res = last ? E.normalizeRecord(last) : null;
    if (!res) { toast('还没有本地记录，先测一次吧'); return intro(); }
    state.result = res;
    render(archiveHTML(res, { self: true }));
    fillDynamic(res, true);
  }

  async function viewByShort(shortId) {
    if (!S.enabled) { renderError('这个链接需要后端支持，当前站点运行在本地模式。'); return; }
    render(topbar('home') + '<div class="loading">正在打开这份档案…</div>');
    const raw = await S.fetchByShort(shortId);
    const res = raw ? E.normalizeRecord(raw) : null;
    if (!res) { renderError('没有找到这份档案，链接可能已失效。'); return; }
    state.result = res;
    render(archiveHTML(res, { self: false }));
    fillDynamic(res, false);
  }

  function viewByPayload(path) {
    const p = E.decodePayload(path);
    if (!p) { renderError('这个分享链接不完整，无法还原档案。'); return; }
    const res = E.hydrate(p.v, p.s);
    state.result = res;
    render(archiveHTML(res, { self: false }));
    fillDynamic(res, false);
  }

  function renderError(msg) {
    render(topbar('home') + '<div class="errbox"><p>' + esc(msg) + '</p>' +
      '<button class="btn" data-go="start">自己测一次</button>' +
      '<div style="height:10px"></div><button class="btn ghost" data-go="home">回到首页</button></div>');
  }

  /* ---------------- 统计 ---------------- */
  async function statsView() {
    render(topbar('stats') + '<div class="loading">正在读取统计…</div>');
    const st = await S.stats();
    if (!st) { renderError('统计暂时不可用，请稍后再试。'); return; }

    const entries = Object.keys(st.byArchetype || {})
      .map(k => ({ id: k, n: st.byArchetype[k] }))
      .filter(e => E.BY_ID[e.id])
      .sort((a, b) => b.n - a.n);
    const max = entries.length ? entries[0].n : 1;
    const acc = (st.feedback && st.feedback.accurate) || 0;
    const inacc = (st.feedback && st.feedback.inaccurate) || 0;
    const accRate = (acc + inacc) ? (acc / (acc + inacc) * 100).toFixed(0) : null;

    const bars = entries.length ? entries.map(e =>
      '<div class="brow"><span class="bn">' + esc(E.BY_ID[e.id].name) + '</span>' +
      '<span class="bt"><i style="width:' + Math.max(2, e.n / max * 100).toFixed(1) + '%"></i></span>' +
      '<span class="bv">' + e.n + ' <em>' + (st.total ? (e.n / st.total * 100).toFixed(1) : 0) + '%</em></span></div>'
    ).join('') : '<p class="muted">还没有数据。第一份档案生成后这里就会有内容。</p>';

    render(topbar('stats') + '<div class="sheet">' +
      '<div class="statgrid">' +
        '<div><b>' + st.total + '</b><span>累计档案</span></div>' +
        '<div><b>' + st.today + '</b><span>今日生成</span></div>' +
        '<div><b>' + (accRate === null ? '—' : accRate + '%') + '</b><span>认为「准」</span></div>' +
      '</div>' +
      '<div class="sect"><h3>原型分布</h3>' + bars + '</div>' +
      (st.source === 'local' ? '<p class="muted">当前是本地模式，这里显示的是本机数据。接上 Supabase 后会变成全站真实分布。</p>' : '') +
      '<div class="sect"><h3>这个页面有什么用</h3><p>如果某个原型长期占比超过 25%，说明它的坐标离大多数人的重心太近，需要往后调。' +
      '这是这套设计里唯一需要持续维护的地方——改坐标不动算法。本地也可以用 <code>node tools/distribution.js</code> 跑同样的诊断。</p></div>' +
      '</div>');
  }

  /* ---------------- 路由 ---------------- */
  function route() {
    const raw = location.hash.replace(/^#\/?/, '');
    const parts = raw.split('/').filter(Boolean);
    const head = parts[0] || '';

    if (!head) return intro();
    if (head === 'test') {
      // 直接输地址进来或刷新时，先看有没有存下来的进度
      const p = S.mem.loadProgress();
      if (p && p.ans && p.ans.length === E.TOTAL_Q && p.qi > 0 && p.qi < E.TOTAL_Q) return resumeQuiz();
      if (state.ans.length !== E.TOTAL_Q || state.qi >= E.TOTAL_Q) return startQuiz();
      return renderQ();
    }
    if (head === 'me') return myArchive();
    if (head === 'd') return viewByPayload(parts.slice(1).join('/'));
    if (head === 'r') return viewByShort(parts[1] || '');
    if (head === 'stats') return statsView();
    return intro();
  }

  /* ---------------- 事件（统一委托） ---------------- */
  document.addEventListener('click', function (ev) {
    const go = ev.target.closest('[data-go]');
    if (go) {
      const k = go.getAttribute('data-go');
      if (k === 'start') return startQuiz();
      if (k === 'resume') return resumeQuiz();
      if (k === 'me') return myArchive();
      if (k === 'home') { setUrl('#/'); return intro(); }
      if (k === 'prev') { state.qi = Math.max(0, state.qi - 1); return renderQ(); }
      if (k === 'prevQ') { state.qi = E.TOTAL_Q - 1; return renderQ(); }
    }

    const opt = ev.target.closest('.opt');
    if (opt && !opt.hasAttribute('disabled')) {
      const i = parseInt(opt.getAttribute('data-i'), 10);
      const isPivot = document.querySelector('#opts[data-mode="pivot"]');
      return isPivot ? pivot(i) : pick(i);
    }

    const v = ev.target.closest('[data-vote]');
    if (v && state.result) {
      const row = v.parentNode;
      row.querySelectorAll('.vbtn').forEach(b => b.setAttribute('disabled', ''));
      S.vote(state.result.short, v.getAttribute('data-vote')).then(ok => {
        row.innerHTML = '<span class="voted">' + (ok ? '已经收到，谢谢你。' : '记录失败，不影响你的档案。') + '</span>';
      });
      return;
    }

    const act = ev.target.closest('[data-act]');
    if (act && state.result) {
      const k = act.getAttribute('data-act');
      if (k === 'copyText') return copy(E.shareText(state.result), '文案已复制，去发一条吧');
      if (k === 'copyLink') return copy(shareUrl(state.result), '链接已复制，发给朋友就能看');
    }
  });

  function copy(text, okMsg) {
    const done = () => toast(okMsg);
    const fail = () => {
      // 老浏览器 / 非 https 环境下的兜底
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
      } catch (e) { toast('请长按文字手动复制'); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fail);
    } else fail();
  }

  window.addEventListener('hashchange', route);

  /* ---------------- 启动 ---------------- */
  document.title = siteName;
  route();
})();
