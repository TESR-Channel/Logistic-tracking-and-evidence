# TESR Logistics — Fulfillment QC & Evidence Record

เว็บแอปบันทึกการตรวจสินค้า (QC) ของบริการ Fulfillment — TESR Logistics
สแกน **เลข Tracking ที่ลูกค้าส่งมา** (เลขหลักของ record) ด้วยบาร์โค้ด → ติ๊ก QC Checklist → ถ่ายรูป/วิดีโอหลักฐาน → เซ็นยืนยัน → บันทึกลง Google Drive (1 Record = 1 โฟลเดอร์)

**Live:** https://tesr-channel.github.io/Logistic-tracking-and-evidence/

## โครงสร้างใน Google Drive

```
Logistic-tracking-and-evidence/            ← root (17wFTaIpnOWenaLl3YrI-qTqqUTU7bKY9)
├── <Client>/                              ← ถ้าระบุลูกค้า (แชร์ลิงก์โฟลเดอร์นี้ให้ลูกค้ารายนั้นได้)
│   └── WB550882001TH_ปุระชัย เมฆสุข_06-11-2026/
│       ├── 00_QC_Summary_WB550882001TH.png       ← ใบสรุป QC (โลโก้ TESR, ผล PASS/FAIL, checklist, ลายเซ็น)
│       ├── 01_Signature_ปุระชัย เมฆสุข.png
│       ├── 02 สินค้า - photo_….jpg
│       ├── 03 วิดีโอ QC - video_….mp4
│       └── QC_Record_WB550882001TH.txt
└── TH0112233445566_สุริยา ดีคง_06-11-2026/                  ← ไม่ระบุลูกค้า = อยู่ใต้ root
```

ทุก record ถูก log ลง Google Sheet **"TESR Logistics QC Log"** (สร้างอัตโนมัติใน My Drive ของบัญชีที่ Deploy — ไม่อยู่ในโฟลเดอร์ public) ใช้สำหรับหน้า Tracking / ค้นหา

## ไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` | ตัวแอปทั้งหมด (Login, QC form, Scanner, Tracking, Admin, Settings, Dark/Light) |
| `tesr-logistics-backend.gs` | Google Apps Script backend (Auth, Drive upload, Sheet log, Config) |
| `vendor/zxing-browser.min.js` | ตัวอ่านบาร์โค้ด (ใช้เมื่อเบราว์เซอร์ไม่มี BarcodeDetector เช่น iPhone/iPad) |
| `tesr-logo.png`, `icon-*.png`, `manifest.json` | โลโก้ TESR + ไอคอน Add to Home Screen |

## ติดตั้ง Backend (ครั้งเดียว ~5 นาที — ทำด้วยบัญชี ceo.anoney.potter@gmail.com เจ้าของโฟลเดอร์)

1. เปิด https://script.google.com → **New project** → ตั้งชื่อ `TESR Logistics QC backend`
2. ลบโค้ดเดิม → วางโค้ดทั้งไฟล์ `tesr-logistics-backend.gs` → **Save**
3. ใส่เบอร์โทร admin ในบรรทัด `const SETUP_ADMIN_PHONE = '';` (เฉพาะใน Apps Script — **ห้าม commit ลง GitHub**)
4. เลือกฟังก์ชัน **`setup`** → **Run** → Review permissions → Allow
   (ระบบเก็บเป็น hash แล้ว → ลบเบอร์ออกจากบรรทัดนั้น แล้ว Save)
5. **Deploy → New deployment** → ⚙ Web app
   - Execute as: **Me**
   - Who has access: **Anyone**
   → Deploy → คัดลอก **Web app URL** (`https://script.google.com/macros/s/…/exec`)
6. ใส่ URL ใน `index.html` ที่ `const DEFAULT_ENDPOINT = '…';` แล้ว push (หรือกรอกที่หน้า Login → "การเชื่อมต่อระบบ")
7. พนักงานใช้ได้ทันที — ระบบอ่านรายชื่อจาก **Work tracking log → Employees** (email + phone, active = TRUE) · ถ้าจะใช้บัญชี `tesrshop@gmail.com` ด้วย ให้ Admin ตั้งเบอร์ในเมนู **Admin**

> อัปเดตโค้ด backend ครั้งต่อไป: Deploy → Manage deployments → ✎ → Version: **New version** → Deploy (URL เดิม)

## เปิด "Sign in with Google" (ไม่บังคับ)

1. https://console.cloud.google.com → สร้าง/เลือกโปรเจกต์ → **APIs & Services → OAuth consent screen** → External → กรอกชื่อแอป `TESR Logistics QC` → เพิ่ม Test users: `tesrshop@gmail.com`, `ceo.anoney.potter@gmail.com` (หรือกด Publish app)
2. **Credentials → Create credentials → OAuth client ID** → Web application
   - Authorized JavaScript origins: `https://tesr-channel.github.io`
3. คัดลอก Client ID (`….apps.googleusercontent.com`) → แอปเมนู **Admin → Google Sign-In Client ID** → บันทึก
4. หน้า Login จะมีปุ่ม Sign in with Google — อนุญาตเฉพาะอีเมลที่อยู่ในรายชื่อ Admin / Staff

## สิทธิ์ผู้ใช้

| บัญชี | สิทธิ์ |
|---|---|
| `ceo.anoney.potter@gmail.com` | Admin — ตั้งพนักงาน, ลูกค้า, Checklist, รูปแบบเลข Tag, รหัสผ่าน, ออกจากระบบทุกเครื่อง |
| พนักงานใน Work tracking log (active) + `tesrshop@gmail.com` | Staff — บันทึก QC, ค้นหา/Tracking · ชื่อผู้แท็กเลือกให้อัตโนมัติตามคนที่ login |

- เข้าระบบด้วย **อีเมลพนักงาน + เบอร์โทร** (พิมพ์มีขีด/เว้นวรรค/+66 ก็ได้ ระบบตัดให้เหลือตัวเลข) — เก็บเป็น salted hash ใน Script Properties
- ใส่เบอร์ผิด 5 ครั้ง → ล็อก 15 นาที · Session อายุ 7 วัน · ลบอีเมลออกจากรายชื่อ = หมดสิทธิ์ทันที

## การสแกน

- **กล้อง**: มือถือ / iPad / โน้ตบุ๊ก / PC ที่มีกล้อง — 1D (Code128, EAN, Code39 ฯลฯ) และ QR · มีปุ่มไฟฉาย (ถ้ากล้องรองรับ) และ "สแกนจากรูป"
- **เครื่องยิงบาร์โค้ด USB / Bluetooth**: ยิงได้ทันที — ช่องที่โฟกัสอยู่จะรับค่าแล้วกระโดดไปช่องถัดไป ถ้าไม่ได้คลิกช่องไหน ระบบจะเติมลงช่อง Tracking (ถ้า Tracking มีแล้ว จะเติมช่องเลขอ้างอิง)
- สแกน Tracking แล้วระบบเช็กว่าเคยบันทึก QC แล้วหรือยัง · เลข EMS/ไปรษณีย์ไทยตรวจ check digit อัตโนมัติ · บอกขนส่ง (EMS, Kerry, Flash, J&T, Shopee, Lazada)

## รองรับทุกอุปกรณ์

| อุปกรณ์ | การใช้งาน |
|---|---|
| iPhone / Android | กล้องหลังถ่ายรูป/วิดีโอ/สแกน · แถบ "บันทึก QC" ติดล่างจอ · ไม่ซูมเองตอนกดช่องกรอก · จอไม่ดับระหว่างอัปโหลด |
| iPad / แท็บเล็ต | แนวตั้ง-แนวนอน · ปุ่มใหญ่สำหรับนิ้ว · เซ็นลายเซ็นด้วยนิ้ว/ปากกา |
| Laptop / PC | Webcam ถ่ายรูป/อัดวิดีโอ · ลากไฟล์มาวาง · วางรูปด้วย Ctrl+V · เครื่องยิงบาร์โค้ด USB/Bluetooth |

## ติดตั้งเป็นแอป

- iPhone/iPad: Safari → Share → Add to Home Screen
- Android/PC: Chrome → ⋮ → Install app

Made by TESR · TESR Co., Ltd. — Robot · AI · IoT · Automation
