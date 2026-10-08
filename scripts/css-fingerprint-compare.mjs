// 比对两份指纹，任何元素/属性不一致都视为回归（见 docs/css-refactor-handover.md 第 4 节）。
//   node scripts/css-fingerprint-compare.mjs /tmp/fp-before.json /tmp/fp-after.json
import fs from 'fs';

const a = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const b = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
let mismatch = 0, onlyA = 0, onlyB = 0;
const details = [];
for (const ctx of Object.keys(a)) {
  const ea = a[ctx], eb = b[ctx] || {};
  for (const k of Object.keys(ea)) {
    if (!(k in eb)) { onlyA++; if (details.length < 40) details.push(`ONLY-BEFORE ${ctx} ${k}`); continue; }
    if (ea[k] !== eb[k]) {
      mismatch++;
      if (details.length < 40) {
        const pa = ea[k].split('\u0001'), pb = eb[k].split('\u0001');
        const diff = [];
        for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) diff.push(`${i}:${pa[i]}->${pb[i]}`);
        details.push(`DIFF ${ctx} ${k} :: ${diff.slice(0, 6).join(', ')}`);
      }
    }
  }
  for (const k of Object.keys(eb)) if (!(k in ea)) { onlyB++; if (details.length < 40) details.push(`ONLY-AFTER ${ctx} ${k}`); }
}
console.log(`mismatch=${mismatch} onlyBefore=${onlyA} onlyAfter=${onlyB}`);
if (details.length) console.log(details.join('\n'));
process.exit(mismatch + onlyA + onlyB === 0 ? 0 : 1);
