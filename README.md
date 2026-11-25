# plotdigi

Grafik görsellerinden sayısal veri çıkaran, tek sayfalık ve sade bir frontend uygulaması.
Hesaplamalar [WebPlotDigitizer](https://automeris.io/docs/) JavaScript çekirdeğiyle yapılır.
Sunucu, derleme adımı veya bağımlılık kurulumu gerekmez.

## Çalıştırma

`index.html` dosyasını tarayıcıda açmanız yeterli. İsterseniz yerel bir sunucuyla da açabilirsiniz:

```sh
python3 -m http.server 8000
# http://localhost:8000
```

GitHub Pages ile de olduğu gibi yayınlanabilir.

## Kullanım

1. **Görsel ekleyin.** Tıklayıp seçin, sürükleyip bırakın veya `Ctrl` + `V` ile panodan yapıştırın.
2. **Eksenleri kalibre edin.** Görsel üzerinde sırasıyla X1, X2 (x ekseni) ve Y1, Y2 (y ekseni) noktalarına tıklayın ve sağ panelde değerlerini yazın. Logaritmik eksenler için `X log` / `Y log` kutularını işaretleyin. Ondalık virgül (`0,5`) ve tarih değerleri desteklenir.
3. **Veri noktalarını alın.**
   - *Manuel:* Görsele tıklayarak nokta ekleyin. `Shift`+tık veya sağ tık en yakın noktayı siler, `Ctrl`+`Z` son noktayı geri alır.
   - *Otomatik:* Eğri rengini seçin (gerekirse “Görselden seç”), isterseniz algılama alanını dikdörtgenle sınırlayın, algoritmayı seçip **Çalıştır**'a basın.
     - *Ortalama pencere:* Renkli pikselleri ΔX/ΔY piksel pencerelerinde ortalar; çizgi ve nokta grafikleri için uygundur.
     - *X adımı (interpolasyon):* Belirtilen X aralığında sabit ΔX adımlarıyla değer üretir.
4. **CSV'yi alın.** Sağ alttaki alanda CSV anında güncellenir; **Kopyala** veya **İndir (.csv)** ile dışarı aktarın.

İpucu: Fare görselin üzerindeyken çıkan büyüteç, kalibrasyon noktalarını hassas yerleştirmeye yardım eder ve kalibrasyondan sonra imlecin veri koordinatlarını gösterir.

## Dosyalar

```
index.html   Arayüz
style.css    Stil
app.js       Uygulama mantığı (yükleme, kalibrasyon, çıkarma, CSV)
lib/wpd/     WebPlotDigitizer çekirdek dosyaları (değiştirilmeden kopyalandı)
```

`lib/wpd/` içindeki dosyalar [automeris-io/WebPlotDigitizer](https://github.com/automeris-io/WebPlotDigitizer) deposunun `javascript/core` klasöründen alınmıştır (commit `3a3ecb1`, v5.3.0).

## Lisans notu

WebPlotDigitizer **GNU AGPL-3.0** ile lisanslıdır (`lib/wpd/LICENSE`). Bu kodu içeren bir uygulamayı dağıtmak veya yayınlamak, AGPL koşullarına uymayı gerektirir (genellikle projenin de AGPL uyumlu bir lisansla açık kaynak olması).
