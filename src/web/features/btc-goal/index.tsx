import { useAmountVisibility } from "../../lib/amount-visibility";
import { api } from "../../lib/api";
import { useState } from "react";
import { goalSchema, type Summary } from "../../../shared/contracts";
import { useOperation } from "../../lib/hooks";
import { Modal, ErrorNotice, TextField, Submit } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Progress } from "../../components/ui/progress";

export function GoalForm({
  btc,
  onClose,
}: {
  btc: Summary["btc"];
  onClose: () => void;
}) {
  const [target, setTarget] = useState(btc.targetBtc ?? "");
  const [expectedVersion] = useState(btc.version);
  const op = useOperation(onClose);

  const submit = (clear = false) => {
    const parsed = goalSchema.safeParse({
      targetBtc: clear ? null : target,
      expectedVersion,
    });

    if (!parsed.success) {
      op.setError(parsed.error.issues[0].message);

      return;
    }

    void op.run(api.setGoal(parsed.data));
  };

  return (
    <Modal
      title="เป้าหมาย Bitcoin"
      description="ตั้งจำนวน BTC ที่อยากสะสม"
      onClose={() => {
        if (!op.pending) onClose();
      }}
    >
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField
          label="เป้าหมาย (BTC)"
          value={target}
          onChange={setTarget}
          inputMode="decimal"
          required
        />
        <ErrorNotice message={op.error} />
        <Submit pending={op.pending} />
        {btc.targetBtc && (
          <Button
            type="button"
            variant="ghost"
            disabled={op.pending}
            onClick={() => submit(true)}
          >
            ล้างเป้าหมาย
          </Button>
        )}
      </form>
    </Modal>
  );
}

export function BtcGoal({ btc }: { btc: Summary["btc"] }) {
  const { quantity } = useAmountVisibility();
  const [open, setOpen] = useState(false);

  return (
    <section className="btc-section">
      <div className="section-top">
        <h2>
          <span className="bitcoin-icon">₿</span>เป้าหมาย Bitcoin
        </h2>
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          {btc.targetBtc ? "แก้ไขเป้าหมาย" : "ตั้งเป้าหมาย"}
        </Button>
      </div>
      <span className="muted-label">สะสมแล้ว</span>
      <div className="btc-value">
        {quantity(btc.quantity)}
        <span>BTC</span>
      </div>
      {btc.targetBtc ? (
        <>
          <div className="progress-caption">
            <span>เป้าหมาย {quantity(btc.targetBtc)} BTC</span>
            <strong>{btc.progressPercent?.toLocaleString("th-TH")}%</strong>
          </div>
          <Progress
            value={Math.min(100, btc.progressPercent ?? 0)}
            aria-label="ความคืบหน้าเป้าหมาย Bitcoin"
          />
          <p className="section-note">
            {btc.remainingBtc === "0.00000000"
              ? "ถึงเป้าหมายแล้ว"
              : `อีก ${quantity(btc.remainingBtc!)} BTC ถึงเป้าหมาย`}
          </p>
        </>
      ) : (
        <p className="section-note">ตั้งเป้าหมายเพื่อดูความคืบหน้าการสะสม</p>
      )}
      {open && <GoalForm btc={btc} onClose={() => setOpen(false)} />}
    </section>
  );
}
