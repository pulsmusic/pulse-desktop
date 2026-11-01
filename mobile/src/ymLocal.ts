// Яндекс Музыка прямо из приложения — без сервера на Mac. Это перенос server/main.py (и клиента версии для Windows)
// на TypeScript: те же точки (/search, /match, /artist/…, /album/…, /chart, /new, /stream/…, /health) и ответы в том же
// «iTunes-виде», поэтому остальной код приложения не меняется — api.ts просто зовёт ymLocal вместо сервера.
// Токен пользователя хранится только на телефоне и уходит только на api.music.yandex.net.
import { md5 } from './md5';

const BASE = 'https://api.music.yandex.net';
const SIGN_SALT = 'XGRlBW9FXlekgbPrRHuSiA';   // соль подписи ссылки на mp3 (как в yandex_music/download_info.py)
const HEAD: Record<string, string> = { 'X-Yandex-Music-Client': 'YandexMusicAndroid/24023621', 'Accept-Language': 'ru', 'User-Agent': 'Yandex-Music-API' };

export const cleanToken = (t?: string | null) => { let x = String(t || '').trim(); if (x.includes('access_token=')) x = x.split('access_token=')[1]; return x.split('&')[0].trim(); };
let badTok = ''; let badWhy = ''; let badAt = 0;
export const tokenProblem = (t?: string | null) => (cleanToken(t) && cleanToken(t) === badTok && Date.now() - badAt < 5 * 60e3 ? badWhy : '');
const yandexHost = (u: string) => /^https:\/\/([a-z0-9-]+\.)*yandex\.(net|ru|com)\//i.test(u);

class HttpErr extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s; } }
async function raw(path: string, token: string, opt: { method?: string; form?: Record<string, string>; json?: any; text?: boolean; ms?: number } = {}): Promise<any> {
  const url = path.startsWith('http') ? path : BASE + path;
  const h: Record<string, string> = { ...HEAD };
  if (token && yandexHost(url)) h.Authorization = 'OAuth ' + token;
  let body: string | undefined;
  if (opt.form) { h['Content-Type'] = 'application/x-www-form-urlencoded'; body = Object.entries(opt.form).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&'); }
  if (opt.json) { h['Content-Type'] = 'application/json'; body = JSON.stringify(opt.json); }
  const c = new AbortController(); const tm = setTimeout(() => c.abort(), opt.ms || 12000);
  try {
    const r = await fetch(url, { method: opt.method || 'GET', headers: h, body, signal: c.signal });
    const text = await r.text();
    if (opt.text) { if (!r.ok) throw new HttpErr('HTTP ' + r.status, r.status); return text; }
    let d: any = null; try { d = JSON.parse(text); } catch {}
    if (!r.ok) throw new HttpErr((d && d.error && (d.error.message || d.error.name)) || 'Яндекс ответил ' + r.status, r.status);
    return d ? d.result : null;
  } finally { clearTimeout(tm); }
}
// с токеном; если он не подошёл (401/403) — повторяем без него, приложение продолжает работать (30-секундные фрагменты)
async function ym(path: string, token: string, opt?: any) {
  const t = cleanToken(token);
  if (!t || (t === badTok && Date.now() - badAt < 5 * 60e3)) return raw(path, '', opt);
  try { return await raw(path, t, opt); }
  catch (e: any) {
    if (e && (e.status === 401 || e.status === 403)) { badTok = t; badAt = Date.now(); badWhy = 'Токен не подошёл (' + e.status + ')'; return raw(path, '', opt); }
    throw e;
  }
}

// ---------- кеш в памяти: свежее — сразу; одинаковые одновременные запросы выполняются один раз ----------
const cache = new Map<string, { t: number; v: any }>(); const flying = new Map<string, Promise<any>>();
async function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl * 1000) return hit.v;
  let p = flying.get(key);
  if (!p) {
    p = fn().then((v) => { cache.set(key, { t: Date.now(), v }); if (cache.size > 800) { const ks = [...cache.keys()].slice(0, 200); ks.forEach((k) => cache.delete(k)); } return v; }).finally(() => flying.delete(key));
    flying.set(key, p);
  }
  if (hit) { p.catch(() => {}); return hit.v; }   // устаревшее — сразу, свежее подтянется
  return p;
}

// ---------- перевод в «iTunes-вид» (как в server/main.py) ----------
const cover = (u?: string, size = '1000x1000') => (u ? 'https://' + String(u).replace('%%', size) : '');
const num = (x: any): number | null => { const s = String(x ?? '').split(':')[0]; return /^\d+$/.test(s) ? +s : null; };
function song(t: any) {
  if (!t || t.available === false || !t.title) return null;
  const al = (t.albums || [])[0]; const ar = (t.artists || [])[0]; const tid = num(t.id);
  if (tid == null) return null;
  return {
    wrapperType: 'track', kind: 'song', trackId: tid, trackName: t.title + (t.version ? ` (${t.version})` : ''),
    artistName: (t.artists || []).map((a: any) => a.name).filter(Boolean).join(', '), artistId: ar ? num(ar.id) : null,
    collectionName: al ? al.title : '', collectionId: al ? num(al.id) : null,
    artworkUrl100: cover(t.coverUri || (al && al.coverUri)), previewUrl: `ym:${tid}`, trackTimeMillis: t.durationMs,
    trackExplicitness: t.contentWarning === 'explicit' ? 'explicit' : 'notExplicit',
    primaryGenreName: al ? al.genre : null, releaseDate: al && al.year ? `${al.year}-01-01T00:00:00Z` : null,
  };
}
function collection(a: any) {
  if (!a || !a.title) return null;
  const ar = (a.artists || [])[0]; const single = (a.type || '') === 'single';
  return {
    wrapperType: 'collection', collectionType: 'Album', collectionId: num(a.id), collectionName: a.title + (single ? ' - Single' : ''),
    artistName: (a.artists || []).map((x: any) => x.name).filter(Boolean).join(', '), artistId: ar ? num(ar.id) : null,
    artworkUrl100: cover(a.coverUri), trackCount: a.trackCount || 0,
    releaseDate: a.releaseDate || (a.year ? `${a.year}-01-01T00:00:00Z` : null), primaryGenreName: a.genre,
  };
}
function artistInfo(a: any) {
  const u = (a.cover && a.cover.uri) || a.ogImage || '';
  return { wrapperType: 'artist', artistId: num(a.id), artistName: a.name, primaryGenreName: (a.genres || [])[0] || null, photo: cover(u), photoS: cover(u, '200x200'), fans: a.likesCount || 0 };
}
const clean = <T,>(xs: (T | null)[]) => xs.filter(Boolean) as T[];
const key = (s: string) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^0-9a-zа-яÀ-ɏ]+/g, '');
const norm = (s: string) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\b(feat|ft)\.?\b.*$/, ' ').replace(/[^0-9a-zа-я]+/g, ' ').trim().split(/\s+/).filter(Boolean).join(' ');

// ---------- точки ----------
async function search(term: string, entity: string, limit: number, tok: string) {
  const kind = ({ song: 'track', musicArtist: 'artist', album: 'album' } as any)[entity] || 'track';
  return cached(`s:${kind}:${term.toLowerCase()}:${limit}`, 600, async () => {
    const r = await ym(`/search?text=${encodeURIComponent(term)}&type=${kind}&page=0&nocorrect=false`, tok);
    if (!r) return [];
    if (kind === 'track') return clean(((r.tracks && r.tracks.results) || []).slice(0, limit).map(song));
    if (kind === 'artist') return ((r.artists && r.artists.results) || []).slice(0, limit).map(artistInfo);
    return clean(((r.albums && r.albums.results) || []).slice(0, limit).map(collection));
  });
}
async function match(title: string, artist: string, tok: string) {
  const t0 = norm(title), a0 = norm(artist); const seen = new Set<string>();
  for (const q of [`${artist} ${title}`.trim(), `${a0} ${t0}`.trim(), t0]) {
    if (!q || seen.has(q)) continue; seen.add(q);
    let res: any[] = []; try { res = await search(q, 'song', 10, tok); } catch { continue; }
    const best = res.find((x) => a0 && norm(x.artistName).includes(a0.split(' ')[0]) && norm(x.trackName).includes(t0.split(' ')[0])) || res.find((x) => t0 && norm(x.trackName).includes(t0));
    if (best) return { result: best };
  }
  return { result: null };
}
async function artist(aid: number, tok: string) {
  return cached(`a:${aid}`, 6 * 3600, async () => {
    const [bi, al, tr] = await Promise.all([
      ym(`/artists/${aid}/brief-info`, tok),
      ym(`/artists/${aid}/direct-albums?page=0&page-size=100&sort-by=year`, tok).catch(() => null),
      ym(`/artists/${aid}/tracks?page=0&page-size=50`, tok).catch(() => null),
    ]);
    return {
      info: bi && bi.artist ? artistInfo(bi.artist) : { artistId: aid },
      albums: clean(((al && al.albums) || []).map(collection)),
      songs: clean((((tr && tr.tracks) || (bi && bi.popularTracks)) || []).map(song)),
      similar: ((bi && bi.similarArtists) || []).map((a: any) => a.name).slice(0, 15),
    };
  });
}
async function artistSongs(aid: number, limit: number, tok: string) {
  return cached(`as:${aid}:${limit}`, 6 * 3600, async () => { const tr = await ym(`/artists/${aid}/tracks?page=0&page-size=${limit}`, tok); return clean(((tr && tr.tracks) || []).map(song)); });
}
async function artistByName(name: string, tok: string) {
  const r = await search(name, 'musicArtist', 5, tok);
  const a = r.find((x: any) => key(x.artistName) === key(name));
  if (!a) return { artist: null };
  const full = await artist(a.artistId, tok);
  return { artist: full.info, similar: full.similar, songs: full.songs.slice(0, 20) };
}
async function album(alid: number, tok: string) {
  return cached(`al:${alid}`, 24 * 3600, async () => {
    const a = await ym(`/albums/${alid}/with-tracks`, tok);
    const tracks = a ? ([] as any[]).concat(...(a.volumes || [])) : [];
    return { info: collection(a), songs: clean(tracks.map(song)) };
  });
}
async function chart(limit: number) {
  return cached(`ch:${limit}`, 3 * 3600, async () => { const r = await ym('/landing3/chart/russia', ''); return clean(((r && r.chart && r.chart.tracks) || []).slice(0, limit).map((x: any) => song(x.track))); });
}
async function newReleases(limit: number) {
  return cached(`new:${limit}`, 6 * 3600, async () => {
    const r = await ym('/landing3/new-releases', '');
    const ids: any[] = ((r && r.newReleases) || []).slice(0, limit);
    if (!ids.length) return [];
    const list = await ym('/albums', '', { method: 'POST', form: { 'album-ids': ids.join(',') } });
    return clean((list || []).map(collection));
  });
}
async function stream(tid: number, tok: string) {
  const infos: any[] = (await ym(`/tracks/${tid}/download-info`, tok)) || [];
  const ok = infos.filter((i) => ['mp3', 'aac', 'he-aac'].includes(String(i.codec || '').toLowerCase()) && i.downloadInfoUrl);
  if (!ok.length) throw new HttpErr('Для этого трека Яндекс не отдал звук', 404);
  ok.sort((a, b) => (Number(b.codec === 'mp3') - Number(a.codec === 'mp3')) || ((b.bitrateInKbps || 0) - (a.bitrateInKbps || 0)));
  const best = ok[0];
  const xml: string = await ym(best.downloadInfoUrl, tok, { text: true });
  const tag = (n: string) => ((xml.match(new RegExp('<' + n + '>([^<]*)</' + n + '>')) || [])[1] || '');
  const host = tag('host'), path = tag('path'), ts = tag('ts'), s = tag('s');
  if (!host || !path) throw new HttpErr('Не удалось получить ссылку на звук', 502);
  const sign = md5(SIGN_SALT + path.slice(1) + s);
  return { url: 'https://' + host + '/get-mp3/' + sign + '/' + ts + path, preview: !!best.preview, bitrate: best.bitrateInKbps, codec: best.codec };
}
// «Моя волна» Яндекса — как в версии для Windows: фильтры «Моего пульса» становятся настройками волны,
// after — последний трек очереди (Яндекс продолжает поток с него). Только со входом.
let waveKey = '', waveStarted = false;
async function wave(tok: string, mood: string, kind: string, lang: string, after: string) {
  const t = cleanToken(tok); if (!t) return { results: [], need: 'token' };
  const k = [t.slice(-6), mood, kind, lang].join('|');
  if (k !== waveKey) {
    try { await raw('/rotor/station/user:onyourwave/settings3', t, { method: 'POST', form: undefined, ms: 8000, json: { moodEnergy: mood, diversity: kind, language: lang, type: 'rotor' } } as any); waveKey = k; } catch {}
  }
  if (!waveStarted) { waveStarted = true; raw('/rotor/station/user:onyourwave/feedback', t, { method: 'POST', json: { type: 'radioStarted', from: 'mobile-radio-user-onyourwave', timestamp: new Date().toISOString() } } as any).catch(() => {}); }
  const r = await ym('/rotor/station/user:onyourwave/tracks?settings2=true' + (after ? '&queue=' + encodeURIComponent(after) : ''), t, { ms: 10000 });
  return { results: clean(((r && r.sequence) || []).map((x: any) => song(x.track))) };
}
async function health(tok: string) {
  try {
    const r = await ym('/search?text=' + encodeURIComponent('Кино') + '&type=track&page=0', tok);
    const n = (r && r.tracks && r.tracks.results && r.tracks.results.length) || 0;
    const bad = tokenProblem(tok);
    return { ok: true, yandex: n > 0, found: n, auth: !!cleanToken(tok) && !bad, tokenError: bad || null };
  } catch (e: any) { return { ok: true, yandex: false, error: String((e && e.message) || e).slice(0, 300) }; }
}

// путь как у сервера → ответ как у сервера (бросает ошибку с полем status, если Яндекс не ответил)
export async function ymLocal(path: string, token: string): Promise<any> {
  // разбираем сами: URL в React Native умеет не всё (pathname/searchParams)
  const qi = path.indexOf('?'); const p = qi < 0 ? path : path.slice(0, qi);
  const params: Record<string, string> = {};
  if (qi >= 0) for (const kv of path.slice(qi + 1).split('&')) { if (!kv) continue; const i = kv.indexOf('='); const k = decodeURIComponent((i < 0 ? kv : kv.slice(0, i)).replace(/\+/g, ' ')); params[k] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); }
  const q = (k: string) => params[k] || '';
  const lim = (d: number, mx: number) => Math.min(mx, +q('limit') || d);
  let m: RegExpMatchArray | null;
  if (p === '/health') return health(token);
  if (p === '/wave') return wave(token, q('mood') || 'all', q('kind') || 'default', q('lang') || 'any', q('after'));
  if (p === '/search') return { results: await search(q('term'), q('entity') || 'song', lim(30, 50), token) };
  if (p === '/match') return match(q('title'), q('artist'), token);
  if ((m = p.match(/^\/artist\/(\d+)\/songs$/))) return { results: await artistSongs(+m[1], lim(200, 300), token) };
  if ((m = p.match(/^\/artist\/(\d+)$/))) return artist(+m[1], token);
  if (p === '/artist-by-name') return artistByName(q('name'), token);
  if ((m = p.match(/^\/album\/(\d+)$/))) return album(+m[1], token);
  if (p === '/chart') return { results: await chart(lim(50, 100)) };
  if (p === '/new') return { results: await newReleases(lim(20, 50)) };
  if ((m = p.match(/^\/stream\/(\d+)$/))) return stream(+m[1], token);
  throw new HttpErr('Нет такой точки: ' + p, 404);
}
