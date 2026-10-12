/* ============================================================
 * 测评引擎 —— 纯逻辑，不碰 DOM，不碰网络
 *   计分 → 五维向量 → 最近邻匹配 → 结果档案
 * 同一份逻辑同时服务于「自己测」和「打开别人的分享」
 * ============================================================ */
(function (global) {
  const D = global.QUIZ_DATA;
  const DIMKEYS = D.dims.map(d => d.k);
  const MAXD = Math.sqrt(5 * 100 * 100);
  const BY_ID = {};
  D.archetypes.forEach(a => { BY_ID[a.id] = a; });

  const TOTAL_Q = D.questions.length;          // 20
  const MAX_PER_DIM = 12;                      // 每维 4 题 × 最高 3 分
  const MIXED_GAP = 1.0;                       // 与第二名差距小于此值即视为混合型

  /* 五维画像：把 0-12 的原始分折算成 0-100 */
  function calcScores(ans) {
    const raw = {};
    DIMKEYS.forEach(k => { raw[k] = 0; });
    D.questions.forEach((q, i) => {
      const pick = ans[i];
      if (pick === null || pick === undefined) return;
      const opt = q.o[pick];
      if (opt) raw[q.d] += opt.v;
    });
    return DIMKEYS.map(k => Math.round(raw[k] / MAX_PER_DIM * 100));
  }

  /* 最近邻匹配：欧氏距离越小越像，相似度折算成百分比 */
  function matchVec(vec) {
    return D.archetypes.map(a => {
      let s = 0;
      for (let i = 0; i < 5; i++) s += Math.pow(vec[i] - a.vec[i], 2);
      const d = Math.sqrt(s);
      return { a: a, dist: d, sim: (1 - d / MAXD) * 100 };
    }).sort((x, y) => y.sim - x.sim);
  }

  const round1 = n => Math.round(n * 10) / 10;

  /* 完整结果记录 —— 这是唯一的结果数据结构，前后端都用它 */
  function buildResult(vec, sign) {
    const ranked = matchVec(vec);
    const top = ranked[0], second = ranked[1];
    return {
      a: top.a.id,
      s: sign,
      v: vec,
      m: round1(top.sim),
      s2: second.a.id,
      m2: round1(second.sim),
      mixed: (top.sim - second.sim) < MIXED_GAP
    };
  }

  /* 只凭 vec + sign 还原完整记录。
     分享链接里只带这两个信息，其余全部重算 —— 链接因此极短，
     而且分享页显示的内容与本人当时看到的永远一致。 */
  function hydrate(vec, sign) {
    const r = buildResult(vec, sign);
    r.short = null;
    return r;
  }

  /* ---------- 分享链接载荷：可读、极短、零依赖 ----------
     #/d/<sign>/<v0>.<v1>.<v2>.<v3>.<v4>
     例：#/d/守护者/30.46.20.38.88                                 */
  function encodePayload(res) {
    return encodeURIComponent(res.s) + '/' + res.v.join('.');
  }

  function decodePayload(path) {
    const parts = String(path || '').split('/');
    if (parts.length < 2) return null;
    let sign;
    try { sign = decodeURIComponent(parts[0]); } catch (e) { return null; }
    const nums = parts[1].split('.');
    if (nums.length !== 5 || nums.some(s => !/^\d{1,3}$/.test(s))) return null;
    const vec = nums.map(n => parseInt(n, 10));
    if (vec.some(n => n < 0 || n > 100)) return null;
    if (!D.pivot.opts.some(o => o.s === sign)) return null;
    return { s: sign, v: vec };
  }

  /* ---------- 结果记录的字段校验（远程数据是不可信的） ---------- */
  const SIGNS = D.pivot.opts.map(o => o.s);
  function normalizeRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.a || raw.archetype || '');
    if (!BY_ID[id]) return null;
    const sign = String(raw.s || raw.sign || '');
    if (SIGNS.indexOf(sign) < 0) return null;
    let vec = raw.v || raw.vec;
    if (!Array.isArray(vec) || vec.length !== 5) return null;
    vec = vec.map(n => Math.max(0, Math.min(100, Math.round(Number(n)))));
    if (vec.some(n => !isFinite(n))) return null;

    const r = hydrate(vec, sign);
    const declaredSim = Number(raw.m !== undefined ? raw.m : raw.similarity);
    // 后端存的匹配度与重算值差异过大时，以重算值为准（防篡改/防脏数据）
    r.m = isFinite(declaredSim) && Math.abs(declaredSim - r.m) < 0.6 ? round1(declaredSim) : r.m;
    if (typeof raw.short === 'string') r.short = raw.short;
    return r;
  }

  /* ---------- 雷达图 ---------- */
  function radarSVG(vec, color) {
    const cx = 160, cy = 150, R = 96;
    const pt = (i, r) => {
      const a = (-90 + 72 * i) * Math.PI / 180;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    };
    let rings = '';
    [0.25, 0.5, 0.75, 1].forEach(f => {
      const p = [0, 1, 2, 3, 4].map(i => pt(i, R * f).map(n => n.toFixed(1)).join(',')).join(' ');
      rings += '<polygon points="' + p + '" fill="none" stroke="#E4E1DA" stroke-width="0.8"/>';
    });
    const axes = [0, 1, 2, 3, 4].map(i => {
      const p = pt(i, R);
      return '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '" stroke="#E4E1DA" stroke-width="0.8"/>';
    }).join('');
    const poly = D.dims.map((d, i) => {
      const p = pt(i, R * vec[i] / 100);
      return p[0].toFixed(1) + ',' + p[1].toFixed(1);
    }).join(' ');
    const dots = D.dims.map((d, i) => {
      const p = pt(i, R * vec[i] / 100);
      return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.2" fill="' + color + '"/>';
    }).join('');
    const labels = D.dims.map((d, i) => {
      const p = pt(i, R + 26);
      return '<text x="' + p[0].toFixed(1) + '" y="' + (p[1] - 3).toFixed(1) + '" text-anchor="middle" font-size="12" fill="#5F5E5A" font-family="sans-serif">' + d.n + '</text>' +
             '<text x="' + p[0].toFixed(1) + '" y="' + (p[1] + 11).toFixed(1) + '" text-anchor="middle" font-size="11" fill="#8C8A83" font-family="sans-serif">' + vec[i] + '</text>';
    }).join('');
    return '<div class="radar"><svg viewBox="0 0 320 300" width="100%" style="max-width:320px" role="img" aria-label="五维性格画像雷达图">' +
      rings + axes +
      '<polygon points="' + poly + '" fill="' + color + '22" stroke="' + color + '" stroke-width="1.8" stroke-linejoin="round"/>' +
      dots + labels + '</svg></div>';
  }

  /* ---------- 分享文案 ---------- */
  function shareText(res) {
    const a = BY_ID[res.a], second = BY_ID[res.s2];
    return '我测出来是【' + a.title + ' · ' + a.name + '】（匹配度 ' + res.m.toFixed(1) + '%）\n' +
      '判词：' + a.verdict + '\n' +
      '灵魂副调：' + second.title + ' · ' + second.name + '\n' +
      a.share[0] + '\n' +
      '你呢？';
  }

  global.Engine = {
    DIMKEYS, BY_ID, MAXD, MIXED_GAP, TOTAL_Q, MAX_PER_DIM,
    calcScores, matchVec, buildResult, hydrate,
    encodePayload, decodePayload, normalizeRecord,
    radarSVG, shareText
  };
})(window);
