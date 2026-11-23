// main.ts — token launch radar. Reads the snapshot, runs dashboard/radar.js, writes /output.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { buildDossier } from './vendor/makefun-board.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const Radar = createRequire(import.meta.url)('./dashboard/radar.js');

const args = process.argv.slice(2);
const inIdx = args.indexOf('--input');
const INPUT = inIdx >= 0 ? args[inIdx + 1] : '/input/snapshot.json';
const OUT = process.env.MAKEFUN_OUTPUT_DIR || '/output';

const snap = JSON.parse(readFileSync(INPUT, 'utf8'));
const R = Radar.run(snap);
const SCEN = { dropShare: 0.07, weeks: 8 }; // the page opens on this same scenario
mkdirSync(OUT, { recursive: true });

// ---- board.json: the ranked no-token protocols, value and plan from radar.js ----
const watch = new Set<string>(snap.watchlist);
const rows = R.board.map((b: any) => {
  const plan = Radar.farmPlan(b, null, SCEN.dropShare, SCEN.weeks, R.exitX);
  return {
    slug: b.slug, name: b.name, rank: b.rank, implied_value_usd: b.implied,
    farm_steps: plan.steps.map(Radar.stepText),
    tier: watch.has(b.slug) ? 'watchlist' : 'early', category: b.f.p.category, tvl_usd: b.f.p.tvl_usd,
    change_7d_pct: b.f.p.change_7d, value_if_launches_usd: Math.round(b.ifLaunch), token_odds: +b.odds.toFixed(4),
    range_p25_p75: [b.lo25, b.hi75], range_p10_p90: [b.lo10, b.hi90], rank_range_p10_p90: [b.rankLo, b.rankHi],
    verdict: plan.verdict, deposit_usd: plan.deposit, net_usd: Math.round(plan.net), net_per_hour_usd: +plan.perHour.toFixed(2)
  };
});
writeFileSync(join(OUT, 'board.json'), JSON.stringify({ rows }, null, 1) + '\n');

// ---- data.js is written after the self-check (it carries the name-scan result) ----
const P = snap.protocols.map((p: any) => [p.slug, p.name, p.category, p.chains, p.tvl_usd, p.change_7d, p.mcap_usd, p.listed_at, p.gecko_id, p.symbol]);
const data = { as_of: snap.as_of, source: snap.source, floor_usd: snap.floor_usd, watchlist: snap.watchlist, protocols: P,
  board: rows.map((r: any) => [r.slug, r.rank, r.implied_value_usd]), scenario: SCEN, name_hits: 0 };

// ---- copy dashboard/ and screenshots/ (regular files, no dot-names) ----
function copyTree(src: string, dst: string) {
  if (!existsSync(src)) return;
  mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) copyTree(join(src, e.name), join(dst, e.name));
    else if (e.isFile()) copyFileSync(join(src, e.name), join(dst, e.name));
  }
}
for (const d of ['dashboard', 'screenshots']) rmSync(join(OUT, d), { recursive: true, force: true }); // no stale files from older runs
copyTree(join(HERE, 'dashboard'), join(OUT, 'dashboard'));
copyTree(join(HERE, 'screenshots'), join(OUT, 'screenshots'));

// ---- self-check: every gate the grader states ----
const fails: string[] = [];
const ok = (c: boolean, m: string) => { if (!c) fails.push(m); };
const slugs = new Set(snap.protocols.map((p: any) => p.slug)), seen = new Set<string>();
ok(rows.length >= 100 && rows.length <= 4000, 'rows 100–4000');
rows.forEach((r: any, i: number) => {
  ok(slugs.has(r.slug) && !seen.has(r.slug), 'slug valid/unique ' + r.slug); seen.add(r.slug);
  ok(r.rank === i + 1, 'rank 1..N');
  ok(Number.isInteger(r.implied_value_usd) && r.implied_value_usd > 0, 'value positive whole');
  if (i) ok(r.implied_value_usd <= rows[i - 1].implied_value_usd, 'non-increasing');
  ok(r.farm_steps.length >= 3 && r.farm_steps.length <= 12, 'steps 3–12');
  r.farm_steps.forEach((s: string) => ok(s.trim().length >= 20 && s.trim().length <= 600, 'step 20–600'));
});
ok(new Set(rows.map((r: any) => r.implied_value_usd)).size > 1, 'not all equal');
ok(snap.watchlist.every((s: string) => seen.has(s)), 'watchlist 40/40');
const counts = Radar.counts(R); ok(Object.values(counts).reduce((a: number, b: any) => a + b, 0) === snap.protocols.length, 'ledger sums');
let dashBytes = 0, names = 0; const kinds = new Set<string>();
for (const f of readdirSync(join(HERE, 'dashboard'))) {
  const t = readFileSync(join(HERE, 'dashboard', f), 'utf8'); dashBytes += Buffer.byteLength(t); kinds.add(f.split('.').pop()!);
  if (/\.html$/.test(f)) ok(!/(src|href|action|style)\s*=\s*["']?[^"'>]*https?:\/\//i.test(t) && !/<style[\s\S]*https?:\/\/[\s\S]*<\/style>/i.test(t), 'no http in html ' + f);
  if (/\.css$/.test(f)) ok(!/https?:\/\//.test(t), 'no http in css ' + f);
  if (/\.js$/.test(f)) ok(!/(import|require)\s*\(?\s*["'`]https?:/.test(t), 'no http import ' + f);
  // no protocol name typed into the code (names of 5+ chars, whole word)
  for (const p of snap.protocols) if (p.name.length >= 5 && new RegExp('\\b' + p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(t)) { names++; console.log('name in code:', p.name, f); }
}
ok(['html', 'css', 'js'].every(k => kinds.has(k)), 'html+css+js');
ok(dashBytes <= 61440, 'dashboard ≤ 60 KB (' + dashBytes + ')');
ok(names === 0, '0 protocol names in code');
const shotDir = join(HERE, 'screenshots');
const shots = existsSync(shotDir) ? readdirSync(shotDir).filter(f => !f.startsWith('.')) : [];
if (shots.length) {
  ok(shots.length === 3, '3 screenshots');
  for (const f of shots) {
    const b = readFileSync(join(shotDir, f)); ok(b.length <= 524288, 'shot ≤ 512 KiB ' + f);
    let w = 0, h = 0;
    if (b[0] === 0x89) { w = b.readUInt32BE(16); h = b.readUInt32BE(20); }
    else for (let i = 2; i < b.length - 9; ) { const m = b[i + 1], len = b.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc3) { h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); break; } i += 2 + len; }
    ok(Math.max(w, h) <= 1440 && Math.min(w, h) >= 800, 'shot size ' + f + ' ' + w + 'x' + h);
  }
} else console.log('note: no screenshots yet — dossier skipped');
if (fails.length) { console.error('SELF-CHECK FAILED:\n' + [...new Set(fails)].join('\n')); process.exit(1); }

// ---- data.js: the raw snapshot in compact form + the board this run wrote ----
data.name_hits = names;
writeFileSync(join(OUT, 'data.js'), 'window.RADAR_DATA = ' + JSON.stringify(data) + ';\n');

// ---- dossier last ----
if (shots.length) writeFileSync(join(OUT, 'dossier.json'), buildDossier(OUT, { text_max_bytes: 65536, screenshots: { max: 4, max_bytes: 524288 }, dashboard: { max_files: 400, max_bytes: 4194304 } }));
const v = rows.reduce((a: any, r: any) => (a[r.verdict] = (a[r.verdict] || 0) + 1, a), {});
console.log(`ok: ${rows.length} rows · ledger ${JSON.stringify(counts)} · verdicts ${JSON.stringify(v)} · dashboard ${dashBytes} B · value kept [${R.value.kept}] · odds kept [${R.odds.kept}]`);
