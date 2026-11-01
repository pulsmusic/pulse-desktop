// ИИ-разметка живого текста: когда звучит каждое слово.
//
// Работает в скрытом окне «Пульса» (или на тестовой странице в CI). На вход — звук трека и строки текста с временем
// начала (обычный LRC). ИИ (Whisper base, лицензия MIT, работает прямо на компьютере через WebAssembly, один поток)
// «слушает» трек кусками по ~28 с — границы кусков совпадают с границами строк, — и отдаёт услышанные слова со временем.
// Дальше match.js сопоставляет их с известным текстом. Наружу уходит только время слов.
import { pipeline, env } from '@huggingface/transformers';
import { align, tokens } from './match.js';

env.allowRemoteModels = false;                     // ничего не скачивается из интернета — модель лежит рядом
env.allowLocalModels = true;
env.localModelPath = new URL('./models/', location.href).href;
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = new URL('./ort/', location.href).href;
env.backends.onnx.wasm.numThreads = 1;              // один поток — компьютер не нагревается и не тормозит
env.backends.onnx.wasm.proxy = false;

const MODEL = 'whisper-base_timestamped';
const SR = 16000;
let asrP = null;
const asr = () => (asrP ||= pipeline('automatic-speech-recognition', MODEL, { device: 'wasm', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' } }));

// звук → 16 кГц моно
async function decode(buf) {
  const probe = new OfflineAudioContext(1, SR, SR);
  const ab = await probe.decodeAudioData(buf.slice ? buf.slice(0) : buf);   // decodeAudioData сам пересчитывает частоту под контекст
  const n = ab.length, ch = ab.numberOfChannels; const out = new Float32Array(n);
  for (let c = 0; c < ch; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / ch; }
  return out;
}

const cyr = (s) => (String(s).match(/[а-яё]/gi) || []).length, lat = (s) => (String(s).match(/[a-z]/gi) || []).length;

// куски по строкам: не длиннее 28 с, каждый начинается чуть раньше своей первой строки
function windows(lines, dur) {
  const W = []; let cur = null;
  lines.forEach((l, i) => {
    const t = +l.t, end = i + 1 < lines.length ? +lines[i + 1].t : Math.min(dur, t + 8);
    if (!tokens(l.text).length) return;
    if (cur && end - cur.a <= 28) { cur.b = end; cur.text += ' ' + l.text; return; }
    if (cur) W.push(cur);
    cur = { a: Math.max(0, t - 0.6), b: end, text: l.text };
    if (cur.b - cur.a > 28) cur.b = cur.a + 28;
  });
  if (cur) W.push(cur);
  return W.map((w) => ({ ...w, b: Math.min(dur, w.b + 0.4) }));
}

export async function alignTrack(job, onProgress = () => {}) {
  const t0 = performance.now();
  const pcm = job.pcm instanceof Float32Array ? job.pcm : await decode(job.audio);
  const dur = pcm.length / SR;
  const lines = (job.lines || []).filter((l) => Number.isFinite(+l.t)).map((l) => ({ t: +l.t, text: String(l.text || '') }));
  const run = await asr();
  const heard = []; const W = windows(lines, dur);
  for (let k = 0; k < W.length; k++) {
    const w = W[k]; const seg = pcm.subarray(Math.floor(w.a * SR), Math.floor(w.b * SR));
    if (seg.length < SR * 0.5) continue;
    const language = cyr(w.text) >= lat(w.text) ? 'russian' : 'english';
    const r = await run(seg, { return_timestamps: 'word', language, task: 'transcribe' });
    for (const c of r.chunks || []) {
      const [a, b] = c.timestamp || []; if (!Number.isFinite(a)) continue;
      for (const part of String(c.text).trim().split(/\s+/).filter(Boolean)) heard.push({ w: part, a: w.a + a, b: w.a + (Number.isFinite(b) ? b : a + 0.3) });
    }
    onProgress((k + 1) / W.length);
  }
  heard.sort((x, y) => x.a - y.a);
  const res = align(lines, heard, dur);
  return { ...res, v: 1, ms: Math.round(performance.now() - t0), heard: job.debug ? heard : undefined };
}

// мост к «Пульсу» (preload скрытого окна); в CI тест вызывает alignTrack напрямую
window.PulseAI = { alignTrack, ready: () => asr().then(() => true) };
if (window.aiBridge) {
  window.aiBridge.onJob(async (job) => {
    try { window.aiBridge.done({ id: job.id, ok: true, v: await alignTrack(job, (p) => window.aiBridge.progress(job.id, p)) }); }
    catch (e) { window.aiBridge.done({ id: job.id, ok: false, error: String((e && e.message) || e) }); }
  });
  window.aiBridge.hello();
}
