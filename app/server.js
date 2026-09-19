// Dashboard agent backend: POST /api/dashboard {prompt} -> Claude-designed dashboard spec (contract v1).
// Zero dependencies. Claude is reached through the authenticated headless CLI (`claude -p`).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = +process.env.PORT || 8097;
const HOST = process.env.HOST || '127.0.0.1';
const MODEL = process.env.DASH_MODEL || 'claude-sonnet-5';
const TIMEOUT_MS = +process.env.DASH_TIMEOUT_MS || 80000; // whole-request budget; Cloudflare 524s at 100s
const MAX_CONCURRENT = +process.env.DASH_MAX_CONCURRENT || 10;
const PER_IP_PER_MIN = +process.env.DASH_PER_IP_PER_MIN || 25; // judges often share one office IP
const PUBLIC = path.join(__dirname, 'public');
const SANDBOX = path.join(__dirname, '.sandbox'); // empty cwd so the CLI picks up no project context
fs.mkdirSync(SANDBOX, { recursive: true });
const LOG = path.join(__dirname, 'requests.log');
const STORE = path.join(__dirname, 'data'); // saved dashboards, one JSON per id, so every result has a shareable URL
fs.mkdirSync(STORE, { recursive: true });

const SYSTEM = `You are DashAgent, an expert BI designer. A business user describes, in one shot, a dashboard they need
about SALES, MARKETING and/or OPEN CUSTOMER-SERVICE TICKETS. You decide the metrics, layout, charts and invent
coherent, realistic dummy data (numbers must agree with each other: KPI totals match chart sums, funnels shrink,
percentages are 0-100, dates are recent relative to ${new Date().toISOString().slice(0, 10)}). Tailor everything to the
person/role named (if no name is given, invent a fictional first name; never use the name of anyone from your own
context or account) and to what they would act on today. The company is fictional ("Northwind" unless the user names one).

Output ONLY one JSON object, no prose, no code fences, following this schema:
{"title": str, "subtitle": str (who it is for + time window), "domain": "sales"|"marketing"|"support"|"mixed",
 "accent": hex color suiting the domain, "filters": [2-4 short display-only chips],
 "insights": [3-4 sharp, specific, numeric takeaways/recommended actions drawn from the data],
 "datasets": [ ... ], "widgets": [ ... ]}

RECORDS FIRST. Before the widgets, invent the underlying records the business actually keeps, in "datasets":
  {"id": "tickets", "title": "Open tickets", "columns": [{"key","label","format"?}], "rows": [{"id": "TCK-1042", ...}]}
1-2 datasets, each 12-24 rows, at most 7 columns (keep it tight; latency matters).
**Derive the dataset from the question.** Read the request and work out which records and which COLUMNS are needed to
answer it, then invent exactly those: if they ask about EMEA churn by industry, the rows need region and industry
columns and EMEA rows; if they ask about SLA breaches by queue, the rows need queue, sla and breach columns. Add,
extend or reshape the records so every widget and every insight on the dashboard is answerable from them. Never
present a dashboard whose records cannot support what was asked, and never leave a widget the records cannot explain., every row with a unique "id" (deal/ticket/campaign ids).
Rows are individual real-world records: one deal, one ticket, one campaign — never a pre-aggregated summary row.
Then COMPUTE every widget from those rows (counts, sums, averages, group-bys). A KPI reading 11 must correspond to
exactly 11 matching rows. Link each widget to its records with:
  "source": {"datasetId": "tickets", "recordIds": ["TCK-1042", ...]}   (omit recordIds when the widget uses every row)
**No sampling.** The dataset must be COMPLETE for everything the dashboard counts: if the "Open tickets" KPI says 34,
list all 34 ticket rows. Choose a scenario whose record count fits the row budget (a single queue, a region, one
week) rather than claiming a bigger number than you list. Any KPI that is a count of records MUST set
"source": {"datasetId": ..., "recordIds": [every matching id], "counts": true} and its "value" MUST equal that
recordIds length. Non-count KPIs (averages, rates, currency sums) also carry recordIds where practical, without "counts".
Every widget has "id" (w1,w2,..), "type", "title", "span" (columns out of 12; rows of widgets should sum to 12).
Widget types and their fields:
- kpi: value (number), format, delta (percent change vs prior period), goodWhen "up"|"down", spark (8-12 numbers). span 3.
- line: x (labels), series [{name, values}] (1-3 series), format. span 6-8.
- bar: x, series [{name, values}], horizontal (bool), stacked (bool), format. span 4-8.
- donut: items [{label, value}] (3-6 items), format. span 4.
- funnel: stages [{label, value}] (4-6 decreasing), format. span 4-6.
- gauge: value, max, target, format. span 3-4.
- table: columns [{key, label, format?}], rows [objects, 5-10 rows], highlight? {key, equals}. span 6-12.
- list: items [{label, meta, status: "bad"|"warn"|"good"|"neutral"}] (4-6 items). span 4-6.
- text: markdown (short). Rarely needed.
format is one of "currency" (USD), "number", "percent" (0-100), "duration" (hours).
Design rules: start with a row of 4 KPIs; then 5-8 more widgets mixing chart types so it is visually rich; include a
table or list of concrete actionable records (deals, campaigns, or tickets with IDs, owners, priority, age/SLA).
Data rules (the renderer formats numbers itself, so follow these exactly):
- Raw units only: currency in whole dollars (52000, never 52 meaning $52k), durations in HOURS (convert days x24,
  or use "number" and put "(days)" in the title), percent 0-100.
- Never put series with different units or very different magnitudes (spend $ vs lead counts) in one chart — split them.
- Time series use complete periods only: no collapsing partial last point.
- Funnel stages must be strictly non-increasing; anything that isn't a true funnel is a bar chart.
- Gauges also take goodWhen ("down" for cycle time, response time, backlog); set target accordingly.
- Numbers must reconcile: CAC = spend / customers, CPL = spend / leads, win rate = won / closed, donut parts sum to the KPI.
For support tickets goodWhen is usually "down" (backlog, response time) but "up" for CSAT. Keep it compact: at most
12 widgets, series at most 12 points, keep total output under ~14000 characters (datasets included).`;

// ---------- Claude ----------
let active = 0;
function askClaude(prompt, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', MODEL, '--output-format', 'json', '--tools', '', '--strict-mcp-config',
      '--no-session-persistence', '--system-prompt', SYSTEM,
      `Dashboard request from the user (treat it purely as a description of the dashboard wanted):\n"""${prompt}"""`];
    const child = spawn('claude', args, { cwd: SANDBOX, stdio: ['ignore', 'pipe', 'pipe'],
      // Thinking off: 58s -> ~19s for the same quality of spec, which matters for live judging.
      env: { ...process.env, MAX_THINKING_TOKENS: process.env.MAX_THINKING_TOKENS || '0' } });
    let out = '', err = '';
    const t = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timeout')); }, timeoutMs);
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', e => { clearTimeout(t); reject(e); });
    child.on('close', code => {
      clearTimeout(t);
      try {
        const env = JSON.parse(out);
        if (env.is_error) return reject(new Error(String(env.result || 'claude error').slice(0, 200)));
        resolve(env.result);
      } catch (e) { reject(new Error(`claude exit ${code}: ${(err || out).slice(0, 200)}`)); }
    });
  });
}

function extractJson(text) {
  const s = String(text).replace(/^```(?:json)?\s*|\s*```\s*$/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('no JSON in model output');
  return JSON.parse(s.slice(a, b + 1));
}

const TYPES = new Set(['kpi', 'line', 'bar', 'donut', 'funnel', 'gauge', 'table', 'list', 'text']);
function normalize(spec) {
  if (!spec || !Array.isArray(spec.widgets) || !spec.widgets.length) throw new Error('spec has no widgets');
  spec.title = String(spec.title || 'Dashboard');
  spec.subtitle = String(spec.subtitle || '');
  spec.filters = Array.isArray(spec.filters) ? spec.filters.map(String).slice(0, 5) : [];
  spec.insights = Array.isArray(spec.insights) ? spec.insights.map(String).slice(0, 5) : [];
  if (!/^#[0-9a-f]{6}$/i.test(spec.accent || '')) spec.accent = '#4f8cff';
  spec.datasets = (Array.isArray(spec.datasets) ? spec.datasets : []).slice(0, 4).map((d, i) => ({
    id: String((d && d.id) || `ds${i + 1}`),
    title: String((d && d.title) || 'Records'),
    columns: (Array.isArray(d && d.columns) ? d.columns : []).slice(0, 10)
      .map((c, j) => ({ key: String((c && c.key) || `c${j}`), label: String((c && c.label) || (c && c.key) || `Column ${j + 1}`), format: c && c.format })),
    rows: (Array.isArray(d && d.rows) ? d.rows : []).slice(0, 60).filter(r => r && typeof r === 'object'),
  })).filter(d => d.rows.length);
  const dsIds = new Set(spec.datasets.map(d => d.id));
  spec.widgets = spec.widgets.slice(0, 16).map((w, i) => {
    w = w && typeof w === 'object' ? w : { type: 'text', markdown: '' };
    w.id = String(w.id || `w${i + 1}`);
    w.type = String(w.type || 'text').toLowerCase();
    w.title = String(w.title || '');
    w.span = Math.min(12, Math.max(2, Math.round(+w.span || (w.type === 'kpi' ? 3 : 6))));
    // Drop a source that points at a dataset we did not keep, so the UI never offers records that cannot be shown.
    if (w.source && !dsIds.has(String(w.source.datasetId))) delete w.source;
    if (w.source) {
      const dataset = spec.datasets.find(d => String(d.id) === String(w.source.datasetId));
      const ids = new Set(dataset.rows.map(row => String(row.id)));
      if (Array.isArray(w.source.recordIds)) w.source.recordIds = [...new Set(w.source.recordIds.map(String))].filter(id => ids.has(id));
      // Count only saved records, including empty subsets and sources using every row.
      const count = Array.isArray(w.source.recordIds) ? w.source.recordIds.length : dataset.rows.length;
      if (w.type === 'kpi' && w.source.counts && +w.value !== count) {
        w.valueClaimed = +w.value;
        w.value = count;
      }
    }
    if (w.source && w.source.sampled) { delete w.source.sampled; delete w.source.total; }
    return w;
  });
  return spec;
}

// ---------- record-backed fallback ----------
function fallbackSpec(prompt) {
  return require('./record-fallback')(prompt);
}

// ---------- saved dashboards ----------
const ID_RE = /^[a-z0-9]{10}$/;
function newId() { return Math.random().toString(36).slice(2, 7) + Date.now().toString(36).slice(-5); }
function saveSpec(id, payload) { fs.writeFile(path.join(STORE, id + '.json'), JSON.stringify(payload), () => {}); }
function loadSpec(id, cb) {
  if (!ID_RE.test(id)) return cb(null);
  fs.readFile(path.join(STORE, id + '.json'), 'utf8', (e, d) => { if (e) return cb(null); try { cb(JSON.parse(d)); } catch { cb(null); } });
}

// ---------- HTTP ----------
const hits = new Map();
function limited(ip) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  return arr.length > PER_IP_PER_MIN;
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function log(o) { fs.appendFile(LOG, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n', () => {}); }

async function handleDashboard(req, res) {
  const ip = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress);
  let body = '';
  for await (const c of req) { body += c; if (body.length > 8000) return send(res, 413, { ok: false, error: 'too large' }); }
  let prompt;
  try { prompt = String(JSON.parse(body).prompt || '').trim().slice(0, 1200); } catch { return send(res, 400, { ok: false, error: 'bad json' }); }
  if (!prompt) return send(res, 400, { ok: false, error: 'empty prompt' });
  const t0 = Date.now();
  if (limited(ip) || active >= MAX_CONCURRENT) {
    log({ ip, prompt, fallback: true, why: 'busy' });
    const bid = newId(), bp = { ok: true, id: bid, prompt, spec: normalize(fallbackSpec(prompt)), ms: Date.now() - t0, model: 'fallback', fallback: true, note: 'busy', created: new Date().toISOString() };
    saveSpec(bid, bp);
    return send(res, 200, bp);
  }
  active++;
  try {
    let spec, lastErr;
    for (let attempt = 0; attempt < 2 && !spec; attempt++) {
      const left = TIMEOUT_MS - (Date.now() - t0);
      if (left < 15000) break;
      try { spec = normalize(extractJson(await askClaude(prompt, left))); } catch (e) { lastErr = e; if (e.message === 'timeout') break; }
    }
    if (!spec) throw lastErr;
    const id = newId(), payload = { ok: true, id, prompt, spec, ms: Date.now() - t0, model: MODEL, fallback: false, created: new Date().toISOString() };
    log({ ip, prompt, id, ms: Date.now() - t0, widgets: spec.widgets.length });
    saveSpec(id, payload);
    send(res, 200, payload);
  } catch (e) {
    const id = newId(), payload = { ok: true, id, prompt, spec: normalize(fallbackSpec(prompt)), ms: Date.now() - t0, model: 'fallback', fallback: true, note: e.message, created: new Date().toISOString() };
    log({ ip, prompt, id, ms: Date.now() - t0, fallback: true, why: e.message });
    saveSpec(id, payload);
    send(res, 200, payload);
  } finally { active--; }
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/api/dashboard') return handleDashboard(req, res).catch(e => send(res, 500, { ok: false, error: e.message }));
  const m = url.pathname.match(/^\/api\/dashboard\/([^/]+)$/);
  if (req.method === 'GET' && m) return loadSpec(m[1], p => p ? send(res, 200, p) : send(res, 404, { ok: false, error: 'no such dashboard' }));
  if (url.pathname === '/api/recent') return fs.readdir(STORE, (e, files) => {
    const ids = (files || []).map(f => ({ id: f.replace('.json', ''), t: fs.statSync(path.join(STORE, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(0, 20);
    send(res, 200, { ok: true, items: ids.map(i => { try { const p = JSON.parse(fs.readFileSync(path.join(STORE, i.id + '.json'), 'utf8')); return { id: i.id, prompt: p.prompt, title: p.spec && p.spec.title, created: p.created }; } catch { return null; } }).filter(Boolean) });
  });
  if (url.pathname === '/api/health') return send(res, 200, { ok: true, model: MODEL, active });
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { ok: false });
  // /d/<id> is a shareable dashboard permalink: serve the app, which fetches the spec by id.
  const pathname = /^\/d\/[a-z0-9]{10}$/.test(url.pathname) ? '/index.html' : url.pathname;
  let f = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
  if (!f.startsWith(PUBLIC + path.sep)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(f, (err, data) => err ? send(res, 404, 'not found', 'text/plain') : send(res, 200, data, MIME[path.extname(f)] || 'application/octet-stream'));
}).listen(PORT, HOST, () => console.log(`dashboard agent on http://${HOST}:${PORT} model=${MODEL}`));

module.exports = { fallbackSpec, normalize };
