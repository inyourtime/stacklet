# Cloudflare setup and release

## 1. Account, domain, and environment configuration

1. สร้าง Cloudflare account และเพิ่ม domain ที่ควบคุมได้ เปิด Zero Trust สำหรับ Cloudflare Access
2. Login จากเครื่องพัฒนา: `pnpm exec wrangler login`
3. สร้าง D1 แยกสามฐาน: `stacklet-staging`, `stacklet-production`, `stacklet-integration-tests` ด้วย `pnpm exec wrangler d1 create <name>` เก็บ database IDs ที่ได้
4. คัดลอก `wrangler.jsonc` เป็น `wrangler.remote.local.json` (ถูก gitignore) ใส่ IDs จริงในแต่ละ environment
5. ใน `env.staging` และ `env.production` ตั้ง:
   - `APP_ENV` ตาม environment และ `DEV_AUTH_BYPASS=false`
   - `APP_ORIGIN` เป็น HTTPS origin ของแอป ไม่มี trailing slash เช่น `https://staging.invest.example.com`
   - `ACCESS_ISSUER` เป็น `https://<team>.cloudflareaccess.com`
   - `ACCESS_AUD` จาก Access application ของ environment นั้น
   - `OWNER_EMAIL` เป็นอีเมลเจ้าของ
   - `workers_dev=false`, `preview_urls=false`
   - `routes: [{ "pattern": "staging.invest.example.com", "custom_domain": true }]` ใช้ hostname ให้ตรงกับ origin
6. สร้าง Access self-hosted applications ครอบคลุม hostname ทั้งหมดของ staging และ production ตั้ง allow policy เฉพาะ owner email และใช้ email OTP หรือ identity provider ที่ต้องการ ป้องกันทั้ง static assets และ API
7. ตั้ง secret แยก environment ด้วย `pnpm exec wrangler secret put IMPORT_SIGNING_SECRET --config wrangler.remote.local.json --env staging` และ production ใช้ random secret อย่างน้อย 32 ตัวอักษร ไม่ใส่ใน frontend, tracked config หรือ command arguments

```bash
export STACKLET_CONFIG=wrangler.remote.local.json
pnpm db:init:staging
pnpm deploy:staging
```

`db:init:*` ตรวจว่าฐานข้อมูลว่างก่อนสร้าง schema; ถ้ามีตารางอยู่แล้วจะหยุด ห้ามใช้ schema initialization เป็น migration หรือ reset การ deploy ปกติไม่เรียก initialization

Vite plugin เลือก environment ด้วย `CLOUDFLARE_ENV` และสร้าง deployment config ตาม build จริง Scripts ใช้ config ที่ plugin สร้าง ไม่เดาชื่อโฟลเดอร์ output

### Auto deploy staging จาก GitHub

Workflow `.github/workflows/check.yml` รัน checks, domain/integration tests, browser tests และ build บน push/PR ทุก branch เมื่อเป็น push เข้า `staging` และ job `verify` ผ่าน จะรัน job `deploy-staging` ต่อ การ merge PR เข้า `staging` ทำให้เกิด push จึง deploy ด้วย ส่วน PR ที่ยังไม่ merge และ push เข้า `main` จะรันเฉพาะ checks

ตั้งค่าที่ GitHub repository → Settings → Environments → `staging` แล้วเลือก Deployment branches and tags → Selected branches and tags → เพิ่ม branch `staging` หากต้องการ deploy อัตโนมัติทันทีให้ไม่กำหนด required reviewers หรือ wait timer

เพิ่ม Environment secrets สามรายการ:

| Secret                      | ค่า                                                                       |
| --------------------------- | ------------------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`      | API token สำหรับ CI ของ Cloudflare account ที่มี Worker staging              |
| `CLOUDFLARE_ACCOUNT_ID`     | Account ID ของ Cloudflare account เดียวกัน                                 |
| `CLOUDFLARE_STAGING_CONFIG` | เนื้อหา JSON ทั้งไฟล์ `wrangler.remote.local.json` ที่ตั้ง `env.staging` ถูกต้องแล้ว |

สร้าง token ที่ Cloudflare → My Profile → API Tokens → Create Token โดยใช้ template **Edit Cloudflare Workers** จำกัด account ให้ตรงกับ staging และ zone ให้ตรงกับโดเมนของ staging Token ต้อง deploy Worker, อ่านรายการ Worker secrets และจัดการ Custom Domain ได้ ให้คง permission ของ template สำหรับ Wrangler แล้วกำหนด resource scope ให้ตรงกับ account/zone ที่ใช้งาน

Workflow สร้างไฟล์ config ชั่วคราวจาก secret แล้วเรียก `pnpm deploy:staging` โดยไม่พิมพ์ config ลง log ค่า `IMPORT_SIGNING_SECRET` ต้องมีอยู่ใน Cloudflare Worker แล้วตามขั้นตอนตั้งค่าครั้งแรก ไม่ต้องคัดลอกค่าตัวนี้เข้า GitHub

Job deploy เรียงคิวด้วย concurrency group เดียวกัน จึงไม่ deploy staging พร้อมกันหลายงาน การ deploy ไม่ initialize, reset หรือเปลี่ยน schema ของ D1

หากแก้ secrets หลัง workflow ล้มเหลว ให้ไป Actions → เลือก run บน branch `staging` → Re-run failed jobs หรือ push commit ใหม่เข้า `staging`

ตัวอย่างทำงานต่อจาก branch นี้:

```bash
git switch staging
git switch -c codex/my-change
# แก้โค้ด commit และ push แล้วเปิด PR โดยตั้ง base เป็น staging
```

รายละเอียดอ้างอิง: [Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) และ [GitHub deployment environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

## 2. Remote D1 integration tests

ใช้ฐานเฉพาะที่ไม่มีข้อมูลส่วนตัว ทดสอบผ่าน Worker entry แยกจากแอปจริง และป้องกันด้วย test runner secret

```bash
cp wrangler.integration.example.json wrangler.integration.local.json
# ใส่ ID ของ stacklet-integration-tests เท่านั้น
pnpm exec wrangler secret put TEST_RUNNER_SECRET --config wrangler.integration.local.json
# ใส่ random secret >=32 ตัวอักษร แล้วโหลดค่าเดียวกันเข้า environment อย่างปลอดภัย
export STACKLET_TEST_ORIGIN=https://stacklet-integration-tests.<account-subdomain>.workers.dev
# STACKLET_TEST_TOKEN ต้องมีค่าเดียวกับ TEST_RUNNER_SECRET; ห้าม commit หรือส่งออกใน logs
pnpm test:staging
```

Script ตรวจชื่อ Worker/DB และปฏิเสธ database IDs ที่ตรงกับ application environments สร้าง schema เฉพาะเมื่อยังไม่มี แล้ว deploy test runner และเรียก `/run` ด้วย secret ใน header

Test runner มีสิทธิ์เปลี่ยนข้อมูลใน test DB เท่านั้น ตรวจ concurrent spending, idempotent refund, stale versions, restore และ epoch ไม่ใช้ Access bypass ของแอปที่เปิดออกภายนอก; bypass ใช้ภายใน test Worker เพื่อเรียก app handler ใน harness โดยมี secret gate ครอบทุกคำขอขาเข้า

หลังทดสอบ ลบ test Worker ได้ด้วย `pnpm exec wrangler delete --config wrangler.integration.local.json` ฐานทดสอบเก็บแยกหรือลบทิ้งได้ตามต้องการ ห้ามนำ test config/entry ไปผูกกับ staging/production DB

## 3. Staging acceptance

- Login owner บนอุปกรณ์สองเครื่องแล้วเห็นข้อมูลชุดเดียวกัน อีเมลอื่นเข้าไม่ได้
- ไม่มี token, token ปลอม, token หมดอายุ, issuer/audience ผิด ต้องไม่เห็นข้อมูล
- ตรวจทุก origin ที่เคยใช้ รวม workers.dev และ preview URLs ว่าปิดหรือไม่เข้าถึงข้อมูล
- Origin ต่างหรือ mutation ไม่มี Origin ต้องถูกปฏิเสธ
- `/api/v1/does-not-exist` หลัง auth เป็น JSON 404; `/transactions` เปิดตรง/reload แล้วยังได้ SPA
- เพิ่มบัญชี → เติมเงิน → ซื้อ BTC → แก้ยอด/บัญชี → ลบ → ตรวจคืนเงิน
- ทดสอบเงินไม่พอ, หลายแท็บ และฟอร์มเก่า; ไม่เกิดยอดติดลบหรือเขียนทับเงียบ ๆ
- Export → Import; ยอดเงิน/BTC/goal ตรงกัน และฟอร์มก่อน restore ถูกปฏิเสธ
- แก้ข้อมูลจากแท็บอื่นหลัง preview แล้ว replace ต้องได้ conflict
- ตรวจมือถือ, keyboard, dialog focus และข้อความ error
- ตรวจ Workers logs ว่าไม่มี payload เงิน, backup, JWT หรือ secrets

## 4. Production

เมื่อ staging acceptance ผ่านแล้ว:

```bash
pnpm db:init:production   # ครั้งแรกเท่านั้น สำหรับฐานว่าง
pnpm deploy:production
```

ห้าม deploy production ก่อน remote tests และ staging acceptance ผ่าน จด version ID ที่ Wrangler รายงาน ตรวจ owner login, summary, API auth และ export หลัง deploy ก่อนเริ่มบันทึกข้อมูลจริง

## 5. Operations and rollback

ใช้ `db/schema.sql` เป็นไฟล์ schema เดียวสำหรับสร้างฐานข้อมูลใหม่ รองรับหุ้น กองทุน Bitcoin และทองคำแล้ว

- สำรองผ่านหน้า settings เป็นระยะ และก่อนแก้ schema เก็บไฟล์เป็นข้อมูลส่วนตัว
- Monitor Worker error counts/duration และใช้ request ID เทียบ logs; ไม่ log payload ทั้งก้อน
- Rollback code ใช้ `pnpm exec wrangler rollback <previous-version-id> --config wrangler.remote.local.json --env production` ตาม version ที่บันทึกไว้ ไม่ reset D1
- การเปลี่ยน schema ให้แก้ที่ `db/schema.sql` การ initialize ต้องใช้ฐานว่าง และการล้างฐานข้อมูลต้องเป็นคำสั่งที่เจ้าของระบุชัดเจน
- กู้ข้อมูลจากหน้า settings: validate → ดาวน์โหลดข้อมูลปัจจุบัน → confirm → ตรวจ summary และรายการ ระบบเปลี่ยน epoch; อุปกรณ์อื่นควร reload
- หาก Access config หรือ signing secret หาย ระบบปฏิเสธคำขอที่เกี่ยวข้องจนตั้งค่ากลับ ไม่เปิด bypass ชั่วคราวบน remote
