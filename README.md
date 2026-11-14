# Niyet

Kaza namazı kayıt defteri. Statik web uygulaması: sunucu yok, veri telefonda (`localStorage`).

## Dosyalar

| Dosya | Görevi |
| --- | --- |
| `index.html` | Sayfa iskeleti (ilk açılış, ana ekran, ayarlar) |
| `style.css` | Renkler, boyutlar (üstteki CSS değişkenleri) |
| `calc.js` | Hesaplar: süre, seri, yedek doğrulama (arayüzden bağımsız) |
| `app.js` | Arayüz, olaylar, saklama, yedek |
| `manifest.json`, `sw.js`, `icon-*.png` | Ana ekrana ekleme ve internetsiz çalışma |
| `test-calc.js` | Hesap testleri: `node test-calc.js` |

## Yerelde deneme

```
python3 -m http.server 8000
```

Sonra `http://localhost:8000` adresini aç.

## Güncelleme yaparken

Dosyalar internet varken her açılışta taze alınır, bu yüzden normalde ek bir şey gerekmez. `sw.js` içindeki `CACHE` sürümünü (`niyet-v4`) yalnızca önbellek mantığını değiştirdiğinde artır.

## Veri

Tek anahtar: `niyet-data-v1`. Yedek dosyası aynı JSON'a `"app": "niyet"` ekler. Tarihler `YYYY-MM-DD`.
