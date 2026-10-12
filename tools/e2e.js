/* ============================================================
 * 端到端冒烟测试
 * ------------------------------------------------------------
 * 用法（在项目根目录）：
 *     npm install          # 只装 jsdom，一次性
 *     npm test
 *
 * 它做两件纯语法检查做不到的事：
 *   1. 在真实 DOM 里把 21 道题从头点一遍，抓运行时错误
 *      （这类错误 node --check 是发现不了的）
 *   2. 起一个模拟 PostgREST 的服务，把 Supabase 那条链路
 *      （短链接 / 统计 / 反馈 / 写入被拒后的降级）也跑通
 *
 * 它自带静态文件服务，不需要额外开 python -m http.server。
 * 部署用的文件里不含本脚本，不会影响线上。
 * ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const PORT_PLAIN = 8099;
const PORT_CLOUD = 8098;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fails = 0;
const ok = m => console.log('  ok   ' + m);
const bad = m => { fails++; console.log('  FAIL ' + m); };

const DATA = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'assets/js/data.js'), 'utf8')
    .replace(/^[\s\S]*?window\.QUIZ_DATA\s*=\s*/, '').replace(/;\s*$/, '')
);
const NAMES = DATA.archetypes.map(a => a.name);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json'
};

/* ---------------- 站点服务（可选叠加模拟 Supabase） ---------------- */
function makeServer(port, cloud) {
  const db = { personas: [], feedback: [] };
  const log = [];
  let rateLimitOn = false;

  const server = http.createServer((req, res) => {
    const u = url.parse(req.url, true);

    if (u.pathname === '/__ctl/ratelimit') { rateLimitOn = true; return res.end('ok'); }
    if (u.pathname === '/__ctl/reset') {
      rateLimitOn = false; db.personas.length = 0; db.feedback.length = 0; log.length = 0;
      return res.end('ok');
    }
    if (u.pathname === '/__ctl/log') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(log));
    }

    /* ---- 模拟 /rest/v1/rpc/* ---- */
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = u.pathname.replace('/rest/v1/rpc/', '');
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const p = body ? JSON.parse(body) : {};
        log.push({ fn, apikey: req.headers['apikey'] || null, payload: p });
        const send = (code, obj) => {
          res.writeHead(code, { 'Content-Type': 'application/json' });
          res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
        };
        if (!req.headers['apikey']) return send(401, { message: 'No API key found in request' });

        if (fn === 'persona_create') {
          if (rateLimitOn) return send(400, { message: 'rate_limited' });
          if (!Array.isArray(p.p_vec) || p.p_vec.length !== 5) return send(400, { message: 'invalid vec length' });
          const short = Math.random().toString(16).slice(2, 14);
          db.personas.push(Object.assign({ short_id: short }, p));
          return send(200, JSON.stringify(short));         // returns text → 裸 JSON 字符串
        }
        if (fn === 'persona_get') {
          const row = db.personas.find(x => x.short_id === p.p_short);
          if (!row) return send(200, 'null');
          return send(200, {
            archetype: row.p_archetype, secondary: row.p_secondary, similarity: row.p_similarity,
            sign: row.p_sign, vec: row.p_vec, mixed: row.p_mixed, short_id: row.short_id
          });
        }
        if (fn === 'persona_feedback') {
          const row = db.personas.find(x => x.short_id === p.p_short);
          if (!row) return send(200, 'false');
          db.feedback.push({ archetype: row.p_archetype, vote: p.p_vote });
          return send(200, 'true');
        }
        if (fn === 'persona_stats') {
          const byArch = {};
          db.personas.forEach(x => { byArch[x.p_archetype] = (byArch[x.p_archetype] || 0) + 1; });
          return send(200, {
            total: db.personas.length, today: db.personas.length, by_archetype: byArch,
            feedback: {
              accurate: db.feedback.filter(f => f.vote === 'accurate').length,
              inaccurate: db.feedback.filter(f => f.vote === 'inaccurate').length
            }
          });
        }
        send(404, { message: 'function not found: ' + fn });
      });
      return;
    }

    /* ---- 静态文件 ---- */
    let p = decodeURIComponent(u.pathname);
    if (p === '/') p = '/index.html';
    if (p === '/config.js') {
      res.writeHead(200, { 'Content-Type': MIME['.js'] });
      return res.end(cloud
        ? 'window.APP_CONFIG = { SUPABASE_URL: "http://127.0.0.1:' + PORT_CLOUD +
          '", SUPABASE_ANON_KEY: "mock-anon-key", SITE_NAME: "前世身份档案", SHOW_STATS: true };'
        : 'window.APP_CONFIG = { SUPABASE_URL: "", SUPABASE_ANON_KEY: "", SITE_NAME: "前世身份档案", SHOW_STATS: true };');
    }
    const file = path.resolve(path.join(ROOT, p));
    if (!file.startsWith(path.resolve(ROOT))) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}

/* ---------------- 打开页面 ---------------- */
async function open(port) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/not implemented/i.test(e.message || '')) errors.push(e.message); });
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

  const dom = await JSDOM.fromURL('http://127.0.0.1:' + port + '/', {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      // jsdom 没有 fetch，接上 Node 的实现才能真的打到模拟后端
      window.fetch = (input, init) => fetch(String(input), init);
    }
  });
  const w = dom.window, d = w.document;
  await new Promise(r => { if (d.readyState === 'complete') r(); else { w.addEventListener('load', r); setTimeout(r, 5000); } });
  await sleep(200);

  const $ = s => d.querySelector(s);
  const $$ = s => Array.prototype.slice.call(d.querySelectorAll(s));
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  return { dom, w, d, errors, $, $$, click };
}

async function runQuiz(o) {
  o.click(o.$('[data-go="start"]'));
  for (let i = 0; i < 21; i++) {
    const opts = o.$$('.opt');
    if (opts.length !== 4) throw new Error('第 ' + (i + 1) + ' 步选项数异常：' + opts.length);
    o.click(opts[i % 4]);                 // 每题点不同位置，覆盖所有选项分支
    await sleep(300);
  }
  await sleep(700);                       // 等后端往返
}

/* ---------------- 主流程 ---------------- */
(async function () {
  const sPlain = await makeServer(PORT_PLAIN, false);
  const sCloud = await makeServer(PORT_CLOUD, true);
  const cleanup = () => { sPlain.close(); sCloud.close(); };

  try {
    /* ========== 本地模式 ========== */
    console.log('\n【本地模式】未配置 Supabase 时的完整流程');
    const o = await open(PORT_PLAIN);

    if (o.$('.hero h1')) ok('首页渲染：' + o.$('.hero h1').textContent);
    else bad('首页未渲染');
    o.$$('.meta b').map(e => e.textContent).join('/') === '20/5/18'
      ? ok('元信息 20 题 / 5 维 / 18 原型') : bad('元信息异常');
    o.$('.statline.on') ? ok('提示：' + o.$('.statline').textContent.trim()) : bad('本地模式提示未显示');

    await runQuiz(o);
    const name = o.$('.reshead h2') && o.$('.reshead h2').textContent;
    NAMES.indexOf(name) >= 0 ? ok('档案渲染：' + name + '（' + o.$('.reshead .ttl').textContent + '，' + o.$('.reshead .sim').textContent + '）')
                             : bad('档案未渲染：' + name);
    o.$('svg polygon') ? ok('雷达图已绘制') : bad('雷达图缺失');
    ['你的五维画像', '你的高光与代价', '灵魂副调', '发出去的文案，可以直接复制']
      .forEach(s => o.$$('.sect h3').map(e => e.textContent).indexOf(s) >= 0 ? ok('区块：' + s) : bad('缺区块：' + s));
    o.$('#shareText') && o.$('#shareText').textContent.includes('我测出来是') ? ok('分享文案已生成') : bad('分享文案缺失');

    /^#\/d\//.test(o.w.location.hash) ? ok('地址栏：' + decodeURIComponent(o.w.location.hash)) : bad('地址栏异常：' + o.w.location.hash);
    let last = null; try { last = JSON.parse(o.w.localStorage.getItem('plp.last')); } catch (e) {}
    last && last.a ? ok('已写入本地记忆：' + last.a + ' / ' + last.s) : bad('本地记忆未写入');

    const payload = o.w.location.hash.replace(/^#\/d\//, '');
    o.w.location.hash = '#/'; await sleep(200);
    o.w.location.hash = '#/d/' + payload; await sleep(350);
    o.$('.reshead h2') && o.$('.reshead h2').textContent === name ? ok('分享页还原出同一个人') : bad('分享页结果不一致');
    o.$('[data-go="start"]') ? ok('分享页有引导按钮') : bad('分享页缺引导');

    o.w.location.hash = '#/stats'; await sleep(400);
    o.$('.statgrid') ? ok('统计页渲染（本机 ' + o.$('.statgrid b').textContent + ' 份）') : bad('统计页未渲染');
    o.errors.length ? o.errors.forEach(e => bad('JS 错误：' + e)) : ok('零 JS 报错');
    o.dom.window.close();

    /* ========== 后端模式 ========== */
    console.log('\n【后端模式】接入 Supabase 后的完整流程');
    await fetch('http://127.0.0.1:' + PORT_CLOUD + '/__ctl/reset');
    const c = await open(PORT_CLOUD);

    c.$('.statline.on') ? ok('首页统计行：' + c.$('.statline').textContent.trim()) : bad('统计行未显示');
    c.$('.topbar nav a[href="#/stats"]') ? ok('顶栏出现「统计」入口') : bad('缺统计入口');

    await runQuiz(c);
    const cname = c.$('.reshead h2') && c.$('.reshead h2').textContent;
    NAMES.indexOf(cname) >= 0 ? ok('档案渲染：' + cname) : bad('档案未渲染');
    /^#\/r\/[0-9a-f]+$/.test(c.w.location.hash) ? ok('升级为短链接 ' + c.w.location.hash) : bad('未拿到短链接：' + c.w.location.hash);
    c.$('.fileno') ? ok('档案编号：' + c.$('.fileno').textContent.trim()) : bad('缺档案编号');
    c.$('#shareUrl') && c.$('#shareUrl').textContent.includes('#/r/') ? ok('分享区用短链接') : bad('分享区链接异常');
    c.$('.voterow') ? ok('反馈按钮已出现') : bad('缺反馈按钮');
    c.$('#myStat').textContent.includes('你和多少人一样') ? ok('结果页显示个人占比') : bad('缺个人占比');

    const sent = await (await fetch('http://127.0.0.1:' + PORT_CLOUD + '/__ctl/log')).json();
    const create = sent.find(e => e.fn === 'persona_create');
    create ? ok('请求带 apikey=' + create.apikey + '，五维坐标 [' + create.payload.p_vec.join(',') + ']') : bad('未发出 persona_create');

    const shortId = c.w.location.hash.replace('#/r/', '');
    c.click(c.$('.vbtn[data-vote="accurate"]')); await sleep(600);
    c.$('#voteBox .voted') && c.$('#voteBox .voted').textContent.includes('已经收到')
      ? ok('反馈提交成功') : bad('反馈失败');

    c.w.location.hash = '#/stats'; await sleep(600);
    c.$('.statgrid b').textContent === '1' ? ok('统计页累计档案 = 1') : bad('累计档案异常');
    c.$('.brow') && c.$('.brow').textContent.includes(cname) ? ok('原型分布已统计') : bad('原型分布异常');
    c.errors.length ? c.errors.forEach(e => bad('JS 错误：' + e)) : ok('零 JS 报错');

    /* 换个浏览器用短链接打开 */
    const c2 = await open(PORT_CLOUD);
    c2.w.location.hash = '#/r/' + shortId; await sleep(700);
    c2.$('.reshead h2') && c2.$('.reshead h2').textContent === cname ? ok('短链接在全新会话里还原成功') : bad('短链接还原失败');
    c2.$('.fileno') ? ok('档案编号正常显示') : bad('档案编号缺失');
    c2.$('[data-go="start"]') ? ok('访问者看到「我也要测一次」') : bad('缺引导按钮');
    c2.$('#shareBox') && !c2.$('#shareBox').innerHTML ? ok('访问者看不到别人的分享区') : bad('访问者越权看到分享区');
    c2.errors.length ? c2.errors.forEach(e => bad('JS 错误：' + e)) : ok('零 JS 报错');
    c.dom.window.close(); c2.dom.window.close();

    /* ========== 后端故障降级 ========== */
    console.log('\n【故障降级】后端拒绝写入时，不能白屏');
    await fetch('http://127.0.0.1:' + PORT_CLOUD + '/__ctl/ratelimit');
    const f = await open(PORT_CLOUD);
    await runQuiz(f);
    /^#\/d\//.test(f.w.location.hash) ? ok('自动降级为自带数据链接') : bad('未降级：' + f.w.location.hash);
    f.$('.reshead h2') ? ok('降级后档案仍完整渲染：' + f.$('.reshead h2').textContent) : bad('降级后档案未渲染');
    f.$('#shareBox #shareUrl') ? ok('降级后分享仍可用') : bad('降级后分享不可用');
    f.errors.length ? f.errors.forEach(e => bad('JS 错误：' + e)) : ok('零 JS 报错');
    f.dom.window.close();

    console.log('\n' + (fails === 0 ? '✅ 端到端全部通过' : '❌ ' + fails + ' 项未通过'));
  } finally {
    cleanup();
  }
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('测试崩溃：', e); process.exit(1); });
