// CI: открывает тестовую страницу в Chromium (как в «Пульсе» — WebAssembly, один поток) и сравнивает разметку с правдой
import { chromium } from 'playwright';
import fs from 'fs';
const b = await chromium.launch(); const pg = await b.newPage();
pg.on('console', (m) => console.log('[page]', m.text())); pg.on('pageerror', (e) => console.log('[page error]', e.message));
await pg.goto('http://127.0.0.1:8123/test/index.html');
await pg.waitForFunction(() => window.testReady === true, null, { timeout: 60000 });
const { meta, res } = await pg.evaluate(() => window.runTest());
await b.close();
const errs = []; let lines = 0;
for (const [li, times] of res.lines) {
  const tr = meta.truth[li]; if (!tr || tr.length !== times.length) { console.log('строка', li, 'число слов не совпало', tr && tr.length, times.length); continue; }
  lines++; times.forEach((t, k) => errs.push(Math.abs(t - tr[k])));
}
errs.sort((a, b) => a - b);
const med = errs.length ? errs[Math.floor(errs.length / 2)] : 99, p90 = errs.length ? errs[Math.floor(errs.length * 0.9)] : 99;
const within = errs.filter((e) => e <= 0.25).length / Math.max(1, errs.length);
const total = meta.truth.reduce((a, x) => a + x.length, 0);
const report = { время_мс: res.ms, длина_с: Math.round(meta.dur), строк_размечено: lines + ' из ' + meta.truth.length, пар_найдено: res.c,
  медиана_ошибки_с: +med.toFixed(3), ошибка_90проц_с: +p90.toFixed(3), точно_в_025с: +(within * 100).toFixed(1) + '%', слов_проверено: errs.length + ' из ' + total };
console.log(JSON.stringify(report, null, 1));
console.log('услышано:', (res.heard || []).map((h) => h.w + '@' + h.a.toFixed(2)).join(' '));
fs.writeFileSync('test-report.json', JSON.stringify({ report, res }, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Проверка ИИ-разметки\n```\n' + JSON.stringify(report, null, 1) + '\n```\n');
if (!(lines >= meta.truth.length * 0.6 && med < 0.3)) { console.log('ПРОВЕРКА НЕ ПРОЙДЕНА'); process.exit(1); }
