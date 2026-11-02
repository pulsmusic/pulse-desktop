# Фото артиста для макетов: сначала — аватар из профиля на Яндекс Музыке, если недоступен — главное фото статьи Википедии
import json, sys, urllib.request, urllib.parse
name = sys.argv[1]; out = sys.argv[2]
UA = {"User-Agent": "PulseDesign/1.0 (design mockups)"}
def get(u, h=None):
    return urllib.request.urlopen(urllib.request.Request(u, headers={**UA, **(h or {})}), timeout=20).read()
src = ""
try:
    r = json.loads(get("https://api.music.yandex.net/search?" + urllib.parse.urlencode({"text": name, "type": "artist", "page": 0}), {"X-Yandex-Music-Client": "YandexMusicAndroid/24023621"}))
    a = r["result"]["artists"]["results"][0]; uri = a["cover"]["uri"]
    src = "https://" + uri.replace("%%", "1000x1000"); print("Яндекс:", a["name"], src)
except Exception as e:
    print("Яндекс недоступен:", e)
if not src:
    r = json.loads(get("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({"action": "query", "titles": name, "prop": "pageimages", "piprop": "original", "format": "json", "redirects": 1})))
    p = next(iter(r["query"]["pages"].values())); src = p["original"]["source"]; print("Википедия:", src)
open(out, "wb").write(get(src)); print("сохранено", out)
