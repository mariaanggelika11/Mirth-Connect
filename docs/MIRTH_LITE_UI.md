# Mirth Connect Lite UI — 16 Oktober 2026

## Konsep dan navigasi

Wizard mengikuti **Source → Transformation → Destinations → Review & Test**. User membuat integrasi Sistem A → Mirth-Connect → Sistem B melalui format, mapping dan endpoint. Filter, scripting dan pengaturan delivery tersedia melalui Advanced. Kemampuan inti engine tetap dipertahankan.

```mermaid
flowchart LR
  A[Sistem A] --> S[Source connector]
  S --> V[Validation]
  V --> F[Source filter]
  F --> T[Source transformer / visual mapping]
  T --> M[Channel message / configuration snapshot]
  M --> DF[Destination filter / routing]
  DF --> DT[Destination transformer / template]
  DT --> C[Format conversion]
  C --> D[Destination connector]
  D --> B[Sistem B]
  D --> R[Retry / error handling / monitoring]
```

Navigasi utama terdiri dari Overview, Channels, Messages dan Settings. Start/Stop tetap berada pada Channels; resend, reconciliation dan attempt history tetap tersedia pada Messages sesuai permission. Penyederhanaan ini tidak menghapus worker, retry, circuit breaker, dead letter, routing atau snapshot konfigurasi.

| Kemampuan | Lokasi UI |
| --- | --- |
| Source connector, inbound format, API key, endpoint | Source |
| Validation, source filter, source transformer | Advanced source settings |
| Mapping dua kolom Source Field / Target Field, Add Mapping | Transformation |
| Required/default | Mapping options per baris, awalnya tertutup |
| Script transformasi kompleks | Advanced Custom Transformation Script |
| Sample, preview, test transformation, connection probe | Review & Test |
| Nama, connector, outbound format, endpoint destination | Destinations |
| Destination filter / transformer / template | Advanced destination settings |
| Retry, timeout, capacity dan circuit protection | Advanced destination settings → Delivery settings |
| Multiple destinations | Add Destination; default satu destination |
| Draft, publish, rollback dan revision history | Revisions |
| Inbound, source processed, outbound dan delivery result | Messages |

## Dropdown

Dropdown pada filter, Source, Destinations, Messages dan Settings memakai ukuran/padding yang seragam, indikator pilihan aktif dan focus keyboard yang terlihat. Menu mengikuti lebar field, membatasi tinggi daftar dengan scroll, dan menjaga label panjang di dalam viewport. Search/filter pada mobile mempunyai ruang terpisah. Escape menutup menu pilihan terlebih dahulu; tekan kembali untuk menutup dialog.

Semantik select native, label, value, permission dan keyboard navigation tetap digunakan. Browser yang mendukung `appearance: base-select` mendapat menu bergaya aplikasi; browser lain tetap memakai picker sistem dengan field yang ditata konsisten.

Contoh sintetis: [filter Channels](screenshots/usability/dropdown-channels.png), [dropdown form](screenshots/usability/dropdown-source.png), [mobile](screenshots/usability/dropdown-mobile.png).

Verifikasi dropdown: client build, workspace typecheck, lint, format dan 57 browser test lulus. Pemeriksaan sintetis Chrome 155 pada desktop, modal dan mobile 390px mencakup ukuran menu, daftar panjang/scroll, keyboard, Escape serta label panjang. Pemeriksaan awal menemukan horizontal overflow dan Escape yang menutup dialog; keduanya diperbaiki lalu diperiksa ulang. Unit/backend, database dan dependency tidak berubah atau diuji ulang khusus perubahan tampilan ini.

## 1. Source

Source langsung menampilkan nama channel, connector, inbound format, source endpoint dan source API key. Endpoint HTTP berasal dari backend melalui konfigurasi `PUBLIC_BASE_URL` dan `INBOUND_PATH`; frontend tidak menebak hostname production. Contoh development `http://localhost:9000` dan production `https://connect.bulmar.tech` merupakan nilai konfigurasi, bukan alamat tetap pada UI. Channel baru menampilkan `{channelId}` sampai disimpan.

API key digunakan oleh sistem sumber untuk mengirim data ke channel. Key hanya tampil sekali setelah generate/rotate; rotasi membatalkan key sebelumnya. Menutup editor atau berpindah langkah menghapus key dari tampilan. Key tidak ditampilkan kembali pada list atau audit plaintext. Tombol **Copy API key** tetap tersedia pada tampilan sekali tersebut. Tombol Copy endpoint, curl, Postman dan request examples sudah dihapus; alamat endpoint masih dapat dipilih/disalin manual.

**Advanced source settings** berurutan:

1. **Validation**: menentukan apakah pesan valid.
2. **Source filter**: menentukan apakah pesan valid tersebut diproses.
3. **Source transformer**: menunjukkan status dan tombol Configure transformation untuk normalisasi lanjutan.

Source response editor tidak ditampilkan. Channel existing yang memakainya hanya menampilkan **Legacy custom source response is active.** Script tetap disimpan dan dijalankan backend. Response HTTP standar memiliki `success`, `messageId`, `status` serta `result` existing untuk compatibility; response error dan HL7 ACK mengikuti kontrak backend yang berlaku.

Hasil processing gagal yang sudah tercatat mengembalikan HTTP 502 dengan code `MESSAGE_PROCESSING_FAILED`, pesan aman, requestId dan details kosong. `result` dan custom response legacy tetap dipertahankan. FILTERED tetap HTTP 200 dan QUEUED tetap HTTP 202 tanpa error fields.

### 8.3 Message Validation

Buka **Source → Advanced source settings → Validation**. Validation memeriksa pesan masuk; Source Filter memilih pesan valid yang perlu diproses; Transformation mengubah pesan untuk destination. Contoh: validation mewajibkan `patient_id`, filter memilih `department = LAB`, lalu mapping mengubah `patient_id` menjadi `PatientID`. Field required pada mapping tidak otomatis menjadi aturan input.

| Mode | Perilaku |
| --- | --- |
| No additional validation | Parsing/pengamanan format, authentication dan batas ukuran tetap berjalan; tidak ada aturan field tambahan. |
| Field validation | Khusus JSON; tentukan Field, Type dan Required. Semua aturan harus lulus sebelum filter/transformation. |
| Custom validation schema | Masukkan schema/rules sesuai bahasa yang dijelaskan editor; Save/Test memeriksanya di backend. |
| Keep legacy validation | Hanya untuk konfigurasi lama yang mempunyai Basic syntax atau JSON-object check; perilaku aslinya dipertahankan. |

Basic lama `{ "basicSyntax": true }` memeriksa serializability/batas JSON, bukan field wajib. XML/HL7 sudah diperiksa parsing minimumnya tanpa mode tersebut. Basic lama `{ "jsonSchema": { "type": "object" } }` juga mewajibkan object JSON; array/scalar ditolak oleh aturan bentuk object, bukan karena sintaks JSON salah. Membuka/menyimpan channel lama tidak mengonversinya. Memilih mode baru adalah perubahan eksplisit.

**Field validation**

Pilih Field validation, isi baris pertama, lalu **Add validation rule** bila perlu. Placeholder abu-abu bukan aturan. Required berarti wajib diisi: missing, null, string kosong dan hanya spasi gagal; angka `0` serta boolean `false` tetap valid sesuai tipe. Optional yang missing dilewati, tetapi null/tipe salah tetap gagal. Validation tidak mengonversi `"123"` menjadi angka atau `"false"` menjadi boolean.

| Field contoh | Type | Required | More rules |
| --- | --- | --- | --- |
| patient_id | Text | Yes | — |
| name | Text | Yes | — |
| gender | Text | No | Allowed values, satu per baris: M / F / U |
| date_of_birth | Date (YYYY-MM-DD) | No | — |

Ini contoh channel, bukan field wajib global. Gunakan nama field dari input aktual. Text/Number/Boolean memeriksa tipe JSON asli. Date memeriksa kalender, termasuk leap year: `2000-01-01` valid, `2025-02-30` gagal. More rules menyediakan allowed text values, minimum/maximum text length, serta minimum/maximum number. Allowed values case-sensitive dan tidak memangkas nilai payload. Length mengikuti panjang string JavaScript (UTF-16). Field tambahan tetap diperbolehkan.

Path `patient_id` berbeda dari `patient.id`. Path bertingkat menggunakan titik; array memakai index mulai 0, misalnya `patients.0.id` atau `0.id` pada root array. Tidak ada wildcard/bracket syntax atau akses prototype. Maksimum 50 aturan unik, path 256 karakter/12 bagian; allowed values maksimum 50 nilai nonkosong, masing-masing 300 karakter. Nilai berisi spasi dipertahankan persis; baris kosong pada editor berarti tidak menambah nilai. Satu allowed value tidak boleh berisi CR/LF karena setiap baris mewakili satu nilai. Semua aturan aktif harus lulus; ini bukan AND/OR routing. JSON literal/scalar tetap JSON valid, tetapi tidak menyediakan struktur object/array yang dibutuhkan mode field rules.

Input sintetis yang valid untuk contoh tersebut:

```json
{"patient_id":"RM-000123","name":"Pasien Uji","gender":"F","date_of_birth":"2000-01-01"}
```

Input sintetis invalid karena `patient_id` hilang dan tanggal tidak mungkin:

```json
{"name":"Pasien Uji","gender":"F","date_of_birth":"2025-02-30"}
```

**Custom examples**

Editor menjelaskan bahasa aktif. Buka **Example configuration**, tinjau contoh, lalu klik **Use example**. Konfirmasi diperlukan sebelum menimpa konfigurasi nonkosong. Contoh tidak otomatis dijalankan atau disimpan. JSON-only legacy profile ditampilkan sebagai schema langsung, tetapi wrapper internalnya tetap utuh saat Save tanpa perubahan. Profile mixed/script lama tetap memakai full profile editor agar tidak kehilangan aturan.

Untuk JSON, editor menerima JSON Schema langsung, bukan wrapper internal:

```json
{"type":"object","properties":{"patient_id":{"type":"string","minLength":1}},"required":["patient_id"],"additionalProperties":true}
```

JSON Schema memakai AJV strict dengan batas 16 KiB. Keyword mahal/referensi seperti `pattern`, `patternProperties`, `format`, `$ref`, `$async` dan `uniqueItems` tidak didukung. Jangan memakai `format: date`; gunakan tipe Date pada Field validation. Schema `{}` valid tetapi tidak membatasi field; UI menjelaskannya dan tidak memberi badge Configured hanya karena radio dipilih. Semantik `required` JSON Schema legacy tidak diubah menjadi semantik Required builder yang lebih ketat terhadap null/spasi.

Untuk XML, editor menerima bounded XML rules, **bukan XSD/XPath**:

```json
{"root":"Order","requiredPaths":["Order.ID"],"values":[{"path":"Order.Status","allowed":["NEW","UPDATED"]}]}
```

Parser mempertahankan root dan repeated elements sebagai array internal. Path rules menyertakan root dan menelusuri repeated elements tanpa index; requiredPaths membutuhkan setidaknya satu nilai teks nonkosong. Allowed-value rule memeriksa seluruh elemen yang cocok. Namespace prefix adalah nama literal (misalnya `ns:Order.ns:ID`), tidak ada namespace expansion, attribute selector atau arbitrary XPath. Entity/DOCTYPE ditolak; depth/node/size tetap dibatasi.

Untuk HL7, editor menerima profil terbatas, bukan implementasi penuh standard profile:

```json
{"messageTypes":["ADT^A01"],"versions":["2.5"],"requiredFields":["MSH.10","PID.3"]}
```

Message type memakai nilai field MSH-9 lengkap; version memakai MSH-12. Required field memakai `SEGMENT.number` dan memeriksa minimal satu segmen dengan isi field tersebut. Component/subcomponent/index pada profil validation ini belum tersedia; source filter/mapping mempunyai konteks parser tersendiri. Profil tiap rumah sakit dapat berbeda. Field validation builder tidak tersedia untuk XML/HL7/TEXT; TEXT dapat mempertahankan custom sandbox profile yang didukung dan diuji, tanpa mengklaim JSON field validation.

**Save, mode switching, dan melihat kegagalan**

Konfigurasi baru menyimpan envelope versi 1 pada `validationProfile` existing: mode aktif, fieldRules, custom profile dan legacy profile bila ada. Saat mode diganti, aturan lengkap yang tidak aktif tetap tersimpan tetapi tidak dievaluasi. Input custom JSON yang belum valid hanya tersimpan lokal selama form dibuka; aturan valid sebelumnya dipertahankan saat menyimpan mode lain. Baris field yang belum lengkap menghalangi Continue/Save/Test bila mode FIELDS aktif. Badge/ringkasan menunjukkan aturan aktif yang lengkap; custom baru diperiksa server saat Save/Test. Tidak ada migrasi schema database atau reset channel.

Pengujian tetap di **Review & Test** melalui Test Transformation. Hasil menampilkan setiap rule Passed/Failed/Skipped tanpa nilai payload. Bila input gagal: Validation Failed, Source Filter/Transformation Not run, Network delivery NOT SENT. Preview selalu mengikuti redaction; label synthetic tidak membebaskan permission/audit raw access.

Pada inbound aktual, kegagalan field menghasilkan HTTP 422 `FIELD_VALIDATION_FAILED`, details berisi field/tipe/alasan yang aman, dan message **IN-ERROR**. Tidak dibuat outbound job, destination attempt atau delivery retry. Buka **Messages → pilih pesan → Input validation failed** untuk alasan yang ditangkap saat pemrosesan; tidak dihitung ulang menggunakan konfigurasi terbaru. Konfigurasi salah menghasilkan 400 `INVALID_FIELD_RULES` / `INVALID_VALIDATION_PROFILE` / `VALIDATION_FORMAT_UNSUPPORTED`; internal error tetap 500 melalui kontrak aman. JSON malformed dapat ditolak 400 sebelum row Messages dibuat. FILTERED tetap keputusan filter, bukan error validation.

MLLP mempertahankan routing filter sebelum pemilihan channel (perilaku existing). Sesudah channel dipilih, validation berjalan sebelum transformation/delivery; penolakan validation menghasilkan ACK AE dengan control ID yang sesuai. No-match/ambiguous routing tetap AR. Dry-run tidak melakukan routing listener global; uji listener diperlukan untuk penerimaan rumah sakit.

Envelope baru memerlukan binary yang memahami versi tersebut. Sebelum downgrade ke binary lama, publish konfigurasi legacy yang kompatibel dan tinjau seluruh channel/revision yang akan dijalankan. Binary lama dapat mengabaikan envelope baru; jangan menganggap downgrade langsung tetap menegakkan aturan baru. Tidak ada penghapusan data/revision/audit saat rollback.

Screenshot sintetis: [sebelum](screenshots/validation/before-basic.png), [Field validation](screenshots/validation/after-fields.png), [Custom example](screenshots/validation/after-custom.png). Screenshot membuktikan tampilan; keputusan runtime dibuktikan oleh automated integration tests.

### Filter tanpa script

**Source Filter** hanya memiliki checkbox **Enable source filter** dan builder **Simple condition** (Field / Operator / Value). Channel baru default OFF. Saat OFF, pesan melewati source filtering; validation tetap berjalan. Saat ON, kondisi diperiksa terhadap setiap pesan sebelum transformation dan destination. Tidak ada dropdown accept/reject/custom atau editor script untuk source. Destination filter tetap menyediakan pilihan routing dan script yang sudah ada.

Field adalah path pada payload aktual, bukan metadata yang dibuat otomatis: JSON `patient.id`; XML `Patient.ID`; HL7 `MSH.9` (nilai message type lengkap, misalnya `ADT^A01`) atau `MSH.10` (control ID). `message_type` hanya berlaku jika pengirim benar-benar mengirim properti JSON tersebut. Dot path mendukung index array mulai 0; maksimum 12 bagian/256 karakter, Value 1.024 karakter; prototype keys ditolak. Konten harus terstruktur JSON/XML/HL7; teks bebas tidak mendukung pemilihan field dan menghasilkan error filter.

Operator: Equals, Not equals, Contains, Is empty, Is not empty, Starts with, Exists, Does not exist, dan pembanding numerik. Perbandingan case-sensitive; scalar angka/boolean dibandingkan sebagai string (`0`, `false`). Field hilang/null/objek/array tidak cocok dengan pembanding biasa, termasuk Not equals. Is empty menerima field hilang, null atau string kosong; Is not empty menerima scalar selain null/string kosong. Spasi tidak di-trim pada nilai pesan. Exists memeriksa keberadaan, termasuk null/kosong. Operator tanpa nilai menyembunyikan input Value; pembanding numerik menolak angka tidak finite, boolean dan string kosong. Satu kondisi per source sesuai model existing; gabungan AND/OR tidak ditambahkan.

Builder menyimpan metadata versi 1 dan script canonical pada `filterScript` existing. Nama field/nilai adalah data, bukan ekspresi JavaScript. Evaluasi tetap memakai QuickJS terisolasi dengan batas waktu, memory, concurrency dan payload; tidak ada evaluator arbitrary baru. JSON, HL7 dan XML menggunakan normalisasi existing. Compiler mempertahankan byte canonical operator lama agar filter XML/HL7 tersimpan tetap dikenali.

Saat dimatikan, aturan valid terakhir disimpan persis dalam wrapper `MIRTH_SOURCE_FILTER_DISABLED_V1` di kolom `filter_script`, bukan dibuang. Wrapper memiliki body no-op `return true;` untuk kompatibilitas runtime sebelumnya dan diperiksa integritasnya oleh runtime baru. Setelah Save/reopen, checkbox tetap OFF dan aturan dapat dipakai kembali. Wrapper maksimum 65.536 karakter; aturan besar yang tidak muat ditolak dengan pesan jelas, bukan dipotong. Input lokal yang belum valid tidak menjadi konfigurasi tersimpan; Save/Test/perpindahan langkah diblokir ketika filter ON. OFF dapat menyimpan aturan valid terakhir; saat diaktifkan kembali pada form yang sama, input lokal yang belum selesai tetap harus diperbaiki.

Filter legacy (literal boolean, accept/reject atau custom script) tetap aktif dengan perilaku aslinya dan notice **Legacy source filter retained**. Tidak dimigrasikan/reset otomatis. User dapat mematikannya atau memilih **Replace with simple condition**, lalu wajib melengkapi kondisi sebelum Save. Editor source script tidak ditampilkan. Legacy script tetap menggunakan sandbox existing. API tetap menerima legacy script untuk compatibility; UI sederhana hanya membuat kondisi canonical.

Kondisi tidak cocok menghasilkan status inbound **FILTERED**, tanpa transformation atau outbound reservation/delivery. Konfigurasi reserved metadata rusak ditolak API; bila ditemukan saat runtime, status **IN-ERROR** dengan kode `FILTER_CONFIG_INVALID`, tanpa delivery. Input yang tidak bisa dibaca kondisi canonical menghasilkan `FILTER_INPUT_INVALID`; tidak fallback accept-all. Error tracking/log hanya memuat kode aman/ID, bukan payload atau nilai kondisi. Dry-run di Review mengikuti pipeline yang sama tanpa network delivery. Publish/rollback, snapshot pesan, RBAC dan audit tetap berlaku; Save channel existing tetap membuat draft. Sebelum downgrade binary, pilih konfigurasi published yang kompatibel: operator Is empty/Is not empty baru belum dikenali sebagai visual canonical oleh runtime lama (khususnya normalisasi XML). Wrapper OFF sendiri tetap no-op pada runtime sebelumnya.

## 2. Transformation

Transformation hanya menampilkan mapping **Source Field / Target Field**, tombol **Add Mapping** dan bagian opsional **Advanced Custom Transformation Script**. Helper: “Map incoming fields to the fields required by the destination.” Source menentukan inbound format; outbound format dipilih pada masing-masing destination. Tidak ada format selector, sample, example, preview, Test, privacy checkbox atau banner hasil pengujian pada langkah ini.

Contoh mapping yang dapat ditambahkan sendiri:

| Source field | Target field |
| --- | --- |
| patient_id | PatientID |
| name | PatientName |
| gender | Gender |
| date_of_birth | BirthDate |

**Mapping options** per baris awalnya tertutup dan mempertahankan Required serta default value. `Required` menolak nilai wajib yang hilang. Default digunakan ketika nilai tidak ada, null atau kosong; `0` dan `false` dipertahankan. Default UI berupa string. Field yang tidak dipetakan tidak ikut output. Tanpa mapping/script, field asli diteruskan ke converter.

Tidak ada input XML root pada UI. Metadata `rootElement` dari mapping existing tetap utuh saat baris diedit. Mapping baru tidak menambahkan wrapper `Patient` otomatis; wrapper khusus per destination dapat dibuat melalui Advanced destination transformer. Pipeline dan converter tidak diubah.

Dot paths membaca object bertingkat dan indeks array pada input; target bertingkat dibuat sebagai object. Maksimum 100 baris dan 12 tingkat; target duplikat/tumpang tindih serta prototype keys ditolak. Mapping tidak melakukan array expansion atau konversi tipe otomatis. HL7 menggunakan struktur parser existing, misalnya `PID.3` untuk identifier scalar dan `PID.5.2` untuk component yang tersedia. Profile/repetition berbeda tetap memerlukan path yang sesuai.

Mapping visual disimpan pada **source transformer yang sama**, yaitu `processingScript`, dan dijalankan QuickJS existing. Source transformer pada Advanced dan halaman Transformation adalah dua tampilan dari stage tersebut. Keduanya tidak menciptakan dua transformasi berurutan. Script custom tidak diganti menjadi mapping tanpa konfirmasi eksplisit. Export/import channel XML tetap membawa script beserta metadata mapping/filter.

XML untuk mapping dan simple filter dinormalisasi sebelum masuk worker; script custom lama tetap menerima input aslinya. DTD/entity ditolak, parser dibatasi 20.000 nodes/kedalaman 65, serta tunduk pada batas payload dan sandbox. Error tidak mengembalikan plaintext pasien atau stack internal. Mapping yang belum lengkap menghalangi Continue/Save dan tetap tersedia ketika kembali ke langkah tersebut.

## 3. Destinations

Default satu destination; **Add Destination** tetap tersedia untuk routing ke banyak sistem. Field utama: nama, connector, outbound format dan endpoint. Setiap destination memiliki outbound format sendiri; perubahan format satu destination tidak diterapkan otomatis pada destination lain. Tidak ada selector output format global pada Transformation.

Advanced berisi tepat tiga kelompok: **Destination filter**, **Destination transformer**, **Delivery settings**. Template berada di disclosure lanjutan pada transformer. Automatic retry menampilkan jumlah retry dan interval ketika aktif; request timeout menggunakan detik. Capacity dan circuit protection tetap berada pada disclosure tambahan. Destination response editor dihapus; responseScript existing tetap aktif dengan notice legacy kecil. Connection test tersedia sesudah konfigurasi lengkap melalui Review & Test.

## 4. Review & Test

Review & Test menggabungkan ringkasan **Source**, **Source processing**, **Transformation**, **Destination**, **Delivery** dan flow **HTTP / JSON → 4 field mappings → REST / XML** untuk contoh empat mapping. Setiap destination memiliki cabang connector/format/nama sendiri; flow tidak memakai output format global. Status validation/filter/transformer berasal dari konfigurasi. Mapping dilabeli sebagai konfigurasi pada Transformation untuk menjelaskan stage engine yang sama. Setiap destination menampilkan format, endpoint, retry efektif dan timeout.

Seluruh pengujian berada di sini: **Test input**, **Test Transformation** dan generated output. Error pengujian muncul pada tahap ini dengan pesan aman dan tindakan yang relevan; tidak menampilkan SQL, stack trace atau payload sensitif dalam error. Perubahan konfigurasi atau kondisi yang belum valid membatalkan hasil lama. Mapping yang belum lengkap tetap menggunakan validasi inline pada langkah Transformation.

**Test Transformation** menggunakan payload sintetis dan `POST /api/channel/preview-transformation`. UI mengarahkan pengguna melengkapi konfigurasi sebelum pengujian. API preview tetap menerima konfigurasi destination yang belum lengkap demi compatibility, dan menjalankan validation, source filter/transformer, destination filter/transformer/template serta converter existing tanpa memeriksa koneksi. Tidak ada DNS lookup, network delivery atau probe.

Hasil menampilkan Validation, Source filter, Source transformation, format/output destination dan **Network delivery: NOT SENT**. Processing details menyediakan payload tiap tahap dan warning. Preview default redacted. **Advanced test options** menyimpan pilihan **Show unmasked preview (access is audited)** untuk ADMIN; raw tetap opsional, memerlukan permission dan audit. XML/text dapat tersembunyi penuh sesuai privacy settings.

**Test connection** pada Review & Test merupakan aksi terpisah setelah konfigurasi destination lengkap. Tindakan ini melakukan DNS dan handshake TCP/TLS tanpa payload aplikasi. Hasil koneksi tidak membuktikan destination menerima pesan.

| Tindakan | Lokasi / efek |
| --- | --- |
| Test transformation | Review & Test; pipeline tanpa DNS/pengiriman |
| API `/api/channel/dry-run` | Pipeline tanpa pengiriman, dengan pemeriksaan konfigurasi koneksi lengkap |
| Test connection | Review & Test; DNS dan handshake TCP/TLS, tanpa payload aplikasi |
| Send synthetic message | Setelah Save, channel Running dan konfirmasi; pengiriman aktual |

Save Channel menyimpan konfigurasi. Navigasi Back tetap tersedia; Test tidak menjalankan pengiriman sungguhan. Pengiriman sintetis setelah Save tetap memerlukan konfirmasi karena benar-benar dapat mencapai destination.

Create/edit tidak meminta change summary. Backend menghasilkan summary dan audit area `SOURCE_UPDATED`, `TRANSFORMATION_UPDATED`, `DESTINATION_UPDATED` atau `CHANNEL_UPDATED` sesuai perubahan. Audit ini menyatakan perubahan draft, bukan bahwa konfigurasi sudah aktif. Save existing channel membuat draft; publish/rollback melalui Revisions menentukan perubahan running dan memiliki audit tersendiri. Pesan existing tetap menggunakan configuration snapshot yang diterima sebelumnya.

### Revision, publish, rollback dan lifecycle channel — 17 October 2026

Sesudah Save pada channel existing, klik **Review and publish draft** pada notifikasi. Alternatif: **Channels → ⋯ → Revisions**. Pilih **Version** untuk melihat ringkasan satu revision. Draft terbaru dipilih otomatis; bila tidak ada draft, revision aktif ditampilkan. Badge membedakan Active, Draft, Previous version dan Archived.

Ringkasan source, transformation, destination, retry dan timeout otomatis muncul di area berukuran tetap tanpa memindahkan scroll/fokus. Respons lama yang terlambat tidak boleh menggantikan versi yang baru dipilih. Loading dan error berada di area yang sama; gunakan **Retry review** bila gagal. Tombol utama hanya **Edit draft**, **Publish** atau **Rollback** sesuai versi dan permission, serta **Done**.

Buka **Advanced options** untuk catatan opsional, **Configuration details (sanitized)**, **Compare versions**, **Test with synthetic data** dan **Destination connection tests**. Preview raw tetap memerlukan permission dan audit. Endpoint/credential dan script mengikuti sanitasi backend. Memilih versi hanya mengambil konfigurasi tersanitasi; pengujian script atau koneksi berjalan setelah tombol test diklik.

Jika ada pending draft, tombol **Review draft N** juga tersedia langsung di baris channel. Edit channel membuka konfigurasi aktif, sehingga UI meminta konfirmasi sebelum memulai edit yang nantinya akan menggantikan pending draft. Batalkan dan pilih Review draft untuk memeriksa perubahan yang sudah disimpan; edit draft di panel tetap mempertahankan script/credential server dan menyediakan subset field operasional yang aman.

Publish draft memerlukan konfirmasi dan berlaku untuk pesan baru. Save berikutnya membuat draft terbaru dan menandai draft sebelumnya superseded/archived; konfigurasi aktif tetap utuh sampai publish. Pada database lama dengan beberapa draft, hanya draft paling baru yang boleh dipublish. Refresh revisions mengambil revision aktif terbaru; jika pengguna lain sudah publish, request lama ditolak 409 sehingga konfigurasi tidak tertimpa diam-diam.

Rollback tersedia untuk revision PUBLISHED sebelumnya, bukan revision yang sedang aktif atau draft yang telah diarsipkan. Konfirmasi rollback membuat revision PUBLISHED baru dari konfigurasi lama, tidak menghapus history, tidak mengembalikan source API key lama dan tidak mengganti snapshot pekerjaan yang sudah diterima. Pending draft diarsipkan saat aktivasi. Snapshot published merekam ID destination yang benar agar rollback bolak-balik tidak membuat connector baru berulang.

ADMIN dapat Delete channel STOPPED tanpa riwayat pesan yang masih disimpan, termasuk duplikat baru dengan Revision 1. Revision/configuration milik channel tersebut ikut dihapus secara transaksional; channel asal dan audit tidak dihapus. Jika ada pesan, gunakan **⋯ → Archive channel** setelah Stop dan menyelesaikan antrean/retry/proses aktif. Archive tidak menghapus pesan, revision atau audit. Pilih filter status **Archived** untuk melihatnya; channel archive tidak bisa langsung Start/edit/publish. Buat duplikat baru yang ditinjau jika membutuhkan pengganti. Pemeriksaan delete menggunakan evidence yang masih tersimpan, bukan penanda permanen pernah digunakan setelah retention resmi menghapus seluruh pesan. Jangan membersihkan evidence manual untuk memaksa Delete.

Tidak ada migration baru: archive memakai nilai `ARCHIVED` pada kolom status yang sudah ada. Schema tetap 1–7. Jalankan binary/API/frontend yang sesuai bersama-sama; perubahan lokal ini tidak otomatis memperbarui server deployment.

Binary sebelum perbaikan ini belum melindungi status ARCHIVED dari aktivasi. Jangan menjalankannya bersamaan atau downgrade tanpa review akses dan pengamanan channel yang telah diarsipkan. Untuk revision legacy tanpa ID destination, rollback memakai ulang connector dengan konfigurasi yang cocok di channel yang sama dan mencatat ID yang benar pada snapshot published baru, tanpa menulis ulang history lama.

## Messages, Overview dan Settings

Messages menampilkan **Inbound Message**, **Source Processed Message**, **Outbound Message**, dan **Delivery Result**. Summary menunjukkan format, status dan destination; Payload/History mempertahankan detail per tahap/attempt, pencarian, copy, Pretty/Raw dan HL7 Tree sesuai permission. Menutup drawer mempertahankan filter dan halaman.

HTTP status berasal dari transport aktual, termasuk 201/204/4xx/5xx. Timeout, koneksi gagal, MLLP dan record lama tidak ditebak sebagai HTTP 200. Durasi merupakan waktu request connector aktual dalam milidetik, terpisah dari antrean dan response script. `durationMs` dan `attemptCount` yang tidak tercatat ditampilkan **Not recorded**. Jumlah attempt dihitung dari riwayat delivery yang dapat dipastikan; admission wait/queue bukan network attempt. Riwayat legacy yang tidak cukup untuk menghitung jumlah pasti tetap unknown, bukan angka dari retryCount atau nomor halaman.

Redacted view adalah default. **View raw (audited)** memerlukan permission dan dicatat pada audit; copy mengikuti isi yang terlihat. Jika ADMIN kehilangan izin raw saat drawer terbuka, cached raw langsung disembunyikan dan versi redacted diminta ulang. Kehilangan izin payload menyembunyikan payload termasuk history/resend. Resend tetap memerlukan konfirmasi, permission backend serta pemeriksaan status/snapshot; delivery yang tidak pasti perlu rekonsiliasi operator.

Overview menampilkan enam angka dari database dan **Recent Failures**, tanpa chart dummy:

| Angka | Makna |
| --- | --- |
| Running Channels | Channel berstatus RUNNING |
| Stopped Channels | Channel berstatus STOPPED |
| Messages Today | Inbound sejak tengah malam lokal browser yang dikirim sebagai timestamp ke API |
| Successful | Inbound SUCCESS pada retained history |
| Failed | Inbound FAILED, PARTIAL atau IN-ERROR pada retained history |
| Retrying | Outbound QUEUED/RETRYING saat ini |

Successful/Failed tidak diklaim sebagai angka hari ini. Data yang belum tersedia ditampilkan sebagai `—`. Recent Failures menggunakan pesan inbound gagal/partial dan membuka Messages dengan filter terkait.

Settings memiliki **System information, Roles, Users, Audit log**; Users/Audit mengikuti permission ADMIN. Roles menjelaskan kemampuan RBAC aktual. System information menampilkan account, koneksi, versi runtime/encryption, TLS dan retention dengan label; raw JSON runtime tidak memenuhi halaman utama. Sessions, alerts dan diagnostic download tetap tersedia melalui Operational tools sesuai permission. Database credential dan nilai encryption key tidak ditampilkan.

## Database upgrade dan compatibility

Follow-up berbasis `1734591` yang memindahkan test ke Review tidak menambah migration atau mengubah data. Build terbaru tetap memerlukan migration **1–7**. Migration `006_delivery_http_status.sql` menambahkan nullable integer `MessageDestinationLog.http_status` (100–599). Migration `007_delivery_timing.sql` menambahkan nullable integer `request_duration_ms` (minimal 0). Record lama tetap NULL. Keduanya additive, transactional/repeatable dan tidak menghapus business data. Migrator, startup guard, disposable reset helpers, restore verification dan runtime smoke menggunakan versi 7.

Untuk upgrade environment existing, verifikasi target dan backup/keyring sesuai runbook sebelum menjalankan command:

```bash
npm run db:migrate -- --dry-run
npm run db:migrate
npm run build
npm run start
```

Production memerlukan konfirmasi backup `MIGRATION_BACKUP_CONFIRMED=true` sesuai runbook migrasi. Verifikasi `/health`, `/ready` dan synthetic channel yang berizin setelah restart. Startup tidak melakukan automatic migration; schema yang belum cukup menghasilkan `MIGRATION_REQUIRED` beserta instruksi migrasi.

Pada implementasi sebelumnya yang tercakup dalam `1734591`, migration additive 007 benar-benar diterapkan pada development `MiniMirthDev` setelah preflight. Schema terverifikasi 1–7; counts tetap 1 user, 1 channel, 1 destination, 2 messages dan 1 delivery log. Tidak ada reset atau perubahan production. Compiled development backend diuji pada loopback port sementara dengan `/health` dan `/ready` HTTP 200, tanpa mengirim payload; proses diakhiri melalui SIGTERM dengan exit 0. `.env` dan key existing tidak diubah.

Semua source/destination filter, transformer, response script, validation profile, idempotency mode, multiple destinations dan credential existing tetap dipertahankan pada data/API/runtime/import-export. Response editor yang disembunyikan tidak menghapus script legacy. Source HTTP response mempertahankan result envelope lama sambil menambahkan alias messageId/status.

Rollback source dapat mempertahankan kolom nullable baru. Jangan drop kolom, data atau migration history; pertahankan keyring dan backup. Binary lama belum menormalisasi XML untuk generated simple conditions/mapping versi baru: pilih revision channel yang kompatibel sebelum downgrade, kemudian verifikasi sintetis. Rollback revision channel tidak menghapus history. Untuk backup schema lama, restore ke target disposable, apply migration sampai 7 menggunakan keyring yang benar, lalu jalankan verifier terbaru. Native backup/restore drill untuk schema 7 belum dilakukan karena `pg_dump`/`pg_restore` tidak tersedia pada environment sesi ini.

## Validasi dan batas verifikasi

Follow-up mapping-only / Review & Test berbasis branch `development`, commit `1734591`. Verifikasi baru memakai fixture sintetis. Browser menggunakan API fixture untuk UX/permission dan tidak mengklaim pengiriman ke rumah sakit atau webhook eksternal.

| Command / pemeriksaan | Hasil follow-up terbaru |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run format:check` | PASS |
| `npm run test:coverage` | PASS — 28 suites, 345 tests |
| `npm run build` | PASS — client dan server |
| `npm run test:e2e` | PASS — 57 tests, termasuk mapping-only, Review & Test, compatibility, permissions, keyboard/mobile dan Axe accessibility |
| Capture ulang screenshot Review | PASS — 1 kasus khusus screenshot; bukan tambahan pada angka 57 suite penuh |
| `npm run docs:check` | PASS — 46 paths, 50 operations |
| `npm run secrets:scan` | PASS — findings kosong pada targeted-pattern scanner; bukan sertifikasi history/rotasi secret |
| Pemeriksaan tautan Markdown lokal | PASS — 56 tautan |
| `git diff --check` | PASS |

Coverage meningkat dari baseline `1734591`: statements **81.90 → 82.09%**, branches **78.61 → 78.80%**, functions **83.63 → 83.84%**, lines **82.96 → 83.12%**.

Regresi mencakup pemisahan format Source/destination, dua kolom mapping dengan opsi tertutup, field/metadata legacy yang dipertahankan, preview tanpa network, pengujian pada Review, error aman, raw permission yang diaudit, serta connection probe yang dipilih secara eksplisit. Run browser awal memerlukan penyesuaian selector accessible name dan asumsi flow lama; selector diperbaiki dan suite penuh terakhir lulus. Capture Review diulang dengan viewport lebih tinggi agar flow, input dan XML terlihat bersama.

Bukti runtime berikut tetap **historis dari `1734591`**, bukan run ulang untuk follow-up ini:

| Pemeriksaan sebelumnya | Bukti / batas |
| --- | --- |
| Native PostgreSQL integration | 19 tests PASS pada PostgreSQL 18.4 disposable; mencakup schema 1–7 berulang, routing/multi-destination, required rejection, HTTP status serta duration/attempt metadata |
| Fixture JSON → Patient XML | Input sintetis RM-000123 / Siti Aminah / F / 1993-08-17 dibandingkan dengan body HTTP aktual pada receiver loopback |
| Compiled runtime smoke | Startup, health/readiness, metrics authorization dan SIGTERM ketika delivery aktif PASS pada database terisolasi |
| Development migration 007 / rebuilt health | Preflight, additive migration, counts business data tetap dan health/readiness 200 diverifikasi sebelumnya; follow-up ini tidak mengubah database |

Runtime engine, converter dan schema tetap; perubahan backend follow-up terbatas pada panduan error preview yang aman. Tidak ada klaim fresh native SQL/runtime, `npm ci` atau dependency audit. Native backup/restore schema 7 belum diuji karena pg_dump/pg_restore tidak tersedia pada verifikasi sebelumnya. Docker, hospital UAT, load test dan disaster recovery qualification tidak dijalankan pada follow-up ini. Tidak ada klaim production-ready atau hospital acceptance; readiness matrix tetap berlaku untuk verifikasi eksternal.

## Screenshot UI final

Enam screenshot berikut diambil ulang dari browser test dengan data sintetis. Transformation menampilkan mapping-only; Review & Test memperlihatkan flow, test input dan generated output:

- [Source dan Advanced settings](screenshots/usability/lite-source.png)
- [Transformation](screenshots/usability/lite-transformation.png)
- [Destinations dan Advanced settings](screenshots/usability/lite-destinations.png)
- [Review & Test](screenshots/usability/lite-review.png)
- [Overview](screenshots/usability/lite-overview.png)
- [Settings](screenshots/usability/lite-settings.png)

Audit KEEP / REMOVE / ADVANCED / LEGACY dan before/after yang dibuat sebelum coding tersedia pada [UI simplification audit](UI_SIMPLIFICATION_AUDIT.md).
