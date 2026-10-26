# Пульс для Windows OS

Установщик: **[последний релиз](https://github.com/pulsmusic/pulse-desktop/releases/latest)** → `Pulse-Desktop-Alpha-Setup.exe`.

Обновления программа берёт сама: Профиль → «Обновления» → «Проверить обновления» (и автоматически при запуске)
из файла `latest.json` последнего релиза.

Как выходит новая версия: в папку `updates/<версия>/` кладутся `latest.json` и `pulse-app-<версия>.zip`,
ставится тег `v<версия>` — GitHub Actions (`.github/workflows/release.yml`) сам проверяет файлы и создаёт релиз.
