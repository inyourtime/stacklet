# Stacklet

เว็บบันทึกต้นทุนการลงทุนส่วนตัว ภาษาไทย: หุ้น กองทุน Bitcoin ทองคำ และบัญชีเงินสดหลายบัญชี ใช้ React + Hono ใน Cloudflare Worker เดียว และ D1 เป็นฐานข้อมูลหลัก

เงินต้นรวม = ต้นทุนสินทรัพย์ + เงินสดปัจจุบัน ไม่มีการดึงราคาตลาดหรือคำนวณผลตอบแทน

ปุ่มรูปตาที่แถบด้านบนซ่อน/แสดงยอดเงินบาทและจำนวน BTC ทุกหน้า รวม tooltip และข้อความสำหรับ screen reader ของกราฟ โดยยังแสดงเปอร์เซ็นต์สัดส่วน จำค่าใน `localStorage` ของเบราว์เซอร์เดิมและซิงก์ระหว่างแท็บ ไม่ซิงก์ข้ามอุปกรณ์ ช่องกรอกในฟอร์มแก้ไขและไฟล์ backup ยังคงใช้ค่าจริง

ปุ่มรูปดวงจันทร์/ดวงอาทิตย์สลับโหมดสว่างและมืด ครั้งแรกใช้ธีมของอุปกรณ์ เมื่อเลือกเองจะจำใน `localStorage` และซิงก์ระหว่างแท็บ ตั้งธีมก่อนโหลดแอปเพื่อลดหน้าขาวกะพริบ รวมสีของฟอร์ม dropdown ตาราง กราฟ และแถบเมนูมือถือ

## เริ่มพัฒนา

ต้องมี Node.js 26 และ pnpm 12 (เวอร์ชัน dependencies อยู่ใน lockfile)

```bash
pnpm install --frozen-lockfile
pnpm cf:typegen
pnpm db:init:local
pnpm dev
```

เปิด URL ที่ Vite แสดง (ปกติ `http://127.0.0.1:5173`) ฐานข้อมูล local เริ่มว่าง คำสั่ง `db:init:local` ใช้ครั้งแรกเท่านั้น ไม่ต้อง initialize ซ้ำเวลาเปิด dev server

Dev server ใช้ `wrangler.jsonc` เสมอ แม้ Terminal ยังตั้ง `STACKLET_CONFIG` จากการ deploy อยู่ ส่วน build/deploy ใช้ `STACKLET_CONFIG` เพื่อเลือกไฟล์ config ของ environment ที่ต้องการ

Local auth bypass ทำงานเฉพาะ `APP_ENV=local` และ hostname loopback เท่านั้น บน staging/production ต้องใช้ Cloudflare Access ที่ตั้งค่าถูกต้อง

## คำสั่งตรวจสอบ

```bash
pnpm format       # จัดรูปแบบ source, config, เอกสาร และ SQL
pnpm lint:fix     # แก้ lint ที่แก้อัตโนมัติได้
pnpm check        # TypeScript + lint + ตรวจรูปแบบไฟล์
pnpm test
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

- `pnpm lint` และ `pnpm format:check` ตรวจอย่างเดียว ไม่แก้ไฟล์; `pnpm check` รวมทั้งสองคำสั่งสำหรับ CI
- Formatter ใช้ Oxfmt สำหรับ source, config และเอกสาร; SQL ใช้ `sql-formatter` ด้วย SQLite dialect ผ่านคำสั่งเดียวกัน ส่วน linter ใช้ Oxlint รวม React และ accessibility rules โดยข้าม generated files และ build artifacts
- ตั้งค่ารูปแบบใน `.oxfmtrc.json` โดยใช้ความกว้าง 80 ตัวอักษร และคงบรรทัดว่างระหว่างกลุ่มโค้ด
- Domain tests ตรวจ decimal precision, limits, วัน และ validation
- Integration tests ใช้ **Miniflare/workerd + D1 จริงใน local runtime** ไม่ใช้ฐานข้อมูลจำลองใน array ทดสอบ SQL triggers, rollback, concurrency, JWT และ restore 1,000 รายการ
- Browser tests ใช้ Playwright ทดสอบ flow ครบบน desktop/mobile และ browser context ที่สอง
- E2E ใช้ฐานข้อมูลเฉพาะ `.wrangler/e2e` และล้างเฉพาะพื้นที่ทดสอบนี้ก่อนรัน ไม่แตะ local DB ที่ใช้พัฒนา
- `pnpm test:staging` ใช้ Worker และ D1 แยกสำหรับ integration เท่านั้น ดูคู่มือ deployment

## โครงสร้าง

- `src/web`: 4 หน้า `/`, `/cash`, `/transactions`, `/settings`; shadcn/ui จาก registry ปรับ theme สำหรับแอป
- `src/server`: Hono routes, Access JWT/Origin middleware, domain services และ prepared SQL
- `src/shared`: Zod request/response contracts และการแปลงเงิน/BTC แบบ integer
- `db/schema.sql`: schema สำหรับฐานข้อมูลใหม่ พร้อม constraints, purchase triggers, audit และ mutation guards
- `tests`: domain, D1 integration, security, restore และ E2E

## API reference และ typed client

Backend ใช้ `@hono/zod-openapi` ประกาศ route, request validation และ response contracts ร่วมกัน และสร้าง OpenAPI 3.1 จาก routes ที่ใช้งานจริง

- Scalar API reference: `/api/v1/reference`
- OpenAPI JSON: `/api/v1/openapi.json`

ทั้งสอง URL ต้องผ่าน Cloudflare Access และ owner allowlist เช่นเดียวกับ API บน local development ใช้ auth bypass เดิมได้ เอกสารใช้ same-origin API โดยปิด Scalar proxy และ telemetry

Frontend ใช้ `hc<AppType>` จาก `hono/client` ผ่าน `src/web/lib/api.ts` โดย import `AppType` แบบ type-only จึงไม่รวม server implementation เข้า browser bundle ทั้ง query/body/params/headers อ้างอิง type จาก route declarations ยังคงตรวจ response ด้วย Zod และจัดการ session/error envelope เหมือนเดิม

`useOperation` รับ typed mutation request เก็บ idempotency key เดิมเมื่อ retry และใช้ dataset epoch จากตอนเปิดฟอร์ม คำสั่ง `pnpm check` ตรวจ type ของ client พร้อม server

## การเขียนข้อมูล

ทุก mutation ต้องมี `Idempotency-Key` และ `X-Dataset-Epoch` ซึ่งอ่านได้จาก `meta` ของ GET responses การแก้ข้อมูลใช้ `expectedVersion`; DELETE ใช้ `If-Match: "3"`

Idempotency claim, guard, การเปลี่ยนข้อมูล, audit และ response ที่บันทึกไว้ อยู่ใน D1 batch เดียวกัน คำขอซ้ำที่เหมือนเดิมได้ response เดิม คำขอที่ payload ต่างได้ 409

Purchase triggers เป็นผู้หัก/คืนเงินเพียงจุดเดียว Account version เพิ่มเมื่อยอดหรือชื่อเปลี่ยน และ SQL guards ทำให้ stale edit ล้มเหลวก่อน commit ไม่มีการบันทึก success เมื่อไม่ได้แก้แถวจริง

## Backup / Import

หน้า settings ดาวน์โหลด JSON และตรวจไฟล์ก่อนแทนที่ ผู้ใช้ต้องเริ่มดาวน์โหลด backup ปัจจุบันก่อนปุ่มยืนยันจะเปิด Backend ออก signed receipt อายุ 15 นาทีผูกกับ revision/epoch และตรวจ snapshot ภายใน restore batch อีกครั้ง

Import รองรับ `schemaVersion: 1`, ไม่เกิน 1 MiB และ 1,000 รายการซื้อ คง IDs และ timestamps ของข้อมูลธุรกิจ แต่สร้าง versions/audit baseline ใหม่ เปลี่ยน dataset epoch เพื่อปฏิเสธฟอร์มเก่า เก็บ idempotency records เดิมไว้

Export ยังดาวน์โหลดได้เมื่อข้อมูลเกินขีดจำกัด Import โดยหน้าจอจะแจ้งว่าไฟล์นั้นยัง restore ด้วย MVP ไม่ได้ และไม่อนุญาตให้ replace ข้อมูลปัจจุบันหาก backup ปัจจุบันไม่สามารถ restore ได้ Browser ยืนยันได้เพียงเริ่มดาวน์โหลด ผู้ใช้ต้องตรวจการบันทึกไฟล์เอง

## Deploy

ดู [คู่มือตั้ง Cloudflare และ deploy](docs/DEPLOYMENT.md) และ [รายละเอียด API/backup](docs/API.md)

Repository มีค่า placeholder สำหรับ remote configuration และปิด `workers.dev`/preview URLs ของแอปไว้ Deployment scripts ปฏิเสธ placeholder, DB ที่ใช้ร่วมกัน, development bypass และ custom domain ที่ยังไม่ตั้งค่า

**ยังไม่ถือว่าผ่าน production acceptance จนกว่าจะรัน remote D1 tests และตรวจ Cloudflare Access บน staging จริง** การรัน local tests ไม่ยืนยันการตั้งค่าใน Cloudflare account
