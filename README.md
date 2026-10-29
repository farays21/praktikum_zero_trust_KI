# Praktikum Zero Trust Security - Academic Information System

Implementasi sistem keamanan Zero Trust untuk manajemen nilai akademik dengan arsitektur microservices.

## Fase 1: Database + Seed Data (SELESAI)

### Arsitektur Database

Database menggunakan SQLite dengan 9 tabel:
- `users` - Akun pengguna (admin, dosen, mahasiswa)
- `devices` - Perangkat terdaftar per pengguna
- `refresh_tokens` - Token refresh yang dapat dicabut
- `service_clients` - Kredensial service-to-service
- `kelas` - Data kelas/matakuliah
- `enrollments` - Relasi mahasiswa-kelas
- `nilai` - Data nilai (draft/final)
- `transkrip` - Transkrip mahasiswa (agregat)
- `audit_logs` - Log audit keputusan akses

### Instalasi dan Setup

1. **Install Dependencies**
```bash
npm install
```

2. **Setup Database (init + seed + verify)**
```bash
npm run db:setup
```

Atau jalankan step by step:
```bash
npm run db:init      # Inisialisasi schema
npm run db:seed      # Insert seed data
npm run db:verify    # Verifikasi hasil
```

### Akun Demo

**PENTING:** Gunakan device ID yang sesuai untuk setiap akun saat login.

#### Admin (1)
| Username | Password | Role | Device ID | Device Name |
|----------|----------|------|-----------|-------------|
| `admin1` | `Admin@123` | admin | `dev-admin-001` | Chrome Windows |

#### Dosen (2)
| Username | Password | Role | Device ID | Device Name |
|----------|----------|------|-----------|-------------|
| `dosen1` | `Dosen@123` | dosen | `dev-dosen-001` | Safari macOS |
| `dosen2` | `Dosen@456` | dosen | `dev-dosen-002` | Firefox Linux |

#### Mahasiswa (3)
| Username | Password | NIM | Role | Device ID | Device Name |
|----------|----------|-----|------|-----------|-------------|
| `mahasiswa1` | `Mhs@123` | `2024001` | mahasiswa | `dev-mhs-001` | Chrome Windows |
| `mahasiswa2` | `Mhs@456` | `2024002` | mahasiswa | `dev-mhs-002` | Safari iOS |
| `mahasiswa3` | `Mhs@789` | `2024003` | mahasiswa | `dev-mhs-003` | Firefox Android |

### Data Awal

#### Kelas (2)
- **PROG101** - Pemrograman Dasar (Dosen: dosen1, SKS: 3)
- **DB101** - Basis Data (Dosen: dosen2, SKS: 3)

#### Enrollments (4)
- mahasiswa1 → PROG101, DB101
- mahasiswa2 → PROG101
- mahasiswa3 → DB101

#### Nilai (4 - status draft)
- mahasiswa1: PROG101 (85), DB101 (90)
- mahasiswa2: PROG101 (78)
- mahasiswa3: DB101 (88)

#### Service Clients (2)
- `nilai-service` - Service Nilai (secret hashed)
- `transkrip-service` - Service Transkrip (secret hashed)

### Keamanan Database

✅ **Passwords**: Semua password di-hash dengan bcrypt (10 rounds)  
✅ **Service Secrets**: Service client secrets di-hash dengan bcrypt  
✅ **SQL Injection**: Semua query menggunakan parameterized statements  
✅ **Foreign Keys**: Enabled untuk referential integrity  
✅ **Indexes**: Dibuat untuk query performa  

### Catatan Penting

⚠️ **IPK Calculation**: IPK disimpan sebagai `NULL` karena aturan konversi nilai dan bobot IPK tidak ditentukan dalam spesifikasi tugas. Struktur data siap untuk perhitungan IPK di masa depan, tetapi implementasi Fase 1 tidak mengklaim hasil IPK sebagai nilai resmi kampus.

⚠️ **Device Verification**: Device ID harus cocok dengan database. Login akan gagal jika device tidak terdaftar untuk user tersebut.

⚠️ **Re-seeding**: Script seed aman dijalankan berulang kali. Jika database sudah berisi data, seed akan di-skip untuk menghindari duplikasi. Untuk re-seed, hapus file `database/zero-trust.db` terlebih dahulu.

### Struktur Folder

```
praktikum-zero-trust/
├── database/
│   └── zero-trust.db          # SQLite database (auto-created)
├── shared/
│   ├── config/
│   │   └── index.js           # Central configuration
│   └── db/
│       ├── connection.js      # Database connection helper
│       ├── schema.sql         # Database schema
│       ├── init.js            # Initialize schema
│       ├── seed.js            # Seed demo data
│       └── verify.js          # Verify seed results
├── .env                       # Environment variables (DO NOT COMMIT)
├── .env.example               # Environment template
├── .gitignore
├── package.json
└── README.md
```

### Environment Variables

Salin `.env.example` ke `.env` dan sesuaikan nilai secret untuk production:

```bash
cp .env.example .env
```

**JANGAN commit file `.env` yang berisi secret asli.**

### Troubleshooting

**Error: Missing required environment variable**
- Pastikan file `.env` ada dan berisi semua variable yang diperlukan
- Cek `.env.example` untuk referensi

**Database already contains data**
- Hapus file `database/zero-trust.db` untuk re-seed:
  ```bash
  rm database/zero-trust.db
  npm run db:setup
  ```

**Module not found**
- Jalankan `npm install` terlebih dahulu

## Fase 2: Authentication + API Gateway (SELESAI)

### API Gateway (Port 3000)

Gateway berfungsi sebagai Policy Enforcement Point (PEP) dan Policy Administrator dalam arsitektur Zero Trust.

**Jalankan Gateway:**
```bash
npm run gateway
```

### Authentication Endpoints

#### POST /auth/login
Login dengan username dan password.

**Request:**
```json
Headers:
  X-Device-ID: dev-mhs-001

Body:
  { "username": "mahasiswa1", "password": "Mhs@123" }
```

**Response:**
```json
{
  "accessToken": "jwt-token...",
  "user": { "username": "mahasiswa1", "role": "mahasiswa", "nim": "2024001" }
}
```

- Access token berlaku 10 menit (JWT_SECRET)
- Refresh token disimpan di httpOnly cookie, berlaku 1 hari
- Login gagal jika device tidak terdaftar untuk user

#### POST /auth/refresh
Refresh access token menggunakan refresh token cookie.

**Request:**
```json
Headers:
  X-Device-ID: dev-mhs-001
Cookie: refreshToken=...
```

**Response:**
```json
{ "accessToken": "new-jwt-token..." }
```

- Refresh token lama dicabut (revoked)
- Refresh token baru dikirim sebagai cookie (rotation)

#### POST /auth/logout
Logout dan cabut refresh token.

**Request:**
```json
Headers:
  X-Device-ID: dev-mhs-001
Cookie: refreshToken=...
```

**Response:**
```json
{ "message": "Logged out" }
```

#### POST /auth/service
Autentikasi service-to-service.

**Request:**
```json
{
  "clientId": "nilai-service",
  "clientSecret": "secret-from-env"
}
```

**Response:**
```json
{ "serviceToken": "jwt-service-token..." }
```

- Service token berlaku 5 menit (JWT_SERVICE_SECRET)
- Client secret diverifikasi dengan bcrypt hash di database

### Policy Engine

Policy Engine middleware tersedia di `gateway/middleware/policyEngine.js`:

- `requireAccessToken`: Verifikasi JWT access token pengguna
- `requireServiceToken`: Verifikasi JWT service token + X-Gateway-Secret
- `requireAllowedHours`: Time-based access control (07:00-21:00)

**Keamanan:**
- Access token menggunakan JWT_SECRET
- Service token menggunakan JWT_SERVICE_SECRET terpisah
- Service token tidak diterima sebagai access token pengguna
- Verifikasi signature, expiry, dan token type

### Audit Logging

Semua keputusan autentikasi dicatat di tabel `audit_logs`:
- ALLOW: Login berhasil, refresh berhasil, service auth berhasil
- DENY: Kredensial salah, device tidak terdaftar, token expired, dll

**Tidak dicatat:** Password, token mentah, atau client secret

### Testing

Jalankan tes autentikasi (pastikan gateway berjalan):
```bash
npm run gateway  # Terminal 1
npm run test:auth  # Terminal 2
```

**Test coverage:**
- ✅ Login berhasil dengan credentials dan device valid
- ✅ Login gagal dengan password salah
- ✅ Login gagal dengan device tidak terdaftar
- ✅ Login gagal tanpa header device
- ✅ Refresh token rotation
- ✅ Token lama revoked setelah rotation
- ✅ Logout mencabut refresh token
- ✅ Service authentication berhasil
- ✅ Service authentication gagal dengan secret salah
- ✅ Audit log mencatat ALLOW dan DENY tanpa credential leak

### Struktur Folder (Fase 2)

```
praktikum-zero-trust/
├── gateway/
│   ├── server.js                  # Express server (port 3000)
│   ├── routes/
│   │   └── auth.js                # Authentication endpoints
│   └── middleware/
│       └── policyEngine.js        # Policy Engine / PDP
├── tests/
│   └── auth.test.js               # Fase 2 tests
└── ...
```

### Token Details

**Access Token (10 menit):**
- Signed dengan JWT_SECRET
- Payload: `{ sub, role, type: "access" }`
- Digunakan untuk endpoint user (mahasiswa, dosen, admin)

**Refresh Token (1 hari):**
- Random 32 bytes hex
- Stored di database dengan binding user_id + device_id
- HttpOnly cookie (tidak accessible dari JS)
- Revocable dan rotasi setiap refresh

**Service Token (5 menit):**
- Signed dengan JWT_SERVICE_SECRET
- Payload: `{ sub, role: "service", type: "service", serviceName }`
- Digunakan untuk komunikasi service-to-service

---

## Fase 3: Service Nilai + Service Transkrip (SELESAI)

Implementasi lengkap microservices dengan orkestrasi service-to-service untuk finalisasi nilai dan sinkronisasi transkrip.

**Detail lengkap**: Lihat `FASE3-SUMMARY.md`

**Key Features:**
- ✅ Service Nilai (Port 3001) - CRUD nilai & finalisasi kelas
- ✅ Service Transkrip (Port 3002) - Transkrip & sinkronisasi
- ✅ Service-to-service authentication dengan service token
- ✅ Rollback otomatis jika sinkronisasi transkrip gagal
- ✅ Policy enforcement: device verification, time constraints, ownership, RBAC
- ✅ 23/23 integration tests passed

---

## Fase 4: Frontend React + Vite (SELESAI)

Frontend web application dengan antarmuka berbahasa Indonesia yang berkomunikasi dengan API Gateway.

### Fitur Frontend

#### Dashboard Mahasiswa
- ✅ Melihat nilai sendiri (GET /nilai)
- ✅ Melihat transkrip sendiri (GET /transkrip/:nim)
- ✅ Tampilan tabel responsif dengan status nilai (draft/final)
- ✅ Ringkasan transkrip: NIM, Total SKS, IPK

#### Dashboard Dosen
- ✅ Melihat nilai dari kelas yang diajarnya
- ✅ Mengubah nilai (hanya draft, time constraint 07:00-21:00)
- ✅ Finalisasi kelas dengan konfirmasi dialog
- ✅ Tampilan per kelas dengan status finalisasi
- ✅ Validasi nilai: A, AB, B, BC, C, D, E

#### Dashboard Admin
- ✅ Cari transkrip mahasiswa berdasarkan NIM
- ✅ Dapat melihat transkrip semua mahasiswa
- ✅ Tampilan detail nilai per mahasiswa

### Arsitektur Frontend

**Stack:**
- React 19.3.1
- Vite 8.3.5 (dev server port 5173)
- Vanilla CSS (responsive, modern UI)

**State Management:**
- AuthContext untuk autentikasi
- Access token di memory (tidak di localStorage)
- Refresh token di HttpOnly cookie (dikelola browser)

**Keamanan:**
- ✅ Semua request ke Gateway port 3000 (tidak langsung ke 3001/3002)
- ✅ CORS dikonfigurasi di Gateway: origin http://localhost:5173, credentials: true
- ✅ X-Device-ID header dikirim pada semua request user
- ✅ Authorization: Bearer header untuk access token
- ✅ credentials: "include" untuk HttpOnly cookie
- ✅ Tidak ada credential disimpan di localStorage/sessionStorage
- ✅ Tidak ada token/password di console log

**Struktur Folder:**
```
frontend/
├── src/
│   ├── contexts/
│   │   └── AuthContext.jsx       # Auth state management
│   ├── services/
│   │   └── api.js                # API client ke Gateway
│   ├── pages/
│   │   ├── Login.jsx             # Halaman login
│   │   ├── Login.css
│   │   ├── DashboardMahasiswa.jsx
│   │   ├── DashboardMahasiswa.css
│   │   ├── DashboardDosen.jsx
│   │   ├── DashboardDosen.css
│   │   ├── DashboardAdmin.jsx
│   │   └── DashboardAdmin.css
│   ├── App.jsx                   # Main routing
│   ├── App.css
│   ├── main.jsx
│   └── index.css
├── .env                          # VITE_API_BASE_URL
├── .env.example
├── package.json
└── vite.config.js
```

### Setup dan Menjalankan Frontend

#### 1. Install Dependencies Frontend
```powershell
cd frontend
npm install
```

#### 2. Konfigurasi Environment
File `.env` sudah dibuat dengan:
```
VITE_API_BASE_URL=http://localhost:3000
```

#### 3. Development Mode
```powershell
# Terminal 1: API Gateway
npm run gateway

# Terminal 2: Service Nilai
npm run service:nilai

# Terminal 3: Service Transkrip
npm run service:transkrip

# Terminal 4: Frontend Dev Server
cd frontend
npm run dev
```

Frontend akan berjalan di: **http://localhost:5173**

#### 4. Production Build
```powershell
cd frontend
npm run build
npm run preview  # Preview production build
```

### Testing Frontend

**Login dengan akun demo:**
1. Buka http://localhost:5173
2. Klik tombol "Mahasiswa", "Dosen", atau "Admin" untuk auto-fill credentials
3. Klik Login

**Test Mahasiswa:**
- Login: mahasiswa1 / Mhs@123 / dev-mhs-001
- Lihat nilai dan transkrip sendiri

**Test Dosen:**
- Login: dosen1 / Dosen@123 / dev-dosen-001
- Lihat nilai kelas PROG101
- Ubah nilai draft (hanya jam 07:00-21:00)
- Finalisasi kelas (akan sync ke transkrip)

**Test Admin:**
- Login: admin1 / Admin@123 / dev-admin-001
- Cari transkrip dengan NIM: 2024001, 2024002, atau 2024003

### Catatan Penting Frontend

⚠️ **Device ID**: Wajib sesuai dengan database. Frontend mengirim X-Device-ID header pada setiap request.

⚠️ **Time Constraint**: Perubahan nilai dan finalisasi hanya bisa dilakukan jam 07:00-21:00. Di luar jam tersebut, backend akan reject dengan 403.

⚠️ **Refresh Token**: Disimpan di HttpOnly cookie, tidak bisa diakses JavaScript. Frontend hanya menyimpan Device ID di localStorage.

⚠️ **CORS**: Gateway dikonfigurasi untuk accept request dari http://localhost:5173 dengan credentials.

⚠️ **Browser DevTools**: Jangan manipulasi request dari DevTools untuk bypass policy. Backend tetap enforce semua aturan keamanan.

---

## Status Keseluruhan

**Status Fase 1**: ✅ SELESAI (Database + Seed Data)  
**Status Fase 2**: ✅ SELESAI (Authentication + API Gateway)  
**Status Fase 3**: ✅ SELESAI (Service Nilai + Service Transkrip)  
**Status Fase 4**: ✅ SELESAI (Frontend React + Vite)

**Total Tests Passed**: 10/10 auth tests + 21/23 service tests

**Last Updated**: 2026-10-22
