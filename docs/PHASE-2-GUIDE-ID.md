# Panduan Phase 2 — codematt Relay

## Membuka versi baru di VS Code

Paket ini berisi **proyek lengkap Phase 1 + Phase 2**, bukan file patch.

1. Hentikan server Phase 1 di terminal VS Code dengan **Ctrl+C**.
2. Ekstrak ZIP Phase 2 ke folder baru. Simpan folder Phase 1 sebagai cadangan.
3. Di VS Code pilih **File → Open Folder**, pilih folder `codematt-relay` hasil ekstrak. Pastikan `package.json` terlihat di panel kiri, bukan masih berada dalam folder ZIP.
4. Buka **Terminal → New Terminal**. Pastikan lokasi terminal adalah folder proyek yang memiliki `package.json`.
5. Pastikan Node.js versi 24 tersedia: jalankan `node --version`.
6. Jalankan, satu per satu:

```sh
npm ci
npm run dev
```

7. Buka alamat dari terminal, biasanya **http://127.0.0.1:5173**.
8. Klik **Lihat preview lokal**, kemudian buka menu **Contacts**.

Jika PowerShell menolak npm.ps1, jalankan `npm.cmd ci` dan `npm.cmd run dev`, atau gunakan profil terminal Command Prompt di VS Code. Jika port 5173 sedang dipakai, hentikan server lama; alternatifnya `npm run dev -- --port 5174`.

## Yang bisa dicoba

- **Tambah kontak**: isi nama, nomor, negara nomor lokal, dan tag.
- **Edit**: ubah nama atau tag. Nomor tidak diubah karena menjadi identitas consent.
- **Consent**: baca riwayat; catat persetujuan baru dengan sumber dan waktu, atau catat opt-out.
- **Arsipkan / Pulihkan**: simpan kontak dalam arsip tanpa menghapusnya. Memulihkan kontak opt-out tidak membuatnya aktif consent.
- **Pilih kontak**: centang beberapa kontak pada halaman yang sama untuk menambah tag atau mengarsipkan/memulihkan bersama.
- **Cari dan filter**: nama/nomor, tag, consent, serta status arsip. Data ditampilkan 25 kontak per halaman.
- **Ekspor CSV**: semua hasil sesuai filter, bukan hanya halaman yang terlihat. Maksimal 10.000 kontak per ekspor.

Mode demo menyimpan data di folder `.demo-data` dalam proyek lokal. Menutup browser lalu membukanya kembali tidak menghapus kontak. Gunakan data contoh. Tombol **Reset demo** meminta konfirmasi dan menghapus seluruh data demo. Database demo tidak ikut ZIP dan tidak diunggah ke Netlify.

## Mencoba import

1. Klik **Import Kontak**.
2. Pilih `examples/kontak-contoh.csv` atau `examples/kontak-contoh.xlsx` yang disertakan.
3. Untuk XLSX, pilih sheet **Kontak**. Sheet **Petunjuk** berisi catatan, bukan data kontak.
4. Pastikan pemetaan **Nama** dan **Nomor WhatsApp** benar. Kolom lain boleh tidak dipetakan.
5. Klik **Tinjau import**. File contoh memiliki 2 nomor valid tanpa consent, 1 duplikat, dan 1 nomor tidak valid.
6. Kontak tanpa consent dapat disimpan sebagai **Belum ada consent** dan tetap tidak layak menerima campaign.
7. Centang konfirmasi peninjauan, lalu klik **Import 2 kontak**.
8. Periksa hasil dan unduh laporan masalah jika ada.

Jika data contoh sudah pernah diimpor, nomor yang sama akan dilewati. Data lama, tag lama, dan consent lama tidak ditimpa.

Format yang diterima: CSV UTF-8 dan XLSX. Batas: 5 MB, 10.000 baris data, 40 kolom, 10 sheet. Header di baris pertama. XLSX harus berisi nilai, tanpa formula, macro, atau tautan eksternal; `.xls` perlu disimpan ulang menjadi `.xlsx`. Nomor telepon sebaiknya disimpan sebagai **teks**, bukan notasi ilmiah Excel.

Kolom contoh: `Nama`, `No WhatsApp`, `Tag`, `Consent`, `Sumber Consent`, `Tanggal Consent`. Tag dipisahkan koma atau titik koma. Status consent: `active/aktif/ya`, `unknown/belum/tidak`, atau `revoked/opt-out/stop`. Status lain dilaporkan sebagai masalah. Consent aktif tanpa sumber atau tanggal ditolak, bukan dianggap sah.

Tanggal import menerima `YYYY-MM-DD` (tengah malam Asia/Jakarta) atau ISO berzona waktu, misalnya `2026-10-01T10:00:00+07:00`. Form manual menampilkan waktu lokal perangkat. Tanggal masa depan tidak diterima.

## Jika import terputus

Biarkan dialog tetap terbuka, periksa koneksi, lalu klik **Lanjutkan import**. Batch yang sudah berhasil tidak dikirim ulang sebagai kontak baru. Setiap batch berisi maksimal 100 baris.

Jika halaman ditutup atau dimuat ulang, pilih file yang sama dan import ulang. Nomor yang sudah berhasil tersimpan akan dilewati. Laporan import yang baru hanya menghitung proses baru tersebut. Jangan menganggap seluruh import dibatalkan ketika satu batch gagal; batch sebelumnya sudah tersimpan.

## Beralih ke Netlify

Phase 2 memakai konfigurasi Identity dan Database yang sama dengan Phase 1. Jika sudah memiliki `.env` atau tautan proyek `.netlify`, simpan file lokal itu dengan aman; jangan menyalinnya ke repositori publik. Untuk folder ekstraksi baru, lebih baik hubungkan kembali proyek melalui `netlify link` dan gunakan proyek Netlify yang sama.

Jalankan `netlify dev` untuk backend Netlify, lalu buka port yang dicetak CLI (biasanya 8888) dan masuk dengan akun undangan. Mode demo tidak memindahkan data otomatis ke database Netlify.

Migrasi tambahan adalah `0002_contacts_imports.sql`. Jangan menghapus atau mengubah migrasi `0001_foundation.sql` yang sudah digunakan. Saat deploy, periksa log bahwa migrasi kedua berhasil. Data produksi dari Phase 1 tetap dipertahankan oleh migrasi tambahan ini.

Pengiriman WhatsApp belum tersedia pada Phase 2. **Tahap berikutnya: Phase 3 — sinkronisasi template resmi, pemetaan variabel, dan pembuatan draft campaign.**
