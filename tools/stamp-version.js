#!/usr/bin/env node
/* Stamp a new build id into index.html (<meta name="app-version">) and version.json.
 * Running games compare the two and auto-update (js/update.js).
 *   node tools/stamp-version.js            -> id from $COMMIT_REF (Netlify) / $GITHUB_SHA / timestamp
 *   node tools/stamp-version.js my-id      -> explicit id
 * Netlify runs it automatically (netlify.toml build command). Run it before each commit when the
 * site is served without a build step (e.g. plain GitHub Pages). */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const id = (process.argv[2] || process.env.COMMIT_REF || process.env.GITHUB_SHA || '').slice(0, 12) ||
  new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const html = path.join(root, 'index.html');
let s = fs.readFileSync(html, 'utf8');
s = s.replace(/<meta name="app-version" content="[^"]*">/, `<meta name="app-version" content="${id}">`);
fs.writeFileSync(html, s);
fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ version: id, builtAt: new Date().toISOString() }) + '\n');
console.log('app-version', id);
