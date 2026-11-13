import { useAmountVisibility } from "../../lib/amount-visibility";
import { useDeferredValue, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  Bitcoin,
  Plus,
  Search,
  PenLine,
  Trash2,
} from "lucide-react";
import {
  purchaseSchema,
  purchaseEditSchema,
  assetTypes,
  type Transaction,
  type CashAccount,
} from "../../../shared/contracts";
import { bangkokDate, formatThb, parseThb } from "../../../shared/money";
import { useAccounts, useNotice, useOperation } from "../../lib/hooks";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/query-keys";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Badge } from "../../components/ui/badge";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "../../components/ui/table";
import {
  Choice,
  Confirm,
  Empty,
  ErrorNotice,
  Field,
  Loading,
  Modal,
  Submit,
  SuccessNotice,
  TextField,
  assetLabels,
} from "../../components/common";

function lastAccount(accounts: CashAccount[]) {
  try {
    const value = localStorage.getItem("stacklet.lastCashAccount");

    return accounts.some((a) => a.id === value) ? value! : "external";
  } catch {
    return "external";
  }
}

export function PurchaseForm({
  transaction,
  accounts,
  onClose,
  onSaved,
}: {
  transaction?: Transaction;
  accounts: CashAccount[];
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { money } = useAmountVisibility();
  const [type, setType] = useState(transaction?.assetType ?? "stock");
  const [name, setName] = useState(transaction?.assetName ?? "");
  const [date, setDate] = useState(transaction?.tradeDate ?? bangkokDate());
  const [amount, setAmount] = useState(transaction?.amountThb ?? "");
  const [btc, setBtc] = useState(transaction?.btcQuantity ?? "");

  const [source, setSource] = useState(
    transaction
      ? (transaction.cashAccountId ?? "external")
      : lastAccount(accounts),
  );

  const [note, setNote] = useState(transaction?.note ?? "");

  const op = useOperation(() => {
    try {
      if (source !== "external")
        localStorage.setItem("stacklet.lastCashAccount", source);
    } catch {
      /* preference unavailable */
    }

    onSaved?.();
    onClose();
  });

  const account = accounts.find((a) => a.id === source);
  let available: bigint | null = null;
  let after: bigint | null = null;

  if (account) {
    available =
      BigInt(parseThb(account.balanceThb)) +
      (transaction?.cashAccountId === account.id
        ? BigInt(parseThb(transaction.amountThb))
        : 0n);

    try {
      after = available - BigInt(parseThb(amount));
    } catch {
      /* incomplete input */
    }
  }

  return (
    <Modal
      title={transaction ? "แก้ไขรายการซื้อ" : "เพิ่มรายการซื้อ"}
      description="บันทึกต้นทุนที่จ่ายจริง รวมค่าธรรมเนียมแล้ว"
      onClose={() => {
        if (!op.pending) onClose();
      }}
    >
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();

          const input = {
            assetType: type,
            assetName: name,
            tradeDate: date,
            amountThb: amount,
            btcQuantity: type === "btc" ? btc : null,
            cashAccountId: source === "external" ? null : source,
            note: note || null,
            ...(transaction ? { expectedVersion: transaction.version } : {}),
          };

          if (after !== null && after < 0n) {
            op.setError("เงินสดไม่พอ กรุณาลดยอดซื้อหรือเติมเงินก่อน");
            return;
          }

          if (transaction) {
            void op.submit(purchaseEditSchema, input, (data) =>
              api.editPurchase(transaction.id, data),
            );
          } else {
            void op.submit(purchaseSchema, input, api.createPurchase);
          }
        }}
      >
        <div className="form-row">
          <Choice
            label="ประเภทสินทรัพย์"
            value={type}
            onChange={(value) => {
              setType(value as typeof type);

              if (value === "btc") setName("BTC");
              else if (name === "BTC") setName("");
            }}
            options={assetTypes.map((value) => ({
              value,
              label: assetLabels[value],
            }))}
          />
          <TextField
            label="วันที่ซื้อ"
            value={date}
            onChange={setDate}
            type="date"
            required
          />
        </div>
        <TextField
          label="ชื่อหรือสัญลักษณ์สินทรัพย์"
          value={name}
          onChange={setName}
          required
          maxLength={80}
        />
        <TextField
          label="เงินต้นที่จ่ายจริง (บาท)"
          value={amount}
          onChange={setAmount}
          inputMode="decimal"
          required
        />
        {type === "btc" && (
          <TextField
            label="จำนวน BTC ที่ได้รับจริง"
            value={btc}
            onChange={setBtc}
            inputMode="decimal"
            required
          />
        )}
        <Choice
          label="แหล่งเงิน"
          value={source}
          onChange={setSource}
          options={[
            ...accounts.map((a) => ({ value: a.id, label: a.name })),
            { value: "external", label: "เงินใหม่จากภายนอก" },
          ]}
        />
        {account ? (
          <div
            className={`balance-preview ${after !== null && after < 0n ? "insufficient" : ""}`}
          >
            <div>
              <span>
                ยอดใช้ได้
                {transaction?.cashAccountId === account.id
                  ? " (รวมเงินคืนเดิม)"
                  : ""}
              </span>
              <strong>฿{money(formatThb(available!))}</strong>
            </div>
            <div>
              <span>คงเหลือหลังซื้อ</span>
              <strong>
                {after === null ? "—" : `฿${money(formatThb(after))}`}
              </strong>
            </div>
          </div>
        ) : (
          <p className="form-hint">
            เงินภายนอกจะเพิ่มเงินต้นรวม หากเติมเงินไว้ในบัญชีแล้ว ให้เลือกบัญชีนั้น
          </p>
        )}
        <Field label="หมายเหตุ (ไม่บังคับ)">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={2}
          />
        </Field>
        {transaction?.cashAccountId && (
          <p className="form-hint">
            การแก้ไขจะคืนยอดเดิม ฿{money(transaction.amountThb)} ให้บัญชีต้นทาง
            แล้วหักยอดใหม่ หากเคยปรับเงินสดเอง กรุณาตรวจยอดหลังบันทึก
          </p>
        )}
        <ErrorNotice message={op.error} />
        <Submit pending={op.pending} />
      </form>
    </Modal>
  );
}

function DeletePurchase({
  transaction,
  onClose,
  onDeleted,
}: {
  transaction: Transaction;
  onClose: () => void;
  onDeleted: (message: string) => void;
}) {
  const { money } = useAmountVisibility();
  const op = useOperation(() => {
    onDeleted(
      transaction.cashAccountId
        ? "ลบรายการแล้ว คืนเงินให้บัญชีต้นทางแล้ว กรุณาตรวจยอดเงินสด"
        : "ลบรายการแล้ว ไม่มีการคืนเงินเข้าบัญชีเงินสด",
    );

    onClose();
  });

  return (
    <Confirm
      title={`ลบรายการ ${transaction.assetName}?`}
      description={
        transaction.cashAccountId
          ? `คืนเงิน ฿${money(transaction.amountThb)} ให้บัญชีต้นทาง หากเคยปรับยอดเอง อาจต้องปรับยอดให้ตรงกับบัญชีจริงอีกครั้ง`
          : "รายการนี้ใช้เงินภายนอก การลบจะลดเงินต้นรวมและไม่คืนเงินเข้าบัญชีเงินสด"
      }
      error={op.error}
      pending={op.pending}
      onClose={onClose}
      onConfirm={() =>
        void op.run(api.deletePurchase(transaction.id, transaction.version))
      }
    />
  );
}

export function PurchaseTable({
  items,
  accounts,
  onEdit,
  onDelete,
}: {
  items: Transaction[];
  accounts: CashAccount[];
  onEdit?: (t: Transaction) => void;
  onDelete?: (t: Transaction) => void;
}) {
  const { money, quantity } = useAmountVisibility();

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>สินทรัพย์ / วันที่</TableHead>
          <TableHead>ประเภท</TableHead>
          <TableHead className="text-right">ต้นทุน (บาท)</TableHead>
          <TableHead>แหล่งเงิน</TableHead>
          <TableHead className="text-right">จำนวน BTC</TableHead>
          {onEdit && (
            <TableHead>
              <span className="sr-only">จัดการรายการ</span>
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((t) => (
          <TableRow key={t.id}>
            <TableCell>
              <div className="asset-cell">
                <span className={`asset-symbol ${t.assetType}`}>
                  {t.assetType === "btc" ? (
                    <Bitcoin size={24} aria-hidden="true" />
                  ) : (
                    t.assetName.slice(0, 2).toUpperCase()
                  )}
                </span>
                <div>
                  <strong>{t.assetName}</strong>
                  <small>{t.tradeDate.split("-").reverse().join("/")}</small>
                  {t.note && (
                    <small className="transaction-note">{t.note}</small>
                  )}
                </div>
              </div>
            </TableCell>
            <TableCell>
              <Badge variant="secondary">{assetLabels[t.assetType]}</Badge>
            </TableCell>
            <TableCell className="text-right numeric">
              {money(t.amountThb)}
            </TableCell>
            <TableCell className="muted-cell">
              {t.cashAccountId
                ? (accounts.find((a) => a.id === t.cashAccountId)?.name ??
                  "บัญชีเงินสด")
                : "เงินภายนอก"}
            </TableCell>
            <TableCell className="text-right numeric muted-cell">
              {t.btcQuantity ? quantity(t.btcQuantity) : "—"}
            </TableCell>
            {onEdit && (
              <TableCell>
                <div className="row-actions">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`แก้ไข ${t.assetName}`}
                    onClick={() => onEdit(t)}
                  >
                    <PenLine size={15} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`ลบ ${t.assetName}`}
                    onClick={() => onDelete?.(t)}
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function TransactionsPage() {
  const accounts = useAccounts();
  const [type, setType] = useState<"all" | Transaction["assetType"]>("all");
  const [q, setQ] = useState("");
  const deferredQ = useDeferredValue(q);
  const [edit, setEdit] = useState<Transaction | "new" | null>(null);
  const [remove, setRemove] = useState<Transaction | null>(null);
  const [notice, setNotice] = useNotice();

  const query = useInfiniteQuery({
    queryKey: queryKeys.transactions(type, deferredQ),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.purchases({
        type: type === "all" ? undefined : type,
        q: deferredQ,
        cursor: pageParam ?? undefined,
        limit: "30",
      }),
    getNextPageParam: (last) => last.data.nextCursor ?? undefined,
  });

  const items = query.data?.pages.flatMap((p) => p.data.items) ?? [];

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">INVESTMENT JOURNAL</span>
          <h1>รายการซื้อ</h1>
          <p>ทุกก้าวของการสะสมสินทรัพย์</p>
        </div>
        <Button onClick={() => setEdit("new")} disabled={!accounts.data}>
          <Plus />
          เพิ่มรายการซื้อ
        </Button>
      </div>
      <div className="filters">
        <div className="search">
          <Search size={17} />
          <Input
            aria-label="ค้นหาชื่อสินทรัพย์"
            placeholder="ค้นหาชื่อสินทรัพย์…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <fieldset className="filter-tabs" aria-label="ประเภทสินทรัพย์">
          {(["all", ...assetTypes] as const).map((t) => (
            <button
              key={t}
              aria-pressed={type === t}
              onClick={() => setType(t)}
            >
              {t === "all"
                ? "ทั้งหมด"
                : assetLabels[t as keyof typeof assetLabels]}
            </button>
          ))}
        </fieldset>
      </div>
      <SuccessNotice message={notice} onClose={() => setNotice("")} />
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorNotice message={query.error.message} />
      ) : items.length ? (
        <>
          <PurchaseTable
            items={items}
            accounts={accounts.data?.data ?? []}
            onEdit={setEdit}
            onDelete={setRemove}
          />
          {query.hasNextPage && (
            <div className="load-more">
              <Button
                variant="outline"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? "กำลังโหลด…" : "โหลดรายการเพิ่มเติม"}
              </Button>
            </div>
          )}
        </>
      ) : (
        <Empty>
          <ArrowDownLeft size={30} />
          <h3>{q || type !== "all" ? "ไม่พบรายการที่ตรงกัน" : "ยังไม่มีรายการซื้อ"}</h3>
          <p>บันทึกหุ้น กองทุน Bitcoin หรือทองคำที่คุณซื้อ</p>
          <Button onClick={() => setEdit("new")} disabled={!accounts.data}>
            เพิ่มรายการแรก
          </Button>
        </Empty>
      )}
      {accounts.error && <ErrorNotice message={accounts.error.message} />}
      {edit && accounts.data && (
        <PurchaseForm
          transaction={edit === "new" ? undefined : edit}
          accounts={accounts.data.data}
          onClose={() => setEdit(null)}
          onSaved={() => setNotice("บันทึกรายการเรียบร้อยแล้ว")}
        />
      )}
      {remove && (
        <DeletePurchase
          transaction={remove}
          onClose={() => setRemove(null)}
          onDeleted={setNotice}
        />
      )}
    </>
  );
}
