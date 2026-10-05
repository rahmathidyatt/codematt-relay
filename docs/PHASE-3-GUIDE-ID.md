# Panduan Phase 3 — Templates & draft campaign

Paket ini berisi seluruh kode Phase 1, 2, dan 3. Phase 3 menambahkan sinkronisasi template Meta, pilihan audience, pemetaan variabel, preview personal, serta draft yang tersimpan. Belum ada pengiriman pesan, kirim test, atau jadwal aktif.

## Jalankan di Windows / VS Code

1. Hentikan server Phase 2 di terminal dengan Ctrl+C.
2. Buat salinan cadangan folder proyek lama. Ekstrak ZIP Phase 3 ke folder baru dan buka folder `codematt-relay` di VS Code. Pastikan terminal berada di folder yang berisi `package.json`.
3. Jika ingin melanjutkan kontak demo lama, salin folder `.demo-data` dari proyek Phase 2 ke folder proyek baru saat kedua server berhenti. Jangan salin `node_modules` lama. Jika menggunakan folder proyek yang sama, pertahankan data demo dan konfigurasi lokal Anda saat mengganti source.
4. Gunakan Node.js 24, lalu jalankan:

```powershell
npm ci
npm run dev
```

5. Buka alamat yang muncul di terminal, biasanya `http://127.0.0.1:5173`.
6. Klik **Lihat preview lokal**. Tidak perlu email dan kata sandi untuk demo. Tidak ada akun bawaan. Login produksi memakai akun Netlify Identity yang diundang.

Migrasi ketiga otomatis diterapkan ke database demo. Kontak Phase 2 tetap tersedia. Data demo tidak otomatis dipindahkan ke Netlify. **Reset demo** menghapus semua data contoh lokal, termasuk kontak, template, dan campaign.

## Coba campaign pertama

1. Di **Contacts**, tambahkan kontak contoh dengan nama dan nomor yang valid. Untuk menguji preview, isi consent aktif dengan sumber dan tanggal contoh. Gunakan data latihan lokal.
2. Di **Templates**, klik **Muat template contoh**. Label SIMULASI menjelaskan bahwa status contoh bukan persetujuan Meta. Ada contoh teks bernomor, teks bernama, status pending, dan header gambar yang belum didukung.
3. Buka **Campaigns → Buat campaign**.
4. **Audience:** beri nama campaign. Pilih semua kontak, segmen tag/pencarian, atau kontak manual. Klik **Hitung kelayakan audience**. Arsip, opt-out, consent tidak aktif, dan nomor invalid dikecualikan.
5. **Template:** pilih `contoh_sapaan`. Petakan `BODY:1` ke **Nama kontak**. Petakan `BODY:2` ke **Teks yang sama untuk semua**, lalu isi misalnya `codematt Relay`.
6. **Preview:** klik **Perbarui preview**. Pilih kontak pada menu **Preview sebagai**. Tombol halaman membuka lima kontak berikutnya. Semua ini simulasi visual.
7. **Simpan draft:** periksa ringkasan, lalu klik **Simpan draft**. Draft boleh disimpan saat template atau variabel belum lengkap. Pemeriksaan akan menjelaskan kekurangannya.
8. Tutup dialog. Refresh halaman, masuk preview lokal lagi, lalu buka campaign dari daftar untuk melanjutkan draft.

Perubahan belum tersimpan memicu konfirmasi saat menutup dialog dan peringatan saat meninggalkan halaman. Jika muncul konflik versi atau respons penyimpanan tidak pasti, tutup lalu buka ulang draft dari daftar agar memakai versi server terbaru. Jangan memaksa menimpa versi lama.

## Audience dan variabel

- **Semua kontak:** menghitung seluruh kontak, termasuk alasan pengecualian.
- **Segmen:** satu atau beberapa tag dipisahkan koma; cocok salah satu atau semua tag. Pencarian nama/nomor digabung dengan aturan tag. Aturan disimpan dalam draft, bukan sebagai segmen global bernama.
- **Manual:** cari dan centang kontak pada beberapa halaman. Pilihan tetap ada saat berpindah halaman. Maksimal 1.000 kontak; kontak arsip tidak muncul pada pemilih.
- Maksimal 10.000 kontak yang cocok sebelum pengecualian. Persempit segmen jika melebihi batas.
- Variabel bisa berasal dari nama, nomor E.164, atau teks tetap. Placeholder bernomor dan bernama didukung pada body/header teks. Variabel header dan body dipetakan terpisah.
- Preview membaca ulang kontak dan template saat tombol pemeriksaan diklik. Snapshot tersimpan adalah catatan historis, bukan izin pengiriman. Jika kontak opt-out setelah draft disimpan, preview berikutnya mengecualikannya.
- Semua admin/operator pada satu workspace dapat melanjutkan draft. Viewer tidak dapat membaca data campaign/template atau kontak. Hanya admin dapat menyinkronkan template Meta.

## Sinkronisasi Meta asli di Netlify

Demo selalu memakai data contoh; mengisi token tidak mengubah demo menjadi mode asli.

Untuk mode asli, gunakan proyek Netlify dengan Identity dan Database yang sudah dikonfigurasi, kemudian isi variabel runtime Functions berikut melalui pengaturan proyek:

| Variabel | Isi |
| --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | Token Meta milik akun Anda dengan akses WABA dan izin pengelolaan WhatsApp yang diperlukan |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | ID WhatsApp Business Account, bukan Phone Number ID |
| `WHATSAPP_API_VERSION` | Versi Graph API yang masih didukung dan telah Anda verifikasi, dalam format `vNN.0` |
| `WHATSAPP_SEND_ENABLED` | Tetap `false`; rilis ini tidak memiliki endpoint pengiriman |

Jangan masukkan token ke chat, source, variabel berawalan `VITE_`, atau browser. Kredensial hanya dibaca di server. Untuk penggunaan lokal dengan Functions asli, ikuti `netlify link` dan `netlify dev` di README; buka URL Netlify Dev dan login dengan akun undangan, bukan tombol demo.

Pastikan migrasi `0001`, `0002`, dan `0003_campaign_drafts.sql` ikut dalam deployment. Jangan menjalankan ulang atau mengubah migrasi lama yang sudah diterapkan. Uji deployment preview terlebih dahulu.

Login sebagai admin → **Templates → Sinkronkan Template**. Server mengambil `/{WABA-ID}/message_templates` dari Graph API resmi. Status tidak dapat diubah menjadi approved melalui aplikasi. Sinkronisasi harus lengkap sebelum database diperbarui. Jika gagal, cache sebelumnya tetap ada. Template yang hilang dari hasil sinkronisasi sukses ditandai `UNAVAILABLE`.

Template harus berstatus `APPROVED`, berasal dari akun yang aktif, memiliki komponen yang didukung, dan disinkronkan dalam 24 jam terakhir agar bisa dipilih. Sinkronisasi tidak otomatis: admin perlu menekan tombol lagi. Jika akun berubah, sinkronkan akun baru sebelum melanjutkan draft. Status provider tetap perlu diperiksa lagi dalam pipeline Phase 4.

Batas sinkronisasi: 1.000 template, 10 halaman, 2 MiB per respons, batas koneksi keseluruhan 20 detik. Katalog menampilkan maksimal 1.000 baris, mengutamakan template akun aktif yang tidak `UNAVAILABLE`. Akun lebih besar membutuhkan perluasan backend sebelum digunakan.

## Cakupan format dan batas Phase 3

Didukung dalam builder: header TEXT, body teks, footer statis, tombol QUICK_REPLY/URL/PHONE_NUMBER tanpa variabel. Preview tombol menampilkan label; tombol tidak menjalankan tindakan. Belum didukung dalam builder: header gambar/video/dokumen/lokasi, tombol URL dinamis, autentikasi/OTP, carousel, katalog, Flow, dan komponen lain. Template tersebut tetap dapat disinkronkan dan dilihat dengan alasan ketidaktersediaannya.

Belum tersedia: pembuatan/submission template ke Meta, segmen global bernama, variabel kustom per kontak, duplikasi/hapus campaign, penjadwalan, kirim test, launch/pause/cancel, antrean, webhook, dan status delivery. Tidak ada pesan yang dikirim oleh rilis ini, termasuk jika flag pengiriman salah diaktifkan.

## Pemeriksaan di komputer Anda

```powershell
npm run check
npx playwright install chromium
npm run test:e2e
```

46 tes lokal dan build berhasil di lingkungan pengembangan paket. Uji browser di lingkungan pembuat paket terhalang pembatasan socket Chromium, sehingga belum ada verifikasi visual desktop/mobile. File skenario E2E Phase 2 dan Phase 3 disertakan.

Belum ada deployment Netlify, login Identity nyata, atau permintaan ke WABA nyata dalam pembuatan paket ini. Kredensial, izin akun, migrasi PostgreSQL terkelola, serta siklus login perlu diuji pada proyek Netlify Anda sebelum penggunaan operasional.
