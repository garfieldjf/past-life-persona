/* ============================================================
 * 数据层
 *   - 配了 Supabase  → 走后端（短链接 / 全局统计 / 反馈）
 *   - 没配 Supabase  → 静默降级为本地模式，功能不缺、只是不共享
 * 所有网络失败都不会抛给界面：返回 null，界面按「无后端」处理。
 * ============================================================ */
(function (global) {
  const cfg = global.APP_CONFIG || {};
  const BASE = String(cfg.SUPABASE_URL || '').replace(/\/+$/, '');
  const KEY = String(cfg.SUPABASE_ANON_KEY || '').trim();
  const ENABLED = !!(BASE && KEY);
  const TIMEOUT = 6000;

  const LS_LAST = 'plp.last';       // 本机最近一次结果
  const LS_PROG = 'plp.progress';   // 答题进度
  const LS_LOCAL_N = 'plp.localN';  // 本地模式下的生成计数

  /* ---------- 底层请求 ---------- */
  async function rpc(fn, body) {
    if (!ENABLED) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(BASE + '/rest/v1/rpc/' + fn, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'apikey': KEY,
          'Authorization': 'Bearer ' + KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(body || {})
      });
      if (!res.ok) {
        // 限流是预期内的情况，不当成错误上报
        if (res.status === 400 || res.status === 409) return { __rejected: await safeText(res) };
        return null;
      }
      const txt = await res.text();
      if (!txt) return null;
      try { return JSON.parse(txt); } catch (e) { return null; }
    } catch (e) {
      return null;   // 断网 / 超时 / DNS 失败 —— 一律降级
    } finally {
      clearTimeout(timer);
    }
  }

  async function safeText(res) { try { return await res.text(); } catch (e) { return ''; } }

  /* ---------- 写入一份档案，拿回短 ID ---------- */
  async function save(result) {
    if (!ENABLED) { bumpLocal(); return null; }
    const out = await rpc('persona_create', {
      p_archetype: result.a,
      p_secondary: result.s2,
      p_similarity: result.m,
      p_sign: result.s,
      p_vec: result.v,
      p_mixed: !!result.mixed,
      p_ua: (global.navigator && navigator.userAgent) || ''
    });
    const id = typeof out === 'string' ? out : (out && out.short_id) || null;
    return id;
  }

  /* ---------- 按短 ID 取回一份档案 ---------- */
  async function fetchByShort(id) {
    if (!ENABLED || !id) return null;
    const out = await rpc('persona_get', { p_short: String(id) });
    if (!out) return null;
    const row = Array.isArray(out) ? out[0] : out;
    if (!row) return null;
    return {
      a: row.archetype, s: row.sign, v: row.vec, m: Number(row.similarity),
      s2: row.secondary, mixed: !!row.mixed, short: String(id)
    };
  }

  /* ---------- 全局统计 ---------- */
  async function stats() {
    if (!ENABLED) return localStats();
    const out = await rpc('persona_stats', {});
    if (!out) return ENABLED ? null : localStats();
    return {
      total: Number(out.total || 0),
      today: Number(out.today || 0),
      byArchetype: out.by_archetype || {},
      feedback: out.feedback || { accurate: 0, inaccurate: 0 },
      source: 'cloud'
    };
  }

  /* ---------- 反馈 ---------- */
  async function vote(shortId, v) {
    if (!ENABLED || !shortId) return false;
    const out = await rpc('persona_feedback', { p_short: String(shortId), p_vote: v });
    return out !== null && !(out && out.__rejected);
  }

  /* ---------- 本地模式下的兜底统计 ---------- */
  function bumpLocal() {
    try {
      const n = parseInt(localStorage.getItem(LS_LOCAL_N) || '0', 10) + 1;
      localStorage.setItem(LS_LOCAL_N, String(n));
    } catch (e) {}
  }
  function localStats() {
    let n = 0;
    try { n = parseInt(localStorage.getItem(LS_LOCAL_N) || '0', 10); } catch (e) {}
    return { total: n, today: n, byArchetype: {}, feedback: { accurate: 0, inaccurate: 0 }, source: 'local' };
  }

  /* ---------- 本机记忆：进度与最近结果 ---------- */
  const mem = {
    saveProgress(p) { try { localStorage.setItem(LS_PROG, JSON.stringify(p)); } catch (e) {} },
    loadProgress() {
      try { const raw = localStorage.getItem(LS_PROG); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
    },
    clearProgress() { try { localStorage.removeItem(LS_PROG); } catch (e) {} },
    saveLast(r) { try { localStorage.setItem(LS_LAST, JSON.stringify(r)); } catch (e) {} },
    loadLast() {
      try { const raw = localStorage.getItem(LS_LAST); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
    }
  };

  global.Store = { enabled: ENABLED, save, fetchByShort, stats, vote, mem, base: BASE };
})(window);
