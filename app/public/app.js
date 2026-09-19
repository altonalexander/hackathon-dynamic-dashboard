/* Dashboard Agent — frontend renderer for spec contract v1. No dependencies. */
(function () {
  'use strict';

  // ---------- helpers ----------
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, d) => (v == null || v === '' ? (d || '') : String(v));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const nf = (opts) => { try { return new Intl.NumberFormat('en-US', opts); } catch (e) { return new Intl.NumberFormat('en-US'); } };

  function fmt(v, format, opts) {
    const n = num(v);
    if (n === null) return v == null || v === '' ? '—' : String(v);
    const a = Math.abs(n);
    const short = !(opts && opts.full);
    switch (format) {
      case 'currency':
        if (short && a >= 1000) return nf({ style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: a >= 1e6 ? 2 : 1 }).format(n);
        return nf({ style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: a >= 100 || Number.isInteger(n) ? 0 : 2 }).format(n);
      case 'percent':
        return nf({ maximumFractionDigits: a < 10 ? 1 : a < 100 ? 1 : 0 }).format(n) + '%';
      case 'duration': {
        if (a < 1) return Math.round(n * 60) + 'm';
        if (a < 48) return nf({ maximumFractionDigits: a < 10 ? 1 : 0 }).format(n) + 'h';
        return nf({ maximumFractionDigits: 1 }).format(n / 24) + 'd';
      }
      default:
        if (short && a >= 10000) return nf({ notation: 'compact', maximumFractionDigits: a >= 1e6 ? 2 : 1 }).format(n);
        return nf({ maximumFractionDigits: a < 10 ? 2 : a < 1000 ? 1 : 0 }).format(n);
    }
  }

  function hexOk(c) { return typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim()); }
  function palette(accent) {
    const base = ['#2fc5b4', '#f2b33d', '#b07cff', '#ff8a5c', '#5cc8ff', '#e56fb4', '#9bd35a', '#c9a27a'];
    return [accent].concat(base.filter((c) => c.toLowerCase() !== String(accent).toLowerCase()));
  }
  function hexToRgba(h, a) {
    h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function niceTicks(min, max, count) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }
    if (min === max) { max = min + (Math.abs(min) || 1); if (min > 0) min = 0; }
    const span = max - min;
    const step0 = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const r = step0 / mag;
    const step = (r >= 5 ? 10 : r >= 2 ? 5 : r >= 1 ? 2 : 1) * mag;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const t = []; for (let v = lo; v <= hi + step / 2; v += step) t.push(+v.toFixed(10));
    return t;
  }

  function mdLite(md) {
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>').replace(/`(.+?)`/g, '<code>$1</code>');
    const lines = str(md).split(/\r?\n/); let out = '', inList = false;
    for (const l of lines) {
      const m = l.match(/^\s*[-*•]\s+(.*)/);
      if (m) { if (!inList) { out += '<ul>'; inList = true; } out += '<li>' + inline(m[1]) + '</li>'; continue; }
      if (inList) { out += '</ul>'; inList = false; }
      if (l.trim()) out += '<p>' + inline(l.replace(/^#+\s*/, '')) + '</p>';
    }
    if (inList) out += '</ul>';
    return out;
  }

  // ---------- tooltip ----------
  const tip = $('#tooltip');
  function showTip(ev, html, touch) {
    tip.innerHTML = html; tip.hidden = false;
    tip.classList.toggle('touch', !!touch);
    const pad = touch ? 18 : 14, w = tip.offsetWidth, h = tip.offsetHeight;
    // on touch, park the tip above the finger and centred, so the thumb never covers it
    let x = touch ? ev.clientX - w / 2 : ev.clientX + pad;
    let y = touch ? ev.clientY - h - pad : ev.clientY + pad;
    if (x + w > innerWidth - 8) x = touch ? innerWidth - 8 - w : ev.clientX - w - pad;
    if (y < 4) y = ev.clientY + pad;
    if (y + h > innerHeight - 8) y = ev.clientY - h - pad;
    tip.style.left = Math.max(4, x) + 'px'; tip.style.top = Math.max(4, y) + 'px';
  }
  function hideTip() { tip.hidden = true; tip.classList.remove('touch'); }
  const ttRow = (color, label, val) => `<div class="tt-r"><span>${color ? `<i style="background:${color}"></i>` : ''}${esc(label)}</span><b>${esc(val)}</b></div>`;
  // a tap anywhere outside a chart dismisses a touch tooltip
  let tipClear = null;
  addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse') return;
    if (ev.target.closest && ev.target.closest('[data-tt]')) return;
    hideTip(); if (tipClear) { tipClear(); tipClear = null; }
  }, true);
  // Attach tooltips via data-tt attribute holding an index into a per-card array
  function bindTips(el, tips, onEnter, onLeave) {
    const at = (ev, touch) => {
      const t = ev.target.closest && ev.target.closest('[data-tt]');
      if (!t || !el.contains(t)) { hideTip(); onLeave && onLeave(); return false; }
      const i = +t.getAttribute('data-tt');
      if (tips[i] != null) showTip(ev, tips[i], touch);
      el.querySelectorAll('.tt-active').forEach((n) => n.classList.remove('tt-active'));
      t.classList.add('tt-active');
      onEnter && onEnter(i, t);
      return true;
    };
    const clear = () => { el.querySelectorAll('.tt-active').forEach((n) => n.classList.remove('tt-active')); onLeave && onLeave(); };
    el.addEventListener('mousemove', (ev) => { if (!at(ev, false)) clear(); });
    el.addEventListener('mouseleave', () => { hideTip(); clear(); });
    // touch / pen: tap a segment to pin its tooltip, drag along to scrub
    el.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'mouse') return;
      if (at(ev, true)) { if (tipClear && tipClear !== clear) tipClear(); tipClear = clear; }
    });
    el.addEventListener('pointermove', (ev) => {
      if (ev.pointerType === 'mouse' || tip.hidden || !ev.buttons && ev.pressure === 0) return;
      at(ev, true);
    });
  }

  const svgNS = 'http://www.w3.org/2000/svg';

  // ---------- widget renderers ----------
  function seriesOf(w) {
    let s = arr(w.series).filter((x) => x && typeof x === 'object');
    if (!s.length && Array.isArray(w.values)) s = [{ name: w.title || 'Value', values: w.values }];
    return s.map((x, i) => ({ name: str(x.name, 'Series ' + (i + 1)), values: arr(x.values).map(num), color: hexOk(x.color) ? x.color : null }));
  }
  function xLabels(w, n) {
    const x = arr(w.x || w.labels || w.categories);
    const out = []; for (let i = 0; i < n; i++) out.push(x[i] != null ? String(x[i]) : String(i + 1));
    return out;
  }
  function legendHtml(series, pal) {
    if (series.length < 2) return '';
    return '<div class="legend">' + series.map((s, i) => `<span><i style="background:${s.color || pal[i % pal.length]}"></i>${esc(s.name)}</span>`).join('') + '</div>';
  }

  function renderKpi(w, body, ctx) {
    const d = num(w.delta);
    const goodUp = str(w.goodWhen, 'up') !== 'down';
    let cls = 'flat', arrow = '→';
    if (d !== null && Math.abs(d) >= 0.05) { arrow = d > 0 ? '▲' : '▼'; cls = (d > 0) === goodUp ? 'good' : 'bad'; }
    const spark = arr(w.spark).map(num).filter((v) => v !== null);
    let sparkSvg = '';
    if (spark.length > 1) {
      const W = 110, H = 40, mn = Math.min(...spark), mx = Math.max(...spark), r = mx - mn || 1;
      const pts = spark.map((v, i) => [i * (W / (spark.length - 1)), H - 3 - ((v - mn) / r) * (H - 6)]);
      const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
      const col = cls === 'bad' ? 'var(--bad)' : ctx.accent;
      const gid = 'sg' + ctx.uid();
      sparkSvg = `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".35"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
        <path d="${line}L${W} ${H}L0 ${H}Z" fill="url(#${gid})"/><path d="${line}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
        <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="2.5" fill="${col}"/></svg>`;
    }
    const deltaHtml = d === null ? '' : `<span class="delta ${cls}">${arrow} ${fmt(Math.abs(d), 'percent')} <small>${esc(str(w.deltaLabel, 'vs prior'))}</small></span>`;
    body.innerHTML = `<div class="kpi-row"><div><div class="kpi-value" title="${esc(fmt(w.value, w.format, { full: true }))}">${esc(fmt(w.value, w.format))}</div>${deltaHtml}</div>${sparkSvg}</div>`;
    if (w.caption || w.note) body.insertAdjacentHTML('beforeend', `<div class="lm" style="color:var(--faint);font-size:12px;margin-top:6px">${esc(w.caption || w.note)}</div>`);
  }

  function chartFrame(body, height) {
    const W = Math.max(240, Math.floor(body.clientWidth || 400));
    return { W, H: height };
  }

  function renderLine(w, body, ctx, asArea) {
    const series = seriesOf(w);
    const n = Math.max(0, ...series.map((s) => s.values.length));
    if (!series.length || n === 0) { body.innerHTML = '<div class="empty">No data</div>'; return; }
    const labels = xLabels(w, n);
    const pal = ctx.pal;
    const { W, H } = chartFrame(body, w.span >= 8 ? 250 : 220);
    const all = series.flatMap((s) => s.values.filter((v) => v !== null));
    let mn = Math.min(...all), mx = Math.max(...all);
    if (mn > 0 && mn / (mx || 1) < 0.6) mn = 0;
    const ticks = niceTicks(mn, mx, 4);
    const yMin = ticks[0], yMax = ticks[ticks.length - 1];
    const L = 8 + Math.max(...ticks.map((t) => fmt(t, w.format).length)) * 6.4, R = 12, T = 10, B = 24;
    const iw = W - L - R, ih = H - T - B;
    const X = (i) => L + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
    const Y = (v) => T + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
    let g = '';
    ticks.forEach((t) => { g += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${L - 8}" y="${Y(t) + 4}" text-anchor="end">${esc(fmt(t, w.format))}</text>`; });
    const every = Math.ceil(n / Math.max(2, Math.floor(iw / 64)));
    labels.forEach((lb, i) => { if ((i % every === 0 && (i === n - 1 || n - 1 - i >= every * 0.75)) || i === n - 1) g += `<text x="${X(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(lb.length > 10 ? lb.slice(0, 9) + '…' : lb)}</text>`; });
    series.forEach((s, si) => {
      const col = s.color || pal[si % pal.length];
      let d = '', started = false;
      s.values.forEach((v, i) => { if (v === null) { started = false; return; } d += (started ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); started = true; });
      const dashed = /target|goal|plan|forecast|budget|benchmark|last year|prior/i.test(s.name) && series.length > 1;
      if ((si === 0 || asArea) && !dashed) {
        const gid = 'lg' + ctx.uid();
        const valid = s.values.map((v, i) => [v, i]).filter((p) => p[0] !== null);
        if (valid.length > 1) {
          const area = valid.map((p, k) => (k ? 'L' : 'M') + X(p[1]).toFixed(1) + ' ' + Y(p[0]).toFixed(1)).join('') + `L${X(valid[valid.length - 1][1])} ${T + ih}L${X(valid[0][1])} ${T + ih}Z`;
          g += `<defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity="${asArea ? 0.3 : 0.22}"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#${gid})"/>`;
        }
      }
      g += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${dashed ? 1.6 : 2.2}" ${dashed ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
      if (n <= 16 && !dashed) s.values.forEach((v, i) => { if (v !== null) g += `<circle cx="${X(i)}" cy="${Y(v)}" r="2.6" fill="var(--card)" stroke="${col}" stroke-width="1.8"/>`; });
    });
    // hover guide + hit zones
    g += `<line class="guide" x1="0" x2="0" y1="${T}" y2="${T + ih}" stroke="var(--faint)" stroke-dasharray="3 3" visibility="hidden"/>`;
    g += `<g class="dots"></g>`;
    const tips = [];
    for (let i = 0; i < n; i++) {
      const x0 = i === 0 ? L : (X(i - 1) + X(i)) / 2, x1 = i === n - 1 ? W - R : (X(i) + X(i + 1)) / 2;
      g += `<rect data-tt="${i}" x="${x0}" y="${T}" width="${Math.max(1, x1 - x0)}" height="${ih}" fill="transparent"/>`;
      tips.push(`<div class="tt-h">${esc(labels[i])}</div>` + series.map((s, si) => ttRow(s.color || pal[si % pal.length], s.name, fmt(s.values[i], w.format))).join(''));
    }
    body.innerHTML = `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}">${g}</svg>` + legendHtml(series, pal);
    const svg = body.querySelector('svg'), guide = svg.querySelector('.guide'), dots = svg.querySelector('.dots');
    bindTips(body, tips, (i) => {
      guide.setAttribute('x1', X(i)); guide.setAttribute('x2', X(i)); guide.setAttribute('visibility', 'visible');
      dots.innerHTML = series.map((s, si) => s.values[i] === null || s.values[i] === undefined ? '' : `<circle cx="${X(i)}" cy="${Y(s.values[i])}" r="4.5" fill="${s.color || pal[si % pal.length]}" stroke="var(--card)" stroke-width="2"/>`).join('');
    }, () => { guide.setAttribute('visibility', 'hidden'); dots.innerHTML = ''; });
  }

  function renderBar(w, body, ctx) {
    const series = seriesOf(w);
    let n = Math.max(0, ...series.map((s) => s.values.length));
    // allow items-style bars
    if ((!series.length || !n) && arr(w.items).length) {
      const it = arr(w.items);
      series.push({ name: w.title || 'Value', values: it.map((x) => num(x && x.value)) });
      w = Object.assign({}, w, { x: it.map((x) => x && x.label) }); n = it.length;
    }
    if (!series.length || !n) { body.innerHTML = '<div class="empty">No data</div>'; return; }
    const labels = xLabels(w, n), pal = ctx.pal, horiz = !!w.horizontal, stacked = !!w.stacked && series.length > 1;
    const val = (s, i) => (s.values[i] == null ? 0 : s.values[i]);
    let mx = 0, mn = 0;
    for (let i = 0; i < n; i++) {
      if (stacked) { let p = 0, q = 0; series.forEach((s) => { const v = val(s, i); if (v >= 0) p += v; else q += v; }); mx = Math.max(mx, p); mn = Math.min(mn, q); }
      else series.forEach((s) => { mx = Math.max(mx, val(s, i)); mn = Math.min(mn, val(s, i)); });
    }
    const ticks = niceTicks(mn, mx, 4), vMin = ticks[0], vMax = ticks[ticks.length - 1];
    const tips = []; let g = '';
    const tipFor = (i, si) => `<div class="tt-h">${esc(labels[i])}</div>` + (stacked || series.length > 1
      ? series.map((s, k) => ttRow(s.color || pal[k % pal.length], s.name, fmt(s.values[i], w.format))).join('') + (stacked ? ttRow('', 'Total', fmt(series.reduce((a, s) => a + val(s, i), 0), w.format)) : '')
      : ttRow(series[0].color || pal[0], series[0].name, fmt(series[0].values[i], w.format)));
    const W = Math.max(240, Math.floor(body.clientWidth || 400));
    if (horiz) {
      const maxLbl = Math.min(18, Math.max(...labels.map((l) => l.length)));
      const L = 10 + maxLbl * 6.2, R = 56, T = 4, rowH = clamp(Math.floor(220 / n), 22, 34), B = 4;
      const H = T + B + rowH * n, iw = W - L - R;
      const Xv = (v) => L + ((v - vMin) / (vMax - vMin || 1)) * iw;
      const bandPad = 0.28, bh = rowH * (1 - bandPad);
      for (let i = 0; i < n; i++) {
        const y0 = T + i * rowH + (rowH - bh) / 2;
        const lb = labels[i];
        g += `<text x="${L - 8}" y="${T + i * rowH + rowH / 2 + 4}" text-anchor="end">${esc(lb.length > 18 ? lb.slice(0, 17) + '…' : lb)}</text>`;
        if (stacked) {
          let acc = 0;
          series.forEach((s, si) => { const v = val(s, i); const x0 = Xv(acc), x1 = Xv(acc + v); acc += v; tips.push(tipFor(i, si)); g += `<rect class="hot" data-tt="${tips.length - 1}" x="${Math.min(x0, x1)}" y="${y0}" width="${Math.max(0.5, Math.abs(x1 - x0))}" height="${bh}" fill="${s.color || pal[si % pal.length]}" rx="3"/>`; });
          g += `<text x="${Xv(acc) + 6}" y="${y0 + bh / 2 + 4}">${esc(fmt(acc, w.format))}</text>`;
        } else {
          const sh = bh / series.length;
          series.forEach((s, si) => { const v = val(s, i); const x0 = Xv(Math.max(0, vMin)), x1 = Xv(v); tips.push(tipFor(i, si)); g += `<rect class="hot" data-tt="${tips.length - 1}" x="${Math.min(x0, x1)}" y="${y0 + si * sh}" width="${Math.max(0.5, Math.abs(x1 - x0))}" height="${Math.max(2, sh - 2)}" fill="${s.color || pal[si % pal.length]}" rx="3"/>`;
            if (series.length === 1) g += `<text x="${Math.max(x0, x1) + 6}" y="${y0 + sh / 2 + 4}">${esc(fmt(v, w.format))}</text>`; });
        }
      }
      body.innerHTML = `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}">${g}</svg>` + legendHtml(series, pal);
    } else {
      const H = w.span >= 8 ? 250 : 220;
      const L = 8 + Math.max(...ticks.map((t) => fmt(t, w.format).length)) * 6.4, R = 8, T = 10, B = 24;
      const iw = W - L - R, ih = H - T - B, band = iw / n;
      const Yv = (v) => T + ih - ((v - vMin) / (vMax - vMin || 1)) * ih;
      ticks.forEach((t) => { g += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${Yv(t)}" y2="${Yv(t)}"/><text x="${L - 8}" y="${Yv(t) + 4}" text-anchor="end">${esc(fmt(t, w.format))}</text>`; });
      const bw = Math.min(56, band * 0.66);
      const every = Math.ceil(n / Math.max(1, Math.floor(iw / 56)));
      for (let i = 0; i < n; i++) {
        const cx = L + band * i + band / 2;
        if (i % every === 0) { const lb = labels[i]; g += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${esc(lb.length > 10 ? lb.slice(0, 9) + '…' : lb)}</text>`; }
        if (stacked) {
          let acc = 0;
          series.forEach((s, si) => { const v = val(s, i); const y0 = Yv(acc), y1 = Yv(acc + v); acc += v; tips.push(tipFor(i, si)); g += `<rect class="hot" data-tt="${tips.length - 1}" x="${cx - bw / 2}" y="${Math.min(y0, y1)}" width="${bw}" height="${Math.max(0.5, Math.abs(y1 - y0))}" fill="${s.color || pal[si % pal.length]}" rx="2"/>`; });
        } else {
          const sw = bw / series.length;
          series.forEach((s, si) => { const v = val(s, i); const y0 = Yv(Math.max(0, vMin)), y1 = Yv(v); tips.push(tipFor(i, si)); g += `<rect class="hot" data-tt="${tips.length - 1}" x="${cx - bw / 2 + si * sw}" y="${Math.min(y0, y1)}" width="${Math.max(1, sw - (series.length > 1 ? 2 : 0))}" height="${Math.max(0.5, Math.abs(y1 - y0))}" fill="${s.color || pal[si % pal.length]}" rx="3"/>`; });
        }
      }
      body.innerHTML = `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}">${g}</svg>` + legendHtml(series, pal);
    }
    const svg = body.querySelector('svg');
    bindTips(body, tips, () => svg.classList.add('dim'), () => svg.classList.remove('dim'));
  }

  function renderDonut(w, body, ctx) {
    const items = arr(w.items || w.slices || w.segments).filter((x) => x && typeof x === 'object').map((x) => ({ label: str(x.label || x.name, '—'), value: Math.max(0, num(x.value) || 0), color: hexOk(x.color) ? x.color : null }));
    const total = items.reduce((a, b) => a + b.value, 0);
    if (!items.length || total <= 0) { body.innerHTML = '<div class="empty">No data</div>'; return; }
    const pal = ctx.pal, R = 80, r = 54, C = 85; let a0 = -Math.PI / 2, g = '';
    const tips = [];
    items.forEach((it, i) => {
      const frac = it.value / total, a1 = a0 + frac * Math.PI * 2, col = it.color || pal[i % pal.length];
      const pct = fmt(frac * 100, 'percent');
      tips.push(`<div class="tt-h">${esc(w.title || '')}</div>` + ttRow(col, it.label, w.format === 'percent' ? fmt(it.value, 'percent') : fmt(it.value, w.format) + ' · ' + pct));
      if (frac >= 0.9999) { g += `<circle class="hot" data-tt="${i}" cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" stroke="${col}" stroke-width="${R - r}"/>`; }
      else {
        const gap = items.length > 1 ? 0.012 : 0, b0 = a0 + gap, b1 = a1 - gap, large = b1 - b0 > Math.PI ? 1 : 0;
        const p = (ang, rad) => (C + rad * Math.cos(ang)).toFixed(2) + ' ' + (C + rad * Math.sin(ang)).toFixed(2);
        if (b1 > b0) g += `<path class="hot" data-tt="${i}" d="M${p(b0, R)}A${R} ${R} 0 ${large} 1 ${p(b1, R)}L${p(b1, r)}A${r} ${r} 0 ${large} 0 ${p(b0, r)}Z" fill="${col}"/>`;
      }
      a0 = a1;
    });
    const centerVal = w.format === 'percent' ? (items.length ? items[0].label : '') : fmt(total, w.format);
    const centerSub = w.format === 'percent' ? fmt(items[0].value, 'percent') : 'total';
    g += `<text x="${C}" y="${C - 2}" text-anchor="middle" style="font-size:${String(centerVal).length > 9 ? 13 : 18}px;font-weight:700;fill:var(--text)">${esc(String(centerVal).slice(0, 14))}</text><text x="${C}" y="${C + 16}" text-anchor="middle">${esc(centerSub)}</text>`;
    const leg = items.map((it, i) => `<div data-tt="${i}"><span><i style="background:${it.color || pal[i % pal.length]}"></i>${esc(it.label)}</span><b>${esc(w.format === 'percent' ? fmt(it.value, 'percent') : fmt(it.value, w.format))}</b></div>`).join('');
    body.innerHTML = `<div class="donut-wrap"><svg viewBox="0 0 170 170">${g}</svg><div class="donut-legend">${leg}</div></div>`;
    const svg = body.querySelector('svg');
    bindTips(body, tips, () => svg.classList.add('dim'), () => svg.classList.remove('dim'));
  }

  function renderFunnel(w, body, ctx) {
    const st = arr(w.stages || w.items).filter((x) => x && typeof x === 'object').map((x) => ({ label: str(x.label || x.name, '—'), value: num(x.value) || 0 }));
    if (!st.length) { body.innerHTML = '<div class="empty">No data</div>'; return; }
    const mx = Math.max(...st.map((s) => s.value)) || 1, tips = [];
    let h = '<div class="funnel">';
    st.forEach((s, i) => {
      const pct = clamp((s.value / mx) * 100, 6, 100);
      let conv = i > 0 && st[i - 1].value ? (s.value / st[i - 1].value) * 100 : null; if (conv !== null && conv > 100) conv = null;
      const alpha = 1 - (i / Math.max(1, st.length)) * 0.55;
      tips.push(`<div class="tt-h">${esc(s.label)}</div>` + ttRow('', 'Count', fmt(s.value, w.format, { full: true })) + (conv !== null ? ttRow('', 'From previous', fmt(conv, 'percent')) : '') + ttRow('', 'Of top', fmt((s.value / mx) * 100, 'percent')));
      h += `<div class="fstage"><div class="lbl" title="${esc(s.label)}">${esc(s.label)}${conv !== null ? `<div class="fconv" style="text-align:left">↳ ${fmt(conv, 'percent')} conv.</div>` : ''}</div><div class="fbar-track"><div class="fbar" data-tt="${i}" style="width:${pct}%;background:${hexToRgba(ctx.accent, alpha)}">${esc(fmt(s.value, w.format))}</div></div></div>`;
    });
    body.innerHTML = h + '</div>';
    bindTips(body, tips);
  }

  function renderGauge(w, body, ctx) {
    const max = num(w.max) || (w.format === 'percent' ? 100 : Math.max(1, (num(w.value) || 0) * 1.25));
    const min = num(w.min) || 0;
    const v = num(w.value);
    if (v === null) { body.innerHTML = '<div class="empty">No data</div>'; return; }
    const frac = clamp((v - min) / (max - min || 1), 0, 1);
    const target = num(w.target);
    const good = str(w.goodWhen, 'up') !== 'down';
    let col = ctx.accent;
    if (target !== null) col = (good ? v >= target : v <= target) ? 'var(--good)' : (Math.abs(v - target) / (Math.abs(target) || 1) < 0.1 ? 'var(--warn)' : 'var(--bad)');
    const C = 100, R = 80, sw = 16;
    const pt = (f, rad) => { const a = Math.PI * (1 - f); return (C + rad * Math.cos(a)).toFixed(2) + ' ' + (C - rad * Math.sin(a)).toFixed(2); };
    let g = `<path d="M${pt(0, R)}A${R} ${R} 0 0 1 ${pt(1, R)}" fill="none" stroke="var(--card2)" stroke-width="${sw}" stroke-linecap="round"/>`;
    if (frac > 0.001) g += `<path d="M${pt(0, R)}A${R} ${R} 0 0 1 ${pt(frac, R)}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>`;
    if (target !== null) { const tf = clamp((target - min) / (max - min || 1), 0, 1); g += `<line x1="${pt(tf, R - 14).split(' ')[0]}" y1="${pt(tf, R - 14).split(' ')[1]}" x2="${pt(tf, R + 14).split(' ')[0]}" y2="${pt(tf, R + 14).split(' ')[1]}" stroke="var(--text)" stroke-width="2.5"/>`; }
    body.innerHTML = `<div class="gauge"><svg viewBox="0 0 200 118">${g}<text x="${C - R}" y="116" text-anchor="middle">${esc(fmt(min, w.format))}</text><text x="${C + R}" y="116" text-anchor="middle">${esc(fmt(max, w.format))}</text></svg>
      <div class="gauge-val">${esc(fmt(v, w.format))}</div><div class="gauge-sub">${target !== null ? 'Target ' + esc(fmt(target, w.format)) : esc(fmt(frac * 100, 'percent')) + ' of max'}</div></div>`;
  }

  function renderTable(w, body) {
    const rows = arr(w.rows).filter((r) => r && typeof r === 'object');
    let cols = arr(w.columns).map((c) => (typeof c === 'string' ? { key: c, label: c } : c)).filter((c) => c && c.key != null);
    if (!cols.length && rows.length) cols = Object.keys(rows[0]).map((k) => ({ key: k, label: k }));
    if (!rows.length) { body.innerHTML = '<div class="empty">No rows</div>'; return; }
    const hl = w.highlight && typeof w.highlight === 'object' ? w.highlight : null;
    const isHl = (r) => {
      if (!hl || hl.key == null) return false;
      const v = r[hl.key];
      if ('equals' in hl) return Array.isArray(hl.equals) ? hl.equals.map(String).includes(String(v)) : String(v) === String(hl.equals);
      if ('gt' in hl) return num(v) !== null && num(v) > num(hl.gt);
      if ('lt' in hl) return num(v) !== null && num(v) < num(hl.lt);
      return false;
    };
    const isNum = (c) => ['currency', 'number', 'percent', 'duration'].includes(c.format);
    const pill = (v) => { const s = String(v); const m = /^(urgent|critical|high|p1|overdue|at risk|breached|lost|churned)$/i.test(s) ? 'bad' : /^(medium|med|p2|pending|waiting|warn)$/i.test(s) ? 'warn' : /^(low|p3|p4|ok|won|resolved|on track|healthy|closed)$/i.test(s) ? 'good' : ''; return m ? `<span class="dot ${m}" style="display:inline-block;margin:0 6px 0 0;vertical-align:0"></span>${esc(s)}` : esc(s); };
    let h = '<div class="table-wrap"><table><thead><tr>' + cols.map((c) => `<th class="${isNum(c) ? 'num' : ''}">${esc(str(c.label, c.key))}</th>`).join('') + '</tr></thead><tbody>';
    rows.slice(0, 200).forEach((r) => { h += `<tr class="${isHl(r) ? 'hl' : ''}">` + cols.map((c) => { const v = r[c.key]; return isNum(c) ? `<td class="num">${esc(fmt(v, c.format, { full: c.format !== 'currency' || Math.abs(num(v) || 0) < 1e6 }))}</td>` : `<td>${typeof v === 'object' && v !== null ? esc(JSON.stringify(v)) : pill(v == null ? '—' : v)}</td>`; }).join('') + '</tr>'; });
    body.innerHTML = h + '</tbody></table></div>';
  }

  function renderList(w, body) {
    const items = arr(w.items).map((x) => (typeof x === 'string' ? { label: x } : x)).filter((x) => x && typeof x === 'object');
    if (!items.length) { body.innerHTML = '<div class="empty">Nothing to show</div>'; return; }
    const ok = { good: 1, bad: 1, warn: 1, neutral: 1 };
    body.innerHTML = '<ul class="list">' + items.map((it) => `<li><span class="dot ${ok[it.status] ? it.status : 'neutral'}"></span><div><div>${esc(str(it.label || it.title || it.name, '—'))}</div>${it.meta || it.detail ? `<div class="lm">${esc(it.meta || it.detail)}</div>` : ''}</div></li>`).join('') + '</ul>';
  }

  function renderText(w, body) { body.innerHTML = `<div class="text-body">${mdLite(w.markdown || w.text || w.body || '')}</div>`; }

  const RENDERERS = { kpi: renderKpi, metric: renderKpi, stat: renderKpi, line: renderLine, area: (w, b, c) => renderLine(w, b, c, true), bar: renderBar, column: renderBar, donut: renderDonut, pie: renderDonut, funnel: renderFunnel, gauge: renderGauge, table: renderTable, list: renderList, text: renderText, markdown: renderText, note: renderText };

  // ---------- dashboard ----------
  let current = null; // {spec, meta}
  function renderDashboard(spec, meta) {
    spec = spec && typeof spec === 'object' ? spec : {};
    meta = meta || {};
    current = { spec, meta };
    $('#sectionNav').hidden = false;
    const accent = hexOk(spec.accent) ? spec.accent.trim() : '#4f8cff';
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-soft', hexToRgba(accent.length === 4 ? '#' + accent.slice(1).split('').map((c) => c + c).join('') : accent, 0.14));
    setTimeout(() => {
      const cb = document.getElementById('copyLink');
      if (!cb) return;
      cb.onclick = () => {
        const url = location.origin + '/d/' + meta.id;
        const done = () => { cb.textContent = 'Link copied'; setTimeout(() => (cb.textContent = 'Copy link'), 1600); };
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, done); else done();
      };
    }, 0);
    let uidN = 0;
    const ctx = { accent, pal: palette(accent), uid: () => (++uidN) + '_' + Math.random().toString(36).slice(2, 6) };
    const dash = $('#dash');
    const secs = num(meta.ms) !== null ? (meta.ms / 1000).toFixed(1) : null;
    const filters = arr(spec.filters).filter((f) => f != null && typeof f !== 'object');
    const insights = arr(spec.insights).filter((f) => f != null && typeof f !== 'object');
    dash.innerHTML = `
      <div class="dash-head">
        <div style="min-width:0;flex:1">
          <h1>${esc(str(spec.title, 'Dashboard'))}</h1>
          ${spec.subtitle ? `<div class="sub">${esc(spec.subtitle)}</div>` : ''}
          ${filters.length ? `<div class="filters">${filters.map((f) => `<span class="filter">${esc(f)}</span>`).join('')}</div>` : ''}
          ${meta.prompt ? `<div class="asked">“${esc(meta.prompt)}”</div>` : ''}
        </div>
        <div class="meta">
          ${spec.domain ? `<span class="badge dom">${esc(spec.domain)}</span>` : ''}
          ${meta.fallback ? '<span class="badge fallback" title="Claude did not answer in time; a pre-built dashboard was used">fallback</span>' : ''}
          <span class="badge" title="All numbers are generated dummy data">Illustrative data</span>
          ${meta.id ? `<button class="badge" id="copyLink" type="button" title="Copy a shareable link to this dashboard">Copy link</button>` : ''}
          ${meta.sample ? '<span class="badge">sample</span>' : secs ? `<span title="${esc(meta.model || '')}">Generated by Claude in ${secs}s</span>` : ''}
        </div>
      </div>
      ${insights.length ? `<div class="insights"><h3>✦ AI insights</h3><ul>${insights.slice(0, 6).map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>` : ''}
      <div class="grid" id="grid"></div>
      <div class="disclosure">Illustrative data generated by AI · no live integrations</div>`;
    const grid = $('#grid', dash);
    const widgets = arr(spec.widgets).filter((w) => w && typeof w === 'object');
    if (!widgets.length) grid.innerHTML = '<div class="card" style="grid-column:1/-1"><div class="empty">The agent returned no widgets.</div></div>';
    // pack rows: stretch the last card of an underfilled row so the grid never leaves holes
    const spans = widgets.map((w) => { const t = str(w.type).toLowerCase(); return clamp(Math.round(num(w.span) || (t === 'kpi' ? 3 : t === 'table' ? 12 : 6)), 1, 12); });
    (function () { let used = 0, start = 0; for (let k = 0; k <= spans.length; k++) { if (k === spans.length || used + spans[k] > 12) { if (k > start && used < 12 && used >= 6) spans[k - 1] += 12 - used; else if (k > start && used < 12 && k - start > 1) { const extra = 12 - used, cnt = k - start; for (let m = start; m < k; m++) spans[m] += Math.floor(extra / cnt) + (m - start < extra % cnt ? 1 : 0); } if (k === spans.length) break; used = 0; start = k; } used += spans[k]; } })();
    widgets.forEach((w, i) => {
      const card = document.createElement('div');
      card.className = 'card';
      const type = str(w.type).toLowerCase();
      const span = spans[i];
      card.style.gridColumn = 'span ' + span;
      card.style.animationDelay = Math.min(i * 40, 600) + 'ms';
      const sourceIndex = spec.widgets.indexOf(w);
      card.innerHTML = `<div class="card-title"><span>${esc(str(w.title, ''))}</span><span class="card-actions">${w.badge ? `<span class="badge">${esc(w.badge)}</span>` : ''}<button class="view-data" type="button" data-dataset-index="${sourceIndex}" aria-label="View records for ${esc(str(w.title, 'this card'))}">View records <span aria-hidden="true">↗</span></button></span></div><div class="card-body"></div>`;
      grid.appendChild(card);
      const body = card.querySelector('.card-body');
      const r = RENDERERS[type];
      try {
        if (r) r(Object.assign({}, w, { span }), body, ctx);
        else body.innerHTML = `<div class="unsupported">Widget type “${esc(type || 'unknown')}” isn't supported yet</div>`;
        const metric = body.querySelector('.kpi-value');
        if (metric) {
          const drill = document.createElement('button');
          drill.type = 'button'; drill.className = 'kpi-value metric-drill';
          drill.dataset.datasetIndex = String(sourceIndex);
          drill.setAttribute('aria-label', `View records for ${str(w.title, 'this metric')}`);
          drill.innerHTML = metric.innerHTML;
          metric.replaceWith(drill);
        }
      } catch (e) {
        console.error('widget render failed', w, e);
        body.innerHTML = '<div class="unsupported">This widget could not be drawn</div>';
      }
    });
    lastWidth = dash.clientWidth;
  }

  // re-render charts on width change
  let lastWidth = 0, rt = null;
  addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { const d = $('#dash'); if (current && !d.hidden && Math.abs(d.clientWidth - lastWidth) > 30) { const y = scrollY; renderDashboard(current.spec, current.meta); scrollTo(0, y); } }, 180);
  });

  // ---------- views ----------
  function resolveRecords(widget) {
    const source = widget && widget.source;
    const dataset = arr(current && current.spec.datasets).find(data => data && String(data.id) === String(source && source.datasetId));
    if (!source || !dataset || !Array.isArray(dataset.rows)) return null;
    let rows = dataset.rows.filter(row => row && typeof row === 'object');
    if (Array.isArray(source.recordIds)) {
      const ids = new Set(source.recordIds.map(String));
      rows = rows.filter(row => ids.has(String(row.id)));
      if (new Set(rows.map(row => String(row.id))).size !== ids.size) return null;
    }
    return { dataset, rows };
  }
  const cellText = value => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  function updateDataTable() {
    const selection = $('#datasetSelect').value;
    const allDataset = selection.startsWith('dataset:') ? arr(current && current.spec.datasets)[Number(selection.slice(8))] : null;
    const widget = allDataset ? null : arr(current && current.spec.widgets)[Number(selection)];
    const resolved = allDataset && Array.isArray(allDataset.rows) ? { dataset: allDataset, rows: allDataset.rows } : resolveRecords(widget);
    const details = $('#rawData').closest('details');
    details.hidden = !resolved;
    if (!resolved) {
      $('#dataTable').innerHTML = '<p class="empty">The underlying records were not saved with this dashboard. Create a new dashboard to explore its individual records.</p>';
      $('#dataSummary').textContent = 'Source records unavailable'; $('#rawData').textContent = ''; return;
    }
    const { dataset, rows } = resolved;
    const query = $('#dataSearch').value.trim().toLowerCase();
    const visible = rows.filter(row => Object.values(row).some(value => cellText(value).toLowerCase().includes(query)));
    const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
    const labels = Object.fromEntries(arr(dataset.columns).map(column => [column.key, column.label]));
    const sampled = widget && widget.source && widget.source.sampled;
    $('#dataSummary').textContent = sampled
      ? `${visible.length} shown from ${rows.length} saved sample records · ${str(widget.source.total, '?')} total reported · Partial dataset`
      : `${visible.length} of ${rows.length} records · ${str(dataset.title, dataset.id)}${widget ? ' · ' + str(widget.title) : ''}`;
    $('#dataTable').innerHTML = visible.length
      ? `<table><thead><tr>${keys.map(key => `<th scope="col">${esc(labels[key] || key)}</th>`).join('')}</tr></thead><tbody>${visible.map(row => `<tr>${keys.map(key => `<td>${esc(cellText(row[key]))}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      : `<p class="empty">${rows.length ? 'No matching records. Try a different search.' : 'No records match this metric.'}</p>`;
    $('#rawData').textContent = JSON.stringify(rows, null, 2);
  }
  function openExplorer(datasetIndex) {
    if (!current) return;
    const datasets = arr(current.spec.datasets);
    const datasetOptions = datasets.map((data, index) => data && Array.isArray(data.rows) ? `<option value="dataset:${index}">${esc(str(data.title, data.id))} · ${data.rows.length} records</option>` : '').join('');
    const widgetOptions = arr(current.spec.widgets).map((widget, index) => widget && typeof widget === 'object' && (widget.source || index === datasetIndex) ? `<option value="${index}">${esc(str(widget.title, 'Card ' + (index + 1)))}</option>` : '').join('');
    $('#datasetSelect').innerHTML = (datasetOptions ? `<optgroup label="All records">${datasetOptions}</optgroup>` : '') + (widgetOptions ? `<optgroup label="Records behind a card">${widgetOptions}</optgroup>` : '') || '<option value="">No source datasets</option>';
    if (datasetIndex !== undefined && Array.from($('#datasetSelect').options).some(option => option.value === String(datasetIndex))) $('#datasetSelect').value = String(datasetIndex);
    $('#dataSearch').value = '';
    view('explorer');
    updateDataTable();
    scrollTo(0, 0);
    $('#datasetSelect').focus({ preventScroll: true });
  }
  $('#explorerTab').addEventListener('click', () => openExplorer());
  $('#dash').addEventListener('click', event => {
    const button = event.target.closest('[data-dataset-index]');
    if (button) openExplorer(Number(button.dataset.datasetIndex));
  });
  $('#dashboardTab').addEventListener('click', () => { if (current) { view('dash'); renderDashboard(current.spec, current.meta); } });
  $('#datasetSelect').addEventListener('change', () => { $('#dataSearch').value = ''; updateDataTable(); });
  $('#dataSearch').addEventListener('input', updateDataTable);
  let dashboardTheme = 'dark';
  try {
    const saved = localStorage.getItem('prism-dashboard-theme');
    if (['dark', 'light', 'midnight', 'party'].includes(saved)) dashboardTheme = saved;
  } catch (e) { /* Theme switching also works without storage. */ }
  function applyDashboardTheme() {
    document.documentElement.dataset.theme = $('#dash').hidden && $('#explorer').hidden ? 'dark' : dashboardTheme;
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === dashboardTheme));
    });
  }
  $('#themeSwitch').addEventListener('click', event => {
    const button = event.target.closest('[data-theme-choice]');
    if (!button) return;
    dashboardTheme = button.dataset.themeChoice;
    try { localStorage.setItem('prism-dashboard-theme', dashboardTheme); } catch (e) { /* optional */ }
    applyDashboardTheme();
  });
  function view(name) {
    $('#hero').hidden = name !== 'hero';
    $('#loading').hidden = name !== 'loading';
    $('#dash').hidden = name !== 'dash';
    $('#explorer').hidden = name !== 'explorer';
    $('#sectionNav').hidden = name !== 'dash' && name !== 'explorer';
    for (const [id, active] of [['dashboardTab', name === 'dash'], ['explorerTab', name === 'explorer']]) {
      if (active) $('#' + id).setAttribute('aria-current', 'page');
      else $('#' + id).removeAttribute('aria-current');
    }
    $('#newBtn').hidden = name === 'hero';
    $('#themeSwitch').hidden = name !== 'dash' && name !== 'explorer';
    applyDashboardTheme();
    hideTip();
  }

  const CHIPS = [
    ['Sales overview', 'Build a dashboard for our West-region sales manager'],
    ['Marketing performance', 'Marketing director: campaign ROI this quarter'],
    ['Support queue', 'What should our support team lead watch this morning?'],
  ];

  // ---------- loading ----------
  let loadTimer = null, statusTimer = null;
  function startLoading(prompt) {
    view('loading');
    document.documentElement.style.setProperty('--accent', '#4f8cff');
    document.documentElement.style.setProperty('--accent-soft', 'rgba(79,140,255,.14)');
    $('#loadingPrompt').textContent = '“' + prompt + '”';
    const p = prompt.toLowerCase();
    const dom = /ticket|support|sla|csat|customer service|agent|queue|escalat/.test(p) ? 'support' : /campaign|marketing|roi|lead|seo|social|ads?\b|signup|brand|email/.test(p) ? 'marketing' : 'sales';
    const topical = {
      sales: ['Modelling pipeline, bookings and quota…', 'Ranking reps and deals at risk…', 'Estimating forecast coverage…'],
      marketing: ['Simulating spend across channels…', 'Computing CAC and campaign ROI…', 'Tracing the lead funnel…'],
      support: ['Generating open tickets by priority…', 'Checking SLA breach risk…', 'Measuring backlog and response times…'],
    }[dom];
    const lines = ['Reading the request…', 'Figuring out who this is for…', 'Choosing metrics…', topical[0], 'Generating data…', topical[1], 'Picking the right charts…', topical[2], 'Laying out widgets…', 'Writing insights…', 'Checking the numbers add up…', 'Polishing the layout…', 'Almost there…'];
    let i = 0; const st = $('#status'); st.textContent = lines[0];
    clearInterval(statusTimer);
    statusTimer = setInterval(() => {
      i = Math.min(i + 1, lines.length - 1);
      if (i === lines.length - 1 && st.textContent === lines[i]) return;
      st.classList.add('fade'); setTimeout(() => { st.textContent = lines[i]; st.classList.remove('fade'); }, 250);
    }, 2800);
    const t0 = performance.now();
    clearInterval(loadTimer);
    loadTimer = setInterval(() => { const s = (performance.now() - t0) / 1000; $('#timer').textContent = s.toFixed(1) + 's'; const pb = $('#progress'); if (pb) pb.style.width = (95 * (1 - Math.exp(-s / 18))).toFixed(1) + '%'; }, 100);
    // skeleton
    const sk = $('#skeleton');
    const layout = [[3], [3], [3], [3], [8, 1], [4, 1], [6, 1], [6, 1]];
    sk.innerHTML = layout.map((l, k) => `<div class="card ${l[1] ? 'tall' : ''}" style="grid-column:span ${l[0]};animation-delay:${k * 350}ms"><div class="sk-line" style="width:40%"></div><div class="sk-line" style="width:${l[1] ? 90 : 60}%;height:${l[1] ? 12 : 22}px"></div>${l[1] ? '<div class="sk-line" style="width:75%"></div><div class="sk-line" style="width:82%"></div><div class="sk-line" style="width:64%"></div>' : ''}</div>`).join('');
  }
  function stopLoading() { clearInterval(loadTimer); clearInterval(statusTimer); }

  // ---------- history ----------
  let history = [];
  try { history = JSON.parse(sessionStorage.getItem('dd-history') || '[]'); if (!Array.isArray(history)) history = []; } catch (e) { history = []; }
  function saveHistory() { try { sessionStorage.setItem('dd-history', JSON.stringify(history.slice(0, 12))); } catch (e) { /* ignore */ } }
  function renderHistory() {
    const wrap = $('#historyWrap'), list = $('#history');
    wrap.hidden = !history.length;
    list.innerHTML = history.map((h, i) => `<button class="hist-item" data-h="${i}" style="--c:${hexOk(h.spec && h.spec.accent) ? h.spec.accent : 'var(--accent)'}"><b>${esc(str(h.spec && h.spec.title, 'Dashboard'))}</b><span>${esc(h.prompt)}</span></button>`).join('');
  }
  $('#history').addEventListener('click', (e) => {
    const b = e.target.closest('[data-h]'); if (!b) return;
    const h = history[+b.getAttribute('data-h')]; if (!h) return;
    if (h.meta && h.meta.id) { navigate('/d/' + h.meta.id, { spec: h.spec, meta: h.meta }); return; }
    view('dash'); renderDashboard(h.spec, h.meta); scrollTo(0, 0);
  });

  // ---------- API ----------
  let inflight = null;
  async function run(prompt) {
    prompt = str(prompt).trim();
    if (!prompt) { $('#prompt').focus(); return; }
    if (inflight) inflight.abort();
    const ac = new AbortController(); inflight = ac;
    const kill = setTimeout(() => ac.abort(), 120000);
    startLoading(prompt); scrollTo(0, 0);
    const t0 = performance.now();
    try {
      const res = await fetch('/api/dashboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }), signal: ac.signal });
      let data = null; try { data = await res.json(); } catch (e) { data = null; }
      if (inflight !== ac) return;
      const spec = data && (data.spec || (data.widgets ? data : null));
      if (!spec) throw new Error((data && (data.error || data.message)) || 'HTTP ' + res.status);
      const meta = { prompt, id: data.id, ms: num(data.ms) !== null ? data.ms : performance.now() - t0, model: data.model, fallback: !!data.fallback };
      stopLoading(); view('dash'); renderDashboard(spec, meta);
      if (data.id) try { window.history.pushState({ id: data.id }, '', '/d/' + data.id); } catch (e) { /* ignore */ }
      history.unshift({ prompt, spec, meta }); history = history.slice(0, 12); saveHistory(); renderHistory();
    } catch (e) {
      if (inflight !== ac) return;
      stopLoading(); showError(prompt, e && e.name === 'AbortError' ? 'The request took too long.' : String(e && e.message || e));
    } finally { clearTimeout(kill); if (inflight === ac) inflight = null; }
  }

  function showError(prompt, msg) {
    view('dash');
    $('#sectionNav').hidden = true;
    $('#dash').innerHTML = `<div class="error-box"><h2>That one didn't come through</h2><p>${esc(msg)}</p><p><button class="btn primary" id="retry">Try again</button> <button class="btn" id="back">Change the request</button></p></div>`;
    $('#retry').onclick = () => run(prompt);
    $('#back').onclick = () => { view('hero'); $('#prompt').value = prompt; $('#prompt').focus(); };
  }

  // ---------- routing: /d/<id> permalinks ----------
  function pathId() { const m = location.pathname.match(/^\/d\/([a-z0-9]{10})$/); return m ? m[1] : null; }
  function navigate(path, payload) {
    try { window.history.pushState(payload && payload.meta ? { id: payload.meta.id } : {}, '', path); } catch (e) { /* ignore */ }
    if (payload) { view('dash'); renderDashboard(payload.spec, payload.meta); scrollTo(0, 0); }
    else render(pathId());
  }
  async function openId(id) {
    stopLoading();
    try {
      const res = await fetch('/api/dashboard/' + id);
      if (!res.ok) throw new Error(res.status === 404 ? 'That dashboard is no longer available.' : 'HTTP ' + res.status);
      const d = await res.json();
      if (!d || !d.spec) throw new Error('That dashboard could not be read.');
      const meta = { prompt: d.prompt, id: d.id, ms: d.ms, model: d.model, fallback: !!d.fallback };
      view('dash'); renderDashboard(d.spec, meta); scrollTo(0, 0);
      if (!history.some((h) => h.meta && h.meta.id === d.id)) { history.unshift({ prompt: d.prompt, spec: d.spec, meta }); history = history.slice(0, 12); saveHistory(); renderHistory(); }
    } catch (e) {
      showError('', String((e && e.message) || e) + ' Start a new one below.');
    }
  }
  function render(id) {
    if (id) return openId(id);
    if (inflight) { inflight.abort(); inflight = null; }
    stopLoading(); view('hero'); renderHistory();
    document.documentElement.style.removeProperty('--accent');
    document.documentElement.style.removeProperty('--accent-soft');
  }
  addEventListener('popstate', () => render(pathId()));

  // ---------- wiring ----------
  $('#chips').innerHTML = CHIPS.map((c) => `<button class="chip" type="button" data-q="${esc(c[1])}">${esc(c[0])}</button>`).join('');
  $('#chips').addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (!b) return; $('#prompt').value = b.getAttribute('data-q'); run(b.getAttribute('data-q')); });
  $('#promptForm').addEventListener('submit', (e) => { e.preventDefault(); run($('#prompt').value); });
  $('#prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); run($('#prompt').value); } });
  $('#prompt').addEventListener('input', (e) => { const t = e.target; t.style.height = 'auto'; t.style.height = Math.min(180, t.scrollHeight) + 'px'; });
  const goHome = (e) => { if (e) e.preventDefault(); if (location.pathname !== '/') { try { window.history.pushState({}, '', '/'); } catch (err) { /* ignore */ } } if (inflight) { inflight.abort(); inflight = null; } stopLoading(); view('hero'); renderHistory(); document.documentElement.style.removeProperty('--accent'); document.documentElement.style.removeProperty('--accent-soft'); $('#prompt').select(); $('#prompt').focus(); };
  $('#newBtn').addEventListener('click', goHome);
  $('#brand').addEventListener('click', goHome);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && (!$('#dash').hidden || !$('#explorer').hidden)) goHome(); });

  renderHistory();
  const qs = new URLSearchParams(location.search);
  const bootId = pathId();
  if (bootId) {
    openId(bootId);
  } else if (qs.get('sample')) {
    const src = qs.get('sample') === 'b' ? 'sample-b.json' : 'sample.json';
    fetch(src).then((r) => (r.ok ? r.json() : fetch('sample-b.json').then((r2) => r2.json())))
      .catch(() => fetch('sample-b.json').then((r) => r.json()))
      .then((d) => { const spec = d && (d.spec || d); view('dash'); renderDashboard(spec, { sample: true, fallback: !!(d && d.fallback) }); })
      .catch((e) => showError('', 'Could not load sample: ' + e));
  } else if (qs.get('q')) {
    $('#prompt').value = qs.get('q'); run(qs.get('q'));
  } else {
    view('hero'); $('#prompt').focus();
  }
})();
