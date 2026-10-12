/* ============================================================
 * 原型分布诊断
 * ------------------------------------------------------------
 * 用法（在项目根目录）：
 *     node tools/distribution.js            # 默认各跑 40000 次
 *     node tools/distribution.js 200000     # 想要更稳的结论就加大样本
 *
 * 它做两件事：
 *   A. 均匀随机作答 —— 最坏情况，用来看坐标本身有没有「黑洞」和「死区」
 *      这一列是纯粹的几何结果：谁的 Voronoi 区域大，谁就多。
 *   B. 真人模型     —— 每个人有一条内在倾向曲线，选项越贴近越可能被选，
 *      再叠一点作答噪声。这一列更接近上线后 /stats 页上会看到的比例。
 *
 * 什么时候该动坐标：
 *   - 某一型超过 25%            → 坐标太靠近人群重心，往外推
 *   - 某一型低于 0.5%           → 太偏了，往中间收
 *   - 前三名合计超过 35%        → 整体太挤，需要把头部几型拉开
 * 改坐标只动 assets/js/data.js 里的 archetypes[].vec，算法不用动。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const N = Math.max(1000, parseInt(process.argv[2], 10) || 40000);

const ctx = { console: { log() {} } };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/data.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/engine.js'), 'utf8'), ctx);
const E = ctx.Engine, D = ctx.QUIZ_DATA;

function modelUniform() {
  const ans = D.questions.map(() => Math.floor(Math.random() * 4));
  return E.buildResult(E.calcScores(ans), '改革者');
}

function modelHuman() {
  const latent = D.dims.map(() => Math.random());
  const ans = D.questions.map(q => {
    const i = D.dims.findIndex(d => d.k === q.d);
    let best = 0, bestScore = -Infinity;
    q.o.forEach((o, oi) => {
      const score = -Math.abs(o.v / 3 - latent[i]) + (Math.random() - 0.5) * 0.6;
      if (score > bestScore) { bestScore = score; best = oi; }
    });
    return best;
  });
  return E.buildResult(E.calcScores(ans), '改革者');
}

function run(fn) {
  const hit = new Map();
  let mixed = 0;
  for (let i = 0; i < N; i++) {
    const r = fn();
    if (r.mixed) mixed++;
    hit.set(r.a, (hit.get(r.a) || 0) + 1);
  }
  return { hit, mixed };
}

console.log('每次 ' + N + ' 个模拟用户\n');
const A = run(modelUniform);
const B = run(modelHuman);

const rows = D.archetypes.map(a => ({
  id: a.id,
  name: a.name,
  vec: a.vec,
  a: (A.hit.get(a.id) || 0) / N * 100,
  b: (B.hit.get(a.id) || 0) / N * 100
})).sort((x, y) => y.b - x.b);

const pct = n => n.toFixed(1) + '%';
console.log('原型'.padEnd(8) + '均匀随机'.padStart(10) + '真人模型'.padStart(10) + '   ' + '五维坐标');
console.log('-'.repeat(56));
rows.forEach(r => {
  let flag = '';
  if (r.b > 25) flag = '  ← 超过 25%，往外推';
  else if (r.b < 0.5) flag = '  ← 低于 0.5%，往中间收';
  console.log(r.name.padEnd(8) + pct(r.a).padStart(10) + pct(r.b).padStart(10) + '   [' + r.vec.join(',') + ']' + flag);
});
console.log('-'.repeat(56));

const top3 = rows.slice(0, 3).reduce((s, r) => s + r.b, 0);
console.log('均匀随机：可达 ' + A.hit.size + '/18   混合人格 ' + (A.mixed / N * 100).toFixed(1) + '%');
console.log('真人模型：可达 ' + B.hit.size + '/18   混合人格 ' + (B.mixed / N * 100).toFixed(1) + '%');
console.log('前三名合计 ' + top3.toFixed(1) + '%' + (top3 > 35 ? '  ← 头部太挤，建议把这几个拉开' : '（正常）'));
console.log('');
console.log('提示：改了坐标后重跑一次这个脚本，确认三个指标都回到合理区间，再 push。');
console.log('更细的线上核对用 Supabase SQL Editor：见 supabase/schema.sql 末尾的运维查询。');
