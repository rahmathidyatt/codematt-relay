# Panduan Phase 4 — Antrean, jadwal, dan webhook WhatsApp

Paket ini mencakup Phase 1–4. Ada adapter WhatsApp Cloud API, antrean database dengan Async Workloads, scheduler, webhook status/opt-out, test send, dan kontrol campaign. **Pengiriman asli nonaktif secara default.** Demo tetap sepenuhnya lokal tanpa panggilan ke Meta.

## Mulai di VS Code

1. Hentikan server lama dengan Ctrl+C di terminal VS Code.
2. Cadangkan folder proyek Phase 3. Ekstrak ZIP Phase 4 dan buka folder `codematt-relay` yang berisi `package.json` melalui **File → Open Folder**.
3. Untuk mempertahankan kontak/draft demo, salin folder `.demo-data` dari folder lama ke folder proyek baru ketika kedua server berhenti. Jangan salin `node_modules`. Jika memperbarui source di folder yang sama, pertahankan data demo dan konfigurasi pribadi Anda.
4. Buka **Terminal → New Terminal**. Dengan Node.js 24 terpasang, jalankan:

```powershell
npm ci
npm run dev
```

5. Buka alamat lokal yang dicetak terminal, biasanya `http://127.0.0.1:5173`.
6. Klik **Lihat preview lokal**. Tidak memerlukan email/sandi. Tidak ada akun login bawaan.

Migrasi keempat otomatis diterapkan pada database demo. **Reset demo** menghapus kontak, draft, antrean, status, dan bukti opt-out simulasi; jangan gunakan jika ingin mempertahankannya.

## Coba Phase 4 tanpa WhatsApp asli

1. **Contacts:** tambahkan kontak latihan dengan nomor valid dan consent aktif, sumber bukti, serta tanggal contoh. Semua data latihan tetap lokal.
2. **Templates → Muat template contoh.** Sinkronkan ulang bila contoh sudah lebih dari 24 jam.
3. **Campaigns → Buat campaign:** pilih audience, template, isi variabel, periksa preview, lalu **Simpan draft**.
4. Di langkah terakhir atau daftar campaign, klik **Tinjau & kirim**. Draft harus tersimpan lebih dahulu.
5. Pilih **Kirim sekarang melalui antrean**, centang konfirmasi, lalu klik **Mulai simulasi**. Untuk 100 penerima atau lebih, ketik nama campaign sesuai yang ditampilkan.
6. Di monitor, klik **Proses 1 batch simulasi**. Demo memproses maksimal 5 penerima per klik. Status awal hasilnya **Diterima adapter demo**, bukan langsung delivered/read.
7. Buka **Simulasi webhook dan opt-out**, pilih penerima pada halaman ini dan event **Diterima penerima** atau **Dibaca**, lalu **Terapkan event simulasi**.
8. Coba **Pause**, lalu **Resume**, atau **Batalkan campaign**. Coba event **Balasan STOP** sebelum memproses antrean untuk melihat penerima dilewati dan consent dicabut.

Demo tidak berjalan di latar belakang sendiri. Jadwal demo diproses ketika Anda menekan tombol batch setelah waktunya tiba. Di Netlify produksi, scheduler dan Async Workloads menjalankannya di server tanpa browser harus tetap terbuka.

## Jadwal dan kirim test

Pada dialog **Tinjau & kirim**:

- **Kirim sekarang:** memasukkan pekerjaan ke antrean; scheduler akan meneruskannya. Permintaan browser tidak melakukan pengiriman ke ribuan nomor.
- **Jadwalkan campaign:** pilih tanggal/jam dan zona **Asia/Jakarta**, **Asia/Makassar**, **Asia/Jayapura**, atau **UTC**. Minimal satu menit dan maksimal satu tahun ke depan. Waktu disimpan sebagai UTC; zona pilihan tetap dicatat.
- **Kirim test ke satu kontak:** memilih satu kontak layak dari audience, membuat campaign test terpisah, dan memakai antrean/validasi yang sama. Draft utama tidak diluncurkan. Daftar test menampilkan maksimal 100 kontak pertama; gunakan audience manual/segmen untuk mempersempit pilihan.

Jadwal adalah waktu paling awal campaign boleh diproses, bukan jaminan pesan terkirim tepat pada detik itu. Polling setiap menit, waktu antrean, pause, batas provider, dan retry dapat menambah jeda.

## Arti status yang ditampilkan

| Status penerima | Makna |
| --- | --- |
| Dalam antrean | Belum dikirim ke provider |
| Sedang diproses | Worker sudah mencatat niat pengiriman dan sedang melakukan permintaan |
| Diterima Meta | Provider mengembalikan ID pesan; belum membuktikan delivery |
| Terkirim / Diterima penerima / Dibaca | Berasal dari webhook Meta yang diverifikasi |
| Gagal | Penolakan definitif, status gagal dari provider, atau batas retry tercapai |
| Dilewati | Opt-out, consent tidak layak, arsip, nomor berubah, atau pembatalan sebelum diproses |
| Hasil belum pasti | Timeout, gangguan setelah klaim, respons tidak jelas, atau pencatatan hasil gagal; tidak otomatis dikirim ulang |

**Selesai diproses** pada campaign berarti pekerjaan antrean selesai, bukan semua pesan sudah sampai/dibaca. Lihat status tiap penerima. Hasil belum pasti memerlukan pemeriksaan bukti provider; jangan langsung membuat campaign ulang untuk seluruh audience. Rilis ini tidak memiliki tombol retry paksa untuk status tersebut.

Pause/cancel berlaku untuk pekerjaan yang belum diteruskan. Permintaan yang sudah dimulai dapat tetap diterima provider, bahkan setelah tombol cancel ditekan. Pesan tersebut tidak bisa ditarik kembali.

## Aktifkan integrasi asli di Netlify

Tahap berikut dikerjakan pada akun Netlify/Meta milik Anda; paket ini belum dideploy dan belum menjalankan pengiriman asli.

1. Pastikan site memakai Identity **Invite Only**, role admin/operator/viewer, dan Netlify Database. Sertakan keempat migrasi di `netlify/database/migrations/`; jangan mengubah migrasi lama yang sudah diterapkan. Uji backup dan deployment preview lebih dahulu.
2. Pasang/aktifkan ekstensi **Async Workloads** untuk team/site Netlify. Dependency `@netlify/async-workloads` sudah ada di source; memasang dependency tidak otomatis mengaktifkan ekstensi pada akun. Selesaikan pengaturan API key yang diminta oleh ekstensi. Jangan taruh kunci Async Workloads di browser.
3. Isi variabel runtime **Functions** melalui konfigurasi Netlify, lalu redeploy sesuai kebutuhan perubahan konfigurasi:

| Variabel | Keterangan |
| --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | Token resmi untuk WABA dengan izin pengelolaan template dan pengiriman pesan yang sesuai |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | ID WABA yang dimiliki/dikelola akun |
| `WHATSAPP_PHONE_NUMBER_ID` | ID nomor pengirim Cloud API, bukan nomor telepon bertanda + |
| `WHATSAPP_API_VERSION` | Versi Graph API yang masih didukung, format `vNN.0`; tidak diisi otomatis |
| `META_APP_SECRET` | App Secret untuk verifikasi signature webhook |
| `WHATSAPP_VERIFY_TOKEN` | Nilai rahasia pilihan Anda untuk handshake webhook |
| `WHATSAPP_SEND_ENABLED` | Pertahankan `false` saat konfigurasi awal; `true` mengizinkan pengiriman asli |
| `RELAY_ASYNC_READY` | Tetap `false` sampai ekstensi/router/worker sudah dikonfigurasi; kemudian `true` |
| `RELAY_SEND_INTERVAL_MS` | Default `2000`; 1000–30000 ms. Semua campaign berbagi satu worker pengiriman aktif |
| `RELAY_BATCH_SIZE` | Default `5`; 1–10 penerima per invocation, dibatasi juga anggaran waktu loop |

Live send hanya diizinkan ketika konteks runtime Netlify adalah **production** dan seluruh syarat di atas terpenuhi. Jangan memalsukan konteks production di lokal/deploy preview. Gunakan demo untuk pengujian lokal. Status “Konfigurasi pengiriman aktif” adalah pemeriksaan konfigurasi, bukan bukti bahwa token/akun/cloud telah berhasil diuji.

4. Deploy source dengan Functions, bukan hanya folder `dist`. Fungsi yang harus terpasang: `api`, `whatsapp-webhook`, `relay-scheduler`, dan workload `relay-dispatch`, beserta router/infrastruktur yang dikelola ekstensi.
5. Pada konfigurasi webhook aplikasi Meta, gunakan callback:

```text
https://DOMAIN-SITE-ANDA/api/webhooks/whatsapp
```

Isi verify token yang sama. Langganankan field `messages` untuk status dan inbound; langganankan juga `message_template_status_update` jika tersedia untuk akun/aplikasi Anda. Pastikan aplikasi berlangganan WABA yang benar. Handler menolak signature yang salah dan mengabaikan WABA/phone ID lain. Token bukan App Secret; kedua nilai memiliki kegunaan berbeda.

6. Login sebagai admin dan lakukan **Templates → Sinkronkan Template**. Format yang dapat dikirim pada rilis ini: header/body teks dengan placeholder bernomor/bernama, footer statis, serta tombol umum statis yang didukung. Format media/OTP/tombol dinamis/Flow/katalog tetap diblokir di builder.
7. Setelah konfigurasi lengkap dan sengaja siap melakukan satu pengiriman nyata, aktifkan kedua flag pada konteks produksi. Pilih kontak test milik Anda yang sudah memberi consent, periksa template, lalu lakukan **Kirim test ke satu kontak** melalui UI. Tindakan ini benar-benar dapat mengirim pesan dan memakai kuota/biaya akun Meta.
8. Periksa log Netlify serta monitor: scheduler/worker aktif; accepted memiliki ID provider; delivered/read hanya muncul bila webhook diterima. Kirim STOP dari nomor test dan pastikan consent dicabut. Uji pause/cancel, webhook duplikat, dan pemulihan antrean sebelum penggunaan operasional.

Tidak perlu dan jangan mengirim token, sandi, App Secret, atau API key kepada asisten/chat. Tidak ada pesan asli yang dikirim saat paket ini dibuat.

## Perilaku antrean dan pemulihan

- Launch menyimpan snapshot template, parameter pesan per penerima, daftar penerima unik, dan outbox dalam satu transaksi. Nama/nomor personalisasi mengikuti snapshot launch. Consent/opt-out/arsip tetap dibaca ulang tepat sebelum setiap permintaan.
- Konfirmasi review terikat ke versi draft, template, parameter, serta versi kontak. Jika data berubah setelah review, server meminta review baru.
- Scheduler berjalan tiap menit pada deployment produksi; mempromosikan jadwal jatuh tempo, memulihkan publikasi outbox, serta menandai klaim kedaluwarsa sebagai belum pasti.
- Event Async Workloads hanya berisi `campaignId` dan generasi outbox, bukan daftar kontak. Event berulang aman terhadap penerima yang sudah diproses. Database menjadi sumber status utama.
- Maksimal satu worker pengiriman aktif per workspace. Lease 90 detik diperbarui sebelum klaim; lease penerima 2 menit. Permintaan Meta memakai timeout 10 detik. Batch dibatasi jumlah serta loop sekitar 35 detik; operasi terakhir dapat melampaui anggaran loop tersebut.
- Retry otomatis hanya untuk respons rate-limit yang jelas, maksimal 5 percobaan. `Retry-After` dan penundaan eksponensial diterapkan ke pengiriman berikutnya pada seluruh workspace. Error 5xx, timeout, dan respons ambigu tidak otomatis dikirim ulang karena provider mungkin sudah menerima pesan.
- Penolakan autentikasi/izin/quality tertentu menjeda campaign. Perbaiki masalahnya sebelum resume; penerima yang sudah gagal tetap tidak dikirim ulang otomatis.
- Template yang berumur lebih dari 24 jam, berubah isi, atau tidak lagi usable menjeda campaign. Sinkronkan ulang. Bila konten berubah, batalkan sisa campaign dan susun draft baru dengan audience yang memang belum menerima pesan.
- Webhook status disimpan dengan deduplikasi dan timestamp. Read/delivered tidak mundur akibat event sent/failed yang datang terlambat. Event yang datang lebih awal dari respons API disimpan dan direkonsiliasi setelah ID pesan tercatat.
- Bila respons API hilang dan ID pesan tidak pernah tersimpan, webhook mungkin tidak dapat dipasangkan dengan penerima; status belum pasti tetap dipertahankan. Tidak ada klaim exactly-once untuk jaringan eksternal.
- STOP/UNSUBSCRIBE/BERHENTI dicocokkan sebagai pesan lengkap (trim, tidak membedakan huruf besar/kecil), termasuk balasan tombol yang cocok. Pesan lain tidak disimpan sebagai inbox. Opt-out nomor yang belum ada juga disimpan sebagai suppression. Import consent lama ditolak; consent baru harus lebih baru daripada opt-out.

## Pemeriksaan dan batas saat ini

```powershell
npm run check
npx playwright install chromium
npm run test:e2e
```

Skenario E2E Phase 2–4 disertakan. Chromium belum berhasil dijalankan di lingkungan pembuat paket; tampilan desktop/mobile dan alur klik belum terverifikasi secara visual. Tes service/database/API dan bundling lokal tidak menggantikan uji Netlify/Meta nyata.

Batas audience tetap 10.000 kontak cocok; pilihan manual 1.000. Daftar penerima memakai pagination 25. Tidak ada auto-refresh template, retry paksa pesan belum pasti, upload media, pengelolaan inbox, dashboard analytics lanjutan, atau pengaturan retention otomatis. Phase 5 melanjutkan pelaporan, analytics, audit UI, dan pemeriksaan rilis.
