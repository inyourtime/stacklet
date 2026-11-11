import { useAmountVisibility } from "../../lib/amount-visibility";
import { useState } from "react";
import { Download, Upload, FileJson, ShieldCheck } from "lucide-react";
import {
  backupSchema,
  type Backup,
  type ImportPreview,
} from "../../../shared/contracts";
import { api, downloadBackup } from "../../lib/api";
import { useNotice, useOperation } from "../../lib/hooks";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Confirm, ErrorNotice, SuccessNotice } from "../../components/common";

export function SettingsPage() {
  const { money, quantity } = useAmountVisibility();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [notice, setNotice] = useNotice(
    new URLSearchParams(location.search).has("restored")
      ? "กู้คืนข้อมูลเรียบร้อยแล้ว ยอดตรงกับไฟล์สำรอง"
      : "",
  );

  const [file, setFile] = useState<Backup | null>(null);
  const [filename, setFilename] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const op = useOperation(() => {
    window.location.assign("/settings?restored=1");
  });

  const download = async (forRestore = false) => {
    setBusy(true);
    setError("");

    try {
      const result = await downloadBackup();

      if (forRestore) {
        if (!result.receipt)
          throw new Error("backup ปัจจุบันเกินขีดจำกัด Import จึงยังแทนที่ข้อมูลไม่ได้");

        if (result.meta.revision !== preview?.snapshotRevision) {
          setPreview(null);
          setReceipt(null);

          throw new Error(
            "ข้อมูลเปลี่ยนแล้ว กรุณาเลือกไฟล์เพื่อตรวจสอบและดาวน์โหลด backup ใหม่",
          );
        }

        setReceipt(result.receipt);
      }

      setNotice(
        result.restorable
          ? "เริ่มดาวน์โหลด backup แล้ว กรุณาตรวจว่าไฟล์ถูกบันทึกไว้"
          : "ดาวน์โหลด backup แล้ว แต่ไฟล์เกินขีดจำกัด Import รุ่นปัจจุบัน (1 MiB / 1,000 รายการซื้อ)",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "ดาวน์โหลดไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SETTINGS & DATA</span>
          <h1>ตั้งค่าและสำรองข้อมูล</h1>
          <p>เก็บสำเนาข้อมูลของคุณ และกู้คืนเมื่อจำเป็น</p>
        </div>
        <span className="private-badge">
          <ShieldCheck size={16} />
          บัญชีส่วนตัว
        </span>
      </div>
      <SuccessNotice message={notice} onClose={() => setNotice("")} />
      <ErrorNotice message={error} />
      <section className="settings-section">
        <div className="settings-icon">
          <Download />
        </div>
        <div className="settings-content">
          <h2>ส่งออกข้อมูล</h2>
          <p>ดาวน์โหลดบัญชีเงินสด รายการซื้อ และเป้าหมาย BTC เป็นไฟล์ JSON</p>
          <Button
            variant="outline"
            disabled={busy || op.pending}
            onClick={() => void download()}
          >
            <Download />
            ดาวน์โหลด backup
          </Button>
          <small>เก็บไฟล์นี้ไว้ในที่ส่วนตัว เพราะมีข้อมูลการเงินของคุณ</small>
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-icon">
          <Upload />
        </div>
        <div className="settings-content">
          <h2>นำเข้าข้อมูล</h2>
          <p>แทนที่ข้อมูลปัจจุบันทั้งหมดด้วยไฟล์สำรองของ Stacklet</p>
          <label className="upload-zone">
            <FileJson size={30} />
            <strong>{filename || "เลือกไฟล์สำรอง JSON"}</strong>
            <span>สูงสุด 1 MiB · ไม่เกิน 1,000 รายการซื้อ</span>
            <Input
              aria-label="ไฟล์สำรอง JSON"
              type="file"
              accept=".json,application/json"
              disabled={busy || op.pending}
              onChange={async (e) => {
                const f = e.target.files?.[0];

                setPreview(null);
                setReceipt(null);
                setFile(null);
                setError("");
                op.setError("");

                if (!f) return;

                setFilename(f.name);

                if (f.size > 1024 * 1024) {
                  setError("ไฟล์ต้องไม่เกิน 1 MiB");

                  return;
                }

                setBusy(true);

                try {
                  const parsed = backupSchema.safeParse(
                    JSON.parse(await f.text()),
                  );

                  if (!parsed.success)
                    throw new Error(parsed.error.issues[0].message);

                  const result = await api.validateImport(parsed.data);

                  setFile(parsed.data);
                  setPreview(result.data);
                } catch (err) {
                  setError(
                    err instanceof Error ? err.message : "อ่านไฟล์ไม่สำเร็จ",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
          {preview && (
            <div className="import-preview">
              <h3>ข้อมูลที่จะกู้คืน</h3>
              <dl>
                <div>
                  <dt>บัญชีเงินสด</dt>
                  <dd>{preview.cashAccountCount} บัญชี</dd>
                </div>
                <div>
                  <dt>รายการซื้อ</dt>
                  <dd>{preview.transactionCount} รายการ</dd>
                </div>
                <div>
                  <dt>เงินต้นรวม</dt>
                  <dd>฿{money(preview.totalPrincipalThb)}</dd>
                </div>
                <div>
                  <dt>BTC สะสม</dt>
                  <dd>{quantity(preview.btcQuantity)} BTC</dd>
                </div>
                <div>
                  <dt>เป้าหมาย BTC</dt>
                  <dd>
                    {preview.targetBtc
                      ? quantity(preview.targetBtc)
                      : "ยังไม่ตั้งเป้าหมาย"}
                  </dd>
                </div>
              </dl>
              <div className="import-actions">
                <Button
                  variant="outline"
                  disabled={busy || op.pending}
                  onClick={() => void download(true)}
                >
                  <Download />
                  {receipt
                    ? "ดาวน์โหลด backup อีกครั้ง"
                    : "1. ดาวน์โหลด backup ปัจจุบัน"}
                </Button>
                <Button
                  disabled={!receipt || busy || op.pending}
                  onClick={() => setConfirm(true)}
                >
                  2. ยืนยันแทนที่ข้อมูล
                </Button>
              </div>
              <p className="form-hint">
                ตรวจว่า backup ปัจจุบันถูกบันทึกแล้ว ก่อนยืนยันการแทนที่
              </p>
            </div>
          )}
        </div>
      </section>
      <p className="section-note">
        รุ่นข้อมูลสำรอง: 1 · สกุลเงิน: THB · วันรายงาน: Asia/Bangkok
      </p>
      {confirm && preview && file && receipt && (
        <Confirm
          title="แทนที่ข้อมูลทั้งหมด?"
          description="บัญชีเงินสด รายการซื้อ และเป้าหมายปัจจุบันจะถูกแทนที่ โปรดเก็บ backup ที่ดาวน์โหลดไว้เพื่อกู้คืน"
          pending={op.pending}
          error={op.error}
          confirmLabel="แทนที่ข้อมูลทั้งหมด"
          onClose={() => setConfirm(false)}
          onConfirm={() =>
            void op.run(
              api.replaceImport({
                backup: file,
                fileHash: preview.fileHash,
                snapshotRevision: preview.snapshotRevision,
                backupReceipt: receipt,
              }),
            )
          }
        />
      )}
    </>
  );
}
