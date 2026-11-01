// ИИ-разметка живого текста: когда звучит каждое слово.
//
// Работает в скрытом окне «Пульса» (или на тестовой странице в CI). На вход — звук трека и строки текста с временем
// начала (обычный LRC). ИИ (Whisper base, лицензия MIT, работает прямо на компьютере через WebAssembly, один поток)
// «слушает» трек кусками по ~28 с — границы кусков совпадают с границами строк, — и отдаёт услышанные слова со временем.
// Дальше match.js сопоставляет их с известным текстом. Наружу уходит только время слов.
import { pipeline, env } from '@huggingface/transformers';
import { tokens } from './match.js';

env.allowRemoteModels = false;                     // ничего не скачивается из интернета — модель лежит рядом
env.allowLocalModels = true;
env.localModelPath = new URL('./models/', import.meta.url).href;
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = new URL('./ort/', import.meta.url).href;
env.backends.onnx.wasm.numThreads = 1;              // один поток — компьютер не нагревается и не тормозит
env.backends.onnx.wasm.proxy = false;

const MODEL = 'whisper-base_timestamped';
const SR = 16000;
let asrP = null;
const asr = () => (asrP ||= pipeline('automatic-speech-recognition', MODEL, { device: 'wasm', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' } }));

// звук → 16 кГц моно
async function decode(buf) {
  const probe = new OfflineAudioContext(1, SR, SR);
  const ab0 = ArrayBuffer.isView(buf) ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf.slice(0);
  const ab = await probe.decodeAudioData(ab0);   // decodeAudioData сам пересчитывает частоту под контекст
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
    const lang = cyr(l.text) >= lat(l.text) ? 'ru' : 'en';
    if (cur && end - cur.a <= 28 && (cur.lang === lang || !(cyr(l.text) + lat(l.text)))) { cur.b = end; cur.text += ' ' + l.text; cur.idx.push(i); return; }
    if (cur) W.push(cur);
    cur = { a: Math.max(0, t - 1), b: end, text: l.text, lang, idx: [i] };
    if (cur.b - cur.a > 28) cur.b = cur.a + 28;
  });
  if (cur) W.push(cur);
  return W.map((w) => ({ ...w, b: Math.min(dur, w.b + 0.4) }));
}

// Принудительное выравнивание: текст известен, поэтому ИИ не угадывает слова, а только ищет, где звучит каждое.
// Декодеру Whisper подаётся сам текст строки (как будто он его «распознал»), а по вниманию декодера к звуку
// (cross-attention) и динамическому выравниванию (DTW) находится момент начала каждого токена — так же, как
// работают word_timestamps у Whisper. Слово начинается там, где его первый токен.
async function forced(run, seg, text, language) {
  const tok = run.tokenizer, model = run.model, gc = model.generation_config;
  const words = tokens(text); if (!words.length) return null;
  const ids = []; const first = [];
  for (const w of words) { const e = tok.encode(' ' + w, { add_special_tokens: false }); first.push(ids.length); ids.push(...e); }
  if (ids.length > 200) return null;
  const code = language === 'russian' ? 'ru' : 'en';
  const prefix = [gc.decoder_start_token_id, gc.lang_to_id['<|' + code + '|>'], gc.task_to_id.transcribe, gc.no_timestamps_token_id].filter((x) => x != null);
  const feats = (await run.processor(seg)).input_features;
  const out = await model.generate({ inputs: feats, decoder_input_ids: [...prefix, ...ids], max_new_tokens: 1, return_token_timestamps: true, num_frames: Math.floor(seg.length / 320) });   // кадры внимания энкодера — 50 в секунду
  const ts = out.token_timestamps.tolist()[0];
  // token_timestamps[k] — момент, когда «начался» токен k-1 (нулевой элемент — начало), поэтому +1
  return first.map((i) => +ts[prefix.length + i + 1]);
}

export async function alignTrack(job, onProgress = () => {}) {
  const t0 = performance.now();
  const pcm = job.pcm instanceof Float32Array ? job.pcm : await decode(job.audio);
  const dur = pcm.length / SR;
  const lines = (job.lines || []).filter((l) => Number.isFinite(+l.t)).map((l) => ({ t: +l.t, text: String(l.text || '') }));
  const run = await asr();
  const W = windows(lines, dur); const res = new Map(); let good = 0, total = 0, dbg = null;
  for (let k = 0; k < W.length; k++) {
    const w = W[k]; const seg = pcm.subarray(Math.floor(w.a * SR), Math.floor(w.b * SR));
    if (seg.length < SR * 0.5) continue;
    const language = w.lang === 'en' ? 'english' : 'russian';
    // строки этого куска одной цепочкой слов
    const idx = w.idx;
    const text = idx.map((i) => lines[i].text).join(' ');
    let ts = null; try { ts = await forced(run, seg, text, language); } catch (e) { console.log('кусок', k, e && e.message); }
    if (job.debug) (dbg ||= []).push({ a: w.a, b: w.b, ts: ts && ts.map((x) => Math.round(x * 100) / 100) });
    if (ts) {
      let p = 0;
      for (const i of idx) {
        const n = tokens(lines[i].text).length; const tt = ts.slice(p, p + n).map((x) => Math.round((w.a + x) * 100) / 100); p += n;
        const lo = lines[i].t - 1.2, hi = (i + 1 < lines.length ? lines[i + 1].t : dur) + 0.5;
        const ok = tt.filter((x) => x >= lo && x <= hi).length; total += n; good += ok;
        if (ok / n >= 0.6) { for (let q = 1; q < tt.length; q++) if (tt[q] < tt[q - 1] + 0.04) tt[q] = Math.round((tt[q - 1] + 0.04) * 100) / 100; res.set(i, tt); }
      }
    }
    onProgress((k + 1) / W.length);
  }
  return { lines: [...res].sort((a, b) => a[0] - b[0]), c: total ? Math.round((good / total) * 1000) / 1000 : 0, v: 2, ms: Math.round(performance.now() - t0), dbg };
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
