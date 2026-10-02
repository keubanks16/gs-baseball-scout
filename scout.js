// Full-game scouting: scan a long video for balls in play, then measure each one.
//
// Pass 1 plays the video fast and watches the strip between home and first: a batter who
// puts the ball in play runs it, so motion that travels home -> first marks a candidate.
// Pass 2 goes back to each candidate, finds the batter in the box, runs the swing analysis,
// follows the ball off the bat and fits its flight with the field calibration.

import { waitFrame, analyzeSwing, acquireAt, extent, packFrames } from './swing.js';
import * as F from './field.js';

const abortErr = () => new DOMException('Stopped', 'AbortError');

// ---------------------------------------------------------------- picture area
// GameChanger screen recordings have black bars at the sides; the camera picture is inside
export function contentRect(video) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const W = 320, H = Math.max(8, Math.round(320 * vh / vw));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(video, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data;
  const lum = (i) => (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  // judge columns on the middle band only: the scoreboard and the player controls overlap the bars
  const ya = Math.round(H * 0.42), yb = Math.round(H * 0.8), xa = Math.round(W * 0.3), xb = Math.round(W * 0.7);
  const colDark = (cx) => { let n = 0; for (let y = ya; y < yb; y++) if (lum((y * W + cx) * 4) > 24) n++; return n < (yb - ya) * 0.04; };
  const rowDark = (ry) => { let n = 0; for (let xx = xa; xx < xb; xx++) if (lum((ry * W + xx) * 4) > 24) n++; return n < (xb - xa) * 0.04; };
  let l = 0, r = W - 1, t = 0, b = H - 1;
  while (l < W / 3 && colDark(l)) l++;
  while (r > W * 2 / 3 && colDark(r)) r--;
  while (t < H / 3 && rowDark(t)) t++;
  while (b > H * 2 / 3 && rowDark(b)) b--;
  const k = vw / W;
  return { x: Math.round(l * k), y: Math.round(t * k), w: Math.round((r - l + 1) * k), h: Math.round((b - t + 1) * k) };
}

// a tiny grey thumbnail of the whole picture, to notice when the camera view changes
export function viewPrint(video, rect) {
  const c = viewPrint.c || (viewPrint.c = Object.assign(document.createElement('canvas'), { width: 48, height: 27 }));
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(video, rect.x, rect.y, rect.w, rect.h, 0, 0, 48, 27);
  const d = x.getImageData(0, 0, 48, 27).data, g = new Float32Array(48 * 27);
  let m = 0; for (let i = 0; i < g.length; i++) { g[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11; m += g[i]; }
  m /= g.length; let s = 0; for (let i = 0; i < g.length; i++) { g[i] -= m; s += g[i] * g[i]; }
  s = Math.sqrt(s) || 1; for (let i = 0; i < g.length; i++) g[i] /= s;
  return g;
}
const corr = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// ---------------------------------------------------------------- watched regions
export const SEGS = [[6, 19], [19, 32], [32, 45], [45, 0]];      // feet along the first-base line (0 = base path - 1)
export function regions(cal) {
  const bp = cal.basePath;
  const segs = SEGS.map(([a, b]) => F.liftedPoly(cal, F.lineQuad(a * bp / 60, b ? b * bp / 60 : bp - 1, -3, 5), 4.6));
  const boxes = ['R', 'L'].map((s) => F.liftedPoly(cal, F.BOX[s], 5.4));
  return { segs, boxes };
}
function inPoly(x, y, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    if (((P[i][1] > y) !== (P[j][1] > y)) && (x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0])) c = !c;
  }
  return c;
}

// ---------------------------------------------------------------- pass 1: scan
// Returns { t:[], a:[[],[],[],[]], g:[] } : motion share per corridor segment per sample,
// plus glitch flags (the whole picture changed: player controls, a cut, the camera moved).
export async function scanVideo({ video, cal, signal, onProgress = () => {}, from = 0, to, rate = 4 }) {
  const dur = video.duration; to = Math.min(to ?? dur, dur);
  const R = regions(cal);
  const all = [...R.segs, ...R.boxes].flat();
  const vw = video.videoWidth, vh = video.videoHeight;
  const pad = 0.02 * vw;
  const bx0 = Math.max(0, Math.min(...all.map((p) => p[0])) - pad), bx1 = Math.min(vw, Math.max(...all.map((p) => p[0])) + pad);
  const by0 = Math.max(0, Math.min(...all.map((p) => p[1])) - pad), by1 = Math.min(vh, Math.max(...all.map((p) => p[1])) + pad);
  const sc = Math.min(1, 480 / cal.content.w);
  const W = Math.max(8, Math.round((bx1 - bx0) * sc)), H = Math.max(8, Math.round((by1 - by0) * sc));
  const lab = new Uint8Array(W * H), cnt = new Uint32Array(6);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const vx = bx0 + (x + 0.5) / sc, vy = by0 + (y + 0.5) / sc;
    let k = 0;                                   // bit per region: a pixel can sit in several
    for (let s = 0; s < 4; s++) if (inPoly(vx, vy, R.segs[s])) k |= 1 << s;
    if (inPoly(vx, vy, R.boxes[0]) || inPoly(vx, vy, R.boxes[1])) k |= 16;
    lab[y * W + x] = k;
    for (let b = 0; b < 5; b++) if (k & (1 << b)) cnt[b + 1]++;
  }
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  let prev = null, cur = new Uint8Array(W * H);
  const out = { t: [], a: [[], [], [], [], []], g: [], view: [], rate: [], W, H, box: [bx0, by0, bx1, by1] };
  const ref = cal.print || null;
  let lastPrintT = -1e9, viewOk = true;
  const hits = new Uint32Array(6);

  const process = (mt) => {
    ctx.drawImage(video, bx0, by0, bx1 - bx0, by1 - by0, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    for (let i = 0, j = 0; j < cur.length; i += 4, j++) cur[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    if (ref && mt - lastPrintT > 2) { lastPrintT = mt; viewOk = corr(viewPrint(video, cal.content), ref) > 0.55; }
    if (prev) {
      hits.fill(0);
      let tot = 0;
      for (let j = 0; j < cur.length; j++) {
        const dd = cur[j] - prev[j];
        if (dd > 14 || dd < -14) { tot++; const k = lab[j]; if (k) for (let b = 0; b < 5; b++) if (k & (1 << b)) hits[b + 1]++; }
      }
      out.t.push(mt);
      for (let k = 0; k < 5; k++) out.a[k].push(cnt[k + 1] ? hits[k + 1] / cnt[k + 1] : 0);
      out.g.push(tot / cur.length > 0.3 || !viewOk ? 1 : 0);
      out.view.push(viewOk ? 1 : 0);
    }
    const tmp = prev || new Uint8Array(W * H); prev = cur; cur = tmp;
  };

  await waitFrame(video, from);
  if (signal && signal.aborted) throw abortErr();
  const hasRVFC = 'requestVideoFrameCallback' in video;
  const wall0 = performance.now();
  if (!hasRVFC) {
    // older browsers: step through by seeking (slower)
    for (let t = from; t < to; t += 0.15) {
      if (signal && signal.aborted) throw abortErr();
      const mt = await waitFrame(video, t);
      process(mt ?? t);
      onProgress({ t, from, to, p: (t - from) / (to - from), eta: eta(t), rate: 0 });
    }
    return out;
  }
  function eta(t) { const el = (performance.now() - wall0) / 1000, done = t - from; return done > 3 ? el / done * (to - t) : null; }
  video.muted = true;
  let curRate = rate, lastAdj = performance.now(), gaps = [], lastMt = null, lastWall = performance.now();
  video.playbackRate = curRate;
  await new Promise((resolve, reject) => {
    let finished = false;
    const finish = (err) => { if (finished) return; finished = true; clearInterval(dog); video.pause(); video.playbackRate = 1; err ? reject(err) : resolve(); };
    const onFrame = (now, meta) => {
      if (finished) return;
      if (signal && signal.aborted) return finish(abortErr());
      const mt = meta && typeof meta.mediaTime === 'number' ? meta.mediaTime : video.currentTime;
      lastWall = performance.now();
      if (lastMt == null || mt > lastMt + 1e-4) {
        process(mt);
        if (lastMt != null) gaps.push(mt - lastMt);
        lastMt = mt;
        out.rate.push(curRate);
        onProgress({ t: mt, from, to, p: (mt - from) / (to - from), eta: eta(mt), rate: curRate });
      }
      // keep samples ~0.15 s apart or closer: slow down if frames get sparse, speed up if dense
      if (performance.now() - lastAdj > 2500 && gaps.length > 8) {
        const g = gaps.sort((a, b) => a - b)[gaps.length >> 1];
        if (g > 0.17 && curRate > 1) curRate = Math.max(1, curRate / 1.5);
        else if (g < 0.07 && curRate < 8) curRate = Math.min(8, curRate * 1.25);
        video.playbackRate = curRate; gaps = []; lastAdj = performance.now();
      }
      if (mt >= to - 0.02 || video.ended) return finish();
      video.requestVideoFrameCallback(onFrame);
    };
    // the system may pause playback (screen lock, another app): nudge it back
    const dog = setInterval(() => {
      if (finished) return;
      if (signal && signal.aborted) return finish(abortErr());
      if (video.ended || video.currentTime >= to - 0.02) return finish();
      if (performance.now() - lastWall > 2000 && video.paused) video.play().catch(() => {});
    }, 1000);
    video.addEventListener('ended', () => finish(), { once: true });
    video.requestVideoFrameCallback(onFrame);
    video.play().catch((e) => finish(e));
  });
  return out;
}

// ---------------------------------------------------------------- candidates
// motion that starts at the plate end of the corridor and reaches the first-base end
export function findRuns(series, opt = {}) {
  const { t, a, g } = series;
  if (t.length < 10) return [];
  const dt = 0.1, T0 = t[0], n = Math.ceil((t[t.length - 1] - T0) / dt) + 1;
  const grid = [0, 1, 2, 3].map(() => new Float32Array(n).fill(NaN));
  const glitch = new Uint8Array(n);
  for (let j = 0; j < t.length; j++) {
    const i = Math.round((t[j] - T0) / dt);
    if (g[j]) { glitch[i] = 1; if (i > 0) glitch[i - 1] = 1; if (i + 1 < n) glitch[i + 1] = 1; continue; }
    for (let k = 0; k < 4; k++) { const v = a[k][j]; if (!(grid[k][i] >= v)) grid[k][i] = v; }
  }
  // fill short gaps
  for (const s of grid) { let last = NaN, gap = 0; for (let i = 0; i < n; i++) { if (Number.isNaN(s[i])) { if (++gap <= 4 && !Number.isNaN(last) && !glitch[i]) s[i] = last; } else { last = s[i]; gap = 0; } } }
  // baseline: rolling median over 20 s, sampled every 2 s
  const med = (arr) => { const b = arr.filter((v) => !Number.isNaN(v)).sort((p, q) => p - q); return b.length ? b[b.length >> 1] : 0; };
  const ex = grid.map((s) => {
    const hop = 20, half = 100, bases = [];
    for (let i = 0; i < n; i += hop) bases.push(med(Array.from(s.subarray(Math.max(0, i - half), Math.min(n, i + half)))));
    const e = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const q = i / hop, i0 = Math.floor(q), i1 = Math.min(bases.length - 1, i0 + 1), f = q - i0;
      const b = bases[i0] * (1 - f) + bases[i1] * f;
      e[i] = Number.isNaN(s[i]) ? 0 : s[i] - b;
    }
    const sm = new Float32Array(n);
    for (let i = 0; i < n; i++) sm[i] = (e[Math.max(0, i - 1)] + e[i] + e[Math.min(n - 1, i + 1)]) / 3;
    return sm;
  });
  // noise level from the quiet side (below baseline), so busy stretches do not inflate it
  const thr = ex.map((e) => {
    const v = Array.from(e).filter((x) => x < 0).map((x) => -x).sort((p, q) => p - q);
    const mad = v.length ? v[v.length >> 1] : 0;
    return Math.max(opt.minThr ?? 0.03, 4 * 1.4826 * mad);
  });
  if (opt.debug) console.log('thr', thr.map((x) => x.toFixed(3)).join(' '));
  // spans where a segment is busy for >= 0.2 s
  const spans = ex.map((e, k) => {
    const out = []; let s = -1, pk = 0;
    for (let i = 0; i <= n; i++) {
      const on = i < n && e[i] > thr[k];
      if (on) { if (s < 0) { s = i; pk = 0; } pk = Math.max(pk, e[i]); }
      else if (s >= 0) { if (i - s >= 2) out.push({ s, e: i - 1, pk: pk / thr[k] }); s = -1; }
    }
    return out;
  });
  if (opt.debug) spans.forEach((sp, k) => console.log('seg', k, sp.map((q) => `${(T0 + q.s * dt).toFixed(1)}-${(T0 + q.e * dt).toFixed(1)}(${q.pk.toFixed(1)})`).join(' ')));
  const after = (k, i, maxGap) => spans[k].find((sp) => sp.s > i && sp.s <= i + maxGap) || spans[k].find((sp) => sp.s <= i && sp.e > i);
  const cands = [];
  for (const s0 of spans[0]) {
    if (glitch[s0.s]) continue;
    const s1 = after(1, s0.s, 35); if (!s1) continue;
    const s2 = after(2, Math.max(s1.s, s0.s + 1), 35); if (!s2) continue;
    if (s2.s - s0.s > 55 || s2.s <= s0.s) continue;
    const s3 = after(3, s2.s, 35);
    const score = s0.pk + s1.pk + s2.pk + (s3 ? s3.pk : 0);
    cands.push({ t: T0 + s0.s * dt, t1: T0 + s1.s * dt, t2: T0 + s2.s * dt, t3: s3 ? T0 + s3.s * dt : null, score: Math.round(score * 10) / 10, reach: s3 ? 4 : 3 });
  }
  // one candidate per play: keep the first run start in each 7 s window
  cands.sort((p, q) => p.t - q.t);
  const merged = [];
  for (const c of cands) {
    const last = merged[merged.length - 1];
    if (last && c.t - last.t < 7) { if (c.score > last.score * 1.8) merged[merged.length - 1] = c; continue; }
    merged.push(c);
  }
  return merged;
}

// ---------------------------------------------------------------- pass 2: one play
// the batter: a player standing in one of the boxes shortly before the run
export async function findBatter(video, pose, cal, t) {
  const found = [];
  for (const side of ['R', 'L']) {
    const [bx, by] = F.BOX_CENTER[side];
    const hip = F.project(cal.P, [bx, by, 2.4]), foot = F.project(cal.P, [bx, by, 0]), head = F.project(cal.P, [bx, by, 4.8]);
    const hpx = Math.hypot(foot[0] - head[0], foot[1] - head[1]);
    const acq = await acquireAt(video, pose, hip[0], hip[1], hpx * 1.7, found.length ? null : t);
    if (!acq || acq.conf < 0.22) continue;
    const kp = acq.kp, S = (k) => kp[k * 3 + 2];
    const ank = [15, 16].filter((k) => S(k) > 0.15);
    let fx, fy;
    if (ank.length) { fx = ank.reduce((s, k) => s + kp[k * 3], 0) / ank.length; fy = Math.max(...ank.map((k) => kp[k * 3 + 1])); }
    else { const e = extent(kp, 0.2); if (!e) continue; fx = e.cx; fy = e.cy + e.h / 2; }
    const g = F.toField(cal, fx, fy);
    if (!g) continue;
    const [x0, y0] = F.BOX[side][0], [x1, y1] = F.BOX[side][2];
    const slack = 1.4;
    const inside = g[0] > Math.min(x0, x1) - slack && g[0] < Math.max(x0, x1) + slack && g[1] > y0 - slack && g[1] < y1 + slack;
    if (!inside) continue;
    found.push({ side, x: acq.cx, y: acq.cy, size: acq.size, conf: acq.conf, feet: g });
  }
  if (!found.length) return null;
  return found.sort((p, q) => q.conf - p.conf)[0];
}

// follow the ball further than the swing analysis did, searching where the fitted flight says it is
export async function extendTrack(video, cal, ball, { signal, maxT = 1.1 } = {}) {
  if (!ball || !ball.found || ball.track.length < 4) return ball;
  let track = ball.track.slice().sort((p, q) => p.t - q.t);
  let fit = F.fitFlight(cal, track, ball.tContact);
  if (!fit || fit.rms > 6 || fit.n < 6) return ball;          // only extend a flight that already fits
  const kpx = cal.content.w / 2344;
  const dur = video.duration;
  const tEnd = Math.min(dur - 0.05, track[track.length - 1].t + maxT);
  let tCur = track[track.length - 1].t, misses = 0;
  const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
  while (tCur < tEnd && misses < 7) {
    if (signal && signal.aborted) throw abortErr();
    const times = [];
    for (let t = tCur + 1 / 30; t <= Math.min(tEnd, tCur + 0.34); t += 1 / 30) times.push(t);
    if (times.length < 2) break;
    const preds = times.map((t) => F.project(cal.P, F.predictAt(fit, t)));
    if (preds.some((p) => !(p[2] > 0))) break;
    const lastT = track[track.length - 1].t;
    const margin = (22 + 140 * (times[times.length - 1] - lastT)) * kpx;
    let x0 = Math.min(...preds.map((p) => p[0])) - margin, x1 = Math.max(...preds.map((p) => p[0])) + margin;
    let y0 = Math.min(...preds.map((p) => p[1])) - margin, y1 = Math.max(...preds.map((p) => p[1])) + margin;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(video.videoWidth, x1); y1 = Math.min(video.videoHeight, y1);
    if (x1 - x0 < 8 || y1 - y0 < 8) break;
    const s = Math.min(1, Math.sqrt(160000 / ((x1 - x0) * (y1 - y0))));
    cv.width = Math.max(4, Math.round((x1 - x0) * s)); cv.height = Math.max(4, Math.round((y1 - y0) * s));
    // frames: one before, the window, one after (the ball must differ from both neighbours)
    const grabs = [];
    let lastMedia = null;
    for (const t of [times[0] - 1 / 30, ...times, times[times.length - 1] + 1 / 30]) {
      const mt = await waitFrame(video, t);
      if (mt != null && lastMedia != null && Math.abs(mt - lastMedia) < 1e-4) continue;
      lastMedia = mt;
      cx.drawImage(video, x0, y0, x1 - x0, y1 - y0, 0, 0, cv.width, cv.height);
      const d = cx.getImageData(0, 0, cv.width, cv.height).data, gr = new Int16Array(cv.width * cv.height);
      for (let i = 0, j = 0; j < gr.length; i += 4, j++) gr[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
      grabs.push({ t: mt ?? t, g: gr });
    }
    const added = [];
    for (let k = 1; k + 1 < grabs.length; k++) {
      const { t } = grabs[k];
      if (t <= lastT + 1e-3) continue;
      const pr = F.project(cal.P, F.predictAt(fit, t));
      const px = (pr[0] - x0) * s, py = (pr[1] - y0) * s;
      const gate = (14 + 90 * (t - lastT)) * kpx * s;
      const b = brightBlobs(grabs[k - 1].g, grabs[k].g, grabs[k + 1].g, cv.width, cv.height, px, py, gate, s);
      if (b) added.push({ t, x: x0 + b.x / s, y: y0 + b.y / s, ext: true });
    }
    if (!added.length) { misses += times.length; tCur = times[times.length - 1]; continue; }
    const trial = track.concat(added);
    const f2 = F.fitFlight(cal, trial, ball.tContact);
    if (!f2 || f2.rms > Math.max(5, fit.rms * 1.8)) { misses += times.length; tCur = times[times.length - 1]; continue; }
    const kept = new Set(f2.pts);
    track = trial.filter((p) => !p.ext || kept.has(p));
    fit = f2; misses = 0; tCur = times[times.length - 1];
  }
  return { ...ball, track, extended: track.filter((p) => p.ext).length };
}
// brightest small blob that is lighter than the same spot in both neighbouring frames, near (px, py)
function brightBlobs(a, b, c, w, h, px, py, gate, s) {
  const x0 = Math.max(1, Math.floor(px - gate)), x1 = Math.min(w - 2, Math.ceil(px + gate));
  const y0 = Math.max(1, Math.floor(py - gate)), y1 = Math.min(h - 2, Math.ceil(py + gate));
  const thr = 9, seen = new Uint8Array(w * h), maxArea = Math.max(6, 60 * s * s);
  const m = (p) => Math.min(b[p] - a[p], b[p] - c[p]);
  let best = null;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * w + x;
    if (seen[i] || m(i) <= thr) continue;
    let area = 0, sx = 0, sy = 0, sw = 0, peak = 0;
    const st = [i]; seen[i] = 1;
    while (st.length) {
      const p = st.pop(), qx = p % w, qy = (p / w) | 0, vv = m(p);
      area++; sx += qx * vv; sy += qy * vv; sw += vv; peak = Math.max(peak, vv);
      if (area > maxArea * 3) { st.length = 0; break; }
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h || seen[q]) continue;
        if (m(q) > thr * 0.6) { seen[q] = 1; st.push(q); }
      }
    }
    if (area > maxArea) continue;
    const bx = sx / sw, by = sy / sw, d = Math.hypot(bx - px, by - py);
    if (d > gate) continue;
    const score = peak / (1 + d / gate);
    if (!best || score > best.score) best = { x: bx, y: by, score };
  }
  return best;
}

// one candidate play, start to finish
export async function analyzePlay({ video, pose, cal, cand, field, signal, onProgress = () => {} }) {
  const tRun = cand.t;
  let bat = null;
  for (const back of [2.4, 1.8, 3.1]) {
    if (signal && signal.aborted) throw abortErr();
    const ts = Math.max(0, tRun - back);
    onProgress({ stage: 'Finding the batter', p: 0 });
    bat = await findBatter(video, pose, cal, ts);
    if (bat) { bat.t = ts; break; }
  }
  if (!bat) return { error: 'no_batter' };
  const res = await analyzeSwing({ video, pose, seed: { x: bat.x, y: bat.y, t: bat.t }, signal, hint: tRun - 0.5, tEnd: tRun + 0.9, onProgress });
  if (res.error) return { error: res.error, bats: bat.side };
  const tc = res.events.tContact;
  const near = tc > tRun - 2.3 && tc < tRun + 0.4;
  let ball = res.ball;
  if (ball && ball.found) { onProgress({ stage: 'Following the ball', p: 0.9 }); ball = await extendTrack(video, cal, ball, { signal }); }
  const outcome = F.ballOutcome(cal, ball, field, ball && ball.found ? ball.type : null);
  const thumb = await thumbAt(video, res);
  return { bats: bat.side, batter: bat, analysis: res, ball, outcome, tContact: tc, nearRun: near, thumb };
}

// a square picture of the batter at contact (jpeg data URL) and where it came from
export async function thumbAt(video, res) {
  const f = res.frames.reduce((b, x) => (Math.abs(x.t - res.events.tContact) < Math.abs(b.t - res.events.tContact) ? x : b), res.frames[0]);
  const e = extent(f.kp, 0.2); if (!e) return null;
  const size = e.ext * 1.9, cx = e.cx, cy = e.cy;
  await waitFrame(video, f.t);
  const c = document.createElement('canvas'); c.width = c.height = 240;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 240, 240);
  const sx = cx - size / 2, sy = cy - size / 2, k = 240 / size;
  const vx0 = Math.max(0, sx), vy0 = Math.max(0, sy), vx1 = Math.min(video.videoWidth, sx + size), vy1 = Math.min(video.videoHeight, sy + size);
  ctx.drawImage(video, vx0, vy0, vx1 - vx0, vy1 - vy0, (vx0 - sx) * k, (vy0 - sy) * k, (vx1 - vx0) * k, (vy1 - vy0) * k);
  let url = null; try { url = c.toDataURL('image/jpeg', 0.72); } catch {}
  return { url, rect: { cx: Math.round(cx), cy: Math.round(cy), size: Math.round(size) }, t: f.t };
}

// the top-left corner of the frame, where GameChanger draws its scoreboard
export function overlayCanvas(video, maxW = 1100) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const w = Math.round(vw * 0.42), h = Math.round(vh * 0.38);
  const k = Math.min(2.5, Math.max(1, 1100 / w)) * Math.min(1, maxW / Math.max(w, 1));
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(video, 0, 0, w, h, 0, 0, c.width, c.height);
  return c;
}

// media record for saving, same shape as a single-clip at-bat
export function mediaFor(play, vw, vh) {
  const a = play.analysis;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const ev = {}; for (const [k, v] of Object.entries(a.events)) ev[k] = typeof v === 'number' ? r3(v) : v;
  return {
    frames: packFrames(a.frames, vw, vh), thumb: play.thumb && play.thumb.url || null, thumbRect: play.thumb ? play.thumb.rect : null,
    ball: play.ball && play.ball.found ? play.ball.track.map((p) => [r3(p.t), Math.round(p.x / vw * 10000) / 10000, Math.round(p.y / vh * 10000) / 10000]) : null,
    events: ev,
  };
}
