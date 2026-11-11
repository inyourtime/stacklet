import { useAmountVisibility } from "../../lib/amount-visibility";
import { api } from "../../lib/api";
import { useState } from "react";
import { Plus, ArrowUpRight, Wallet, PenLine } from "lucide-react";
import type { CashAccount } from "../../../shared/contracts";
import {
  cashCreateSchema,
  cashRenameSchema,
  adjustmentSchema,
} from "../../../shared/contracts";
import { useAccounts, useOperation } from "../../lib/hooks";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import {
  Choice,
  Empty,
  ErrorNotice,
  Loading,
  Modal,
  Submit,
  TextField,
} from "../../components/common";

export function CashForm({
  account,
  action,
  onClose,
}: {
  account?: CashAccount;
  action: "create" | "rename" | "adjust";
  onClose: () => void;
}) {
  const { money } = useAmountVisibility();
  const [name, setName] = useState(account?.name ?? "");
  const [amount, setAmount] = useState(action === "create" ? "0.00" : "");
  const [mode, setMode] = useState("add");
  const op = useOperation(onClose);

  const title =
    action === "create"
      ? "เพิ่มบัญชีเงินสด"
      : action === "rename"
        ? "แก้ชื่อบัญชี"
        : "ปรับยอดเงินสด";

  return (
    <Modal
      title={title}
      description={
        account
          ? `${account.name} · คงเหลือ ฿${money(account.balanceThb)}`
          : "บัญชีทุกบัญชีใช้เงินบาท"
      }
      onClose={() => {
        if (!op.pending) onClose();
      }}
    >
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();

          if (action === "create") {
            void op.submit(
              cashCreateSchema,
              { name, balanceThb: amount },
              api.createCash,
            );
          } else if (action === "rename") {
            void op.submit(
              cashRenameSchema,
              { name, expectedVersion: account!.version },
              (data) => api.renameCash(account!.id, data),
            );
          } else {
            void op.submit(
              adjustmentSchema,
              { mode, amountThb: amount, expectedVersion: account!.version },
              (data) => api.adjustCash(account!.id, data),
            );
          }
        }}
      >
        {action !== "adjust" && (
          <TextField
            label="ชื่อบัญชี"
            value={name}
            onChange={setName}
            required
            maxLength={80}
          />
        )}
        {action === "adjust" && (
          <Choice
            label="วิธีปรับยอด"
            value={mode}
            onChange={setMode}
            options={[
              { value: "add", label: "เพิ่มเงินสด" },
              { value: "subtract", label: "ลดเงินสด" },
              { value: "set", label: "กำหนดยอดคงเหลือใหม่" },
            ]}
          />
        )}
        {action !== "rename" && (
          <TextField
            label={
              action === "create"
                ? "ยอดเริ่มต้น (บาท)"
                : mode === "set"
                  ? "ยอดคงเหลือใหม่ (บาท)"
                  : "จำนวนเงิน (บาท)"
            }
            value={amount}
            onChange={setAmount}
            inputMode="decimal"
            required
          />
        )}
        {action === "adjust" && (
          <p className="form-hint">
            การปรับยอดไม่สร้างรายการซื้อ และไม่เปลี่ยนต้นทุนสินทรัพย์
          </p>
        )}
        <ErrorNotice message={op.error} />
        <Submit pending={op.pending} />
      </form>
    </Modal>
  );
}

export function AccountCards({ accounts }: { accounts: CashAccount[] }) {
  const { money } = useAmountVisibility();
  const [edit, setEdit] = useState<{
    account: CashAccount;
    action: "rename" | "adjust";
  } | null>(null);

  return (
    <>
      <div className="account-grid">
        {accounts.map((a) => (
          <Card className="cash-card" key={a.id}>
            <div className="cash-card-head">
              <span className="cash-icon">
                <Wallet size={19} />
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`แก้ชื่อ ${a.name}`}
                onClick={() => setEdit({ account: a, action: "rename" })}
              >
                <PenLine size={15} />
              </Button>
            </div>
            <h3>{a.name}</h3>
            <div className="account-value">฿{money(a.balanceThb)}</div>
            <Button
              variant="outline"
              onClick={() => setEdit({ account: a, action: "adjust" })}
            >
              ปรับยอดเงินสด
              <ArrowUpRight size={15} />
            </Button>
          </Card>
        ))}
      </div>
      {edit && (
        <CashForm
          key={edit.account.id + edit.action}
          {...edit}
          onClose={() => setEdit(null)}
        />
      )}
    </>
  );
}

export function CashPage() {
  const query = useAccounts();
  const [create, setCreate] = useState(false);

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CASH ACCOUNTS</span>
          <h1>บัญชีเงินสด</h1>
          <p>เงินพร้อมลงทุน แยกตามบัญชี</p>
        </div>
        <Button onClick={() => setCreate(true)} disabled={!query.data}>
          <Plus />
          เพิ่มบัญชี
        </Button>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorNotice message={query.error.message} />
      ) : query.data?.data.length ? (
        <AccountCards accounts={query.data.data} />
      ) : (
        <Empty>
          <Wallet size={32} />
          <h3>เริ่มจากบัญชีเงินสดของคุณ</h3>
          <p>เพิ่มบัญชีและยอดคงเหลือ เพื่อใช้เป็นแหล่งเงินสำหรับการซื้อ</p>
          <Button onClick={() => setCreate(true)}>เพิ่มบัญชีเงินสด</Button>
        </Empty>
      )}
      <p className="section-note">
        ยอดในแอปเป็นยอดที่คุณบันทึก ปรับให้ตรงกับบัญชีจริงได้เสมอ
      </p>
      {create && <CashForm action="create" onClose={() => setCreate(false)} />}
    </>
  );
}
