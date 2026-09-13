# Huberman Lab bilgi tabanı

Kanalın tamamı aranabilir halde. Amaç, 526 videoyu ezberlemek değil — bir soru
geldiğinde konunun **hangi bölümde, kaçıncı dakikada** geçtiğini bulup sadece o
pasajı okumak.

## Katmanlar

| Dosya | Ne | Boyut |
|---|---|---|
| `catalog.json` | 526 videonun başlık/tarih/süre/açıklaması | ~1,8 MB |
| `chapters.tsv` | 9.409 bölüm başlığı + zaman damgası (arama indeksi) | ~1,4 MB |
| `transcripts/` | Video başına tam transkript, her satır zaman damgalı | ~47 MB |

## Kullanım

```bash
# Bir konunun geçtiği yerleri listele
python lookup.py creatine --list-only

# İlk 4 eşleşmenin transkript pasajını da oku
python lookup.py creatine

# Birden fazla terim (VEYA), pasaj başına en fazla 8 dakika
python lookup.py hypertrophy "training volume" --max 5 --window 8
```

Her sonuç videoya dakikasından başlayan bir link verir (`&t=1610s`).

## Bakım

```bash
python fetch_catalog.py        # katalogu tazele (API key gerekir, ~22 kota birimi)
python build_index.py          # katalogdan chapters.tsv'yi yeniden üret
python download_transcripts.py # eksik transkriptleri indir (kaldığı yerden devam eder)
```

`download_transcripts.py` yeniden çalıştırılabilir: diskte olanı atlar, YouTube
engellerse geri çekilip bekler. Varsayılan bekleme 3 sn; argümanla değiştirilir
(`python download_transcripts.py 5`).

## Sınırlar

- Arama **bölüm başlıklarında** yapılır, transkriptin tamamında değil. Başlıkta
  geçmeyen bir konu kaçabilir — o durumda `grep -ri "terim" transcripts/` ile tam
  metinde aranır (daha yavaş, daha çok sonuç).
- Başlıklar İngilizce. Türkçe terimi İngilizce karşılığıyla aratmak gerekir
  (kas büyümesi → hypertrophy, yağ yakımı → fat loss).
- 526 videonun 437'sinde bölüm listesi var; kalan 89'u çoğunlukla kısa klip.
- Transkriptler büyük ölçüde otomatik üretilmiş: noktalama yok, özel isimlerde
  ve terimlerde hata olabilir.
