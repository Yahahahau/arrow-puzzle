// node tools/verify-levels.js [maxLevel]
global.window = undefined;
require('../js/engine.js'); require('../js/levels.js');
const AP = globalThis.AP, max = +process.argv[2] || 120;
let bad = 0;
for (let n = 1; n <= max; n++) {
  const t = Date.now(), d = AP.Levels.get(n), e = AP.validate(d);
  const cells = d.cols * d.rows, used = d.arrows.reduce((s, a) => s + a.length, 0);
  if (e.length) { bad++; console.log('LEVEL', n, 'ERR', e.slice(0, 3)); }
  if (n <= 3 || n % 10 === 4 || n === 24) console.log('L' + n, d.cols + 'x' + d.rows, 'arrows', d.arrows.length, 'density', (used / cells * 100).toFixed(0) + '%', 'avgLen', (used / d.arrows.length).toFixed(1), (Date.now() - t) + 'ms');
}
const dd = AP.Levels.daily('2026-11-04');
console.log('daily', dd.cols + 'x' + dd.rows, dd.arrows.length, AP.validate(dd));
console.log(bad ? 'FAILED ' + bad : 'ALL OK');
