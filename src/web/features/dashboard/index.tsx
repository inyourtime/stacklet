import { useAmountVisibility } from "../../lib/amount-visibility";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, Plus, Wallet } from "lucide-react";
import { bangkokMonth } from "../../../shared/money";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/query-keys";
import { useSummary } from "../../lib/hooks";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Empty, ErrorNotice, Loading } from "../../components/common";
import { CashForm, AccountCards } from "../cash";
import { AllocationChart } from "./allocation-chart";
import { BtcGoal } from "../btc-goal";
import { PurchaseTable } from "../transactions";

function MonthlyPurchases() {
  const { money } = useAmountVisibility();
  const [month, setMonth] = useState(bangkokMonth());
  const query = useSummary(month);

  return (
    <section
      className="monthly-purchases"
      aria-labelledby="monthly-purchases-title"
    >
      <div className="monthly-heading">
        <h2 id="monthly-purchases-title">ยอดซื้อรายเดือน</h2>
        <label className="month-picker" htmlFor="report-month">
          <span className="sr-only">เดือนที่ดู</span>
          <Input
            id="report-month"
            aria-label="เดือนรายงาน"
            type="month"
            value={month}
            onChange={(e) => {
              if (e.target.value) setMonth(e.target.value);
            }}
          />
        </label>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorNotice message={query.error.message} />
      ) : query.data ? (
        <p className="monthly-total">
          <strong>฿{money(query.data.data.monthPurchasesThb)}</strong>
          <span>จาก {query.data.data.monthPurchaseCount} รายการซื้อ</span>
        </p>
      ) : null}
    </section>
  );
}

export function Dashboard() {
  const { money } = useAmountVisibility();
  const query = useSummary();
  const [create, setCreate] = useState(false);

  const recent = useQuery({
    queryKey: [...queryKeys.transactions("all", ""), "recent"],
    queryFn: () => api.purchases({ limit: "5" }),
  });

  if (query.isPending) return <Loading />;

  if (query.error) return <ErrorNotice message={query.error.message} />;

  if (!query.data) return null;

  const s = query.data.data;
  const empty = s.cashAccounts.length === 0 && s.investedThb === "0.00";

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>ภาพรวมการลงทุน</h1>
          <p>เงินต้นและสินทรัพย์ที่คุณบันทึก</p>
        </div>
      </div>
      <section className="principal-section" aria-labelledby="principal-title">
        <div className="principal-total">
          <h2 id="principal-title">เงินต้นรวม</h2>
          <div className="principal-amount">
            <span className="baht">฿</span>
            {money(s.totalPrincipalThb)}
          </div>
          <p>รวมเงินที่ลงทุนแล้วและเงินสดคงเหลือ</p>
        </div>
        <dl className="metric-strip">
          <div>
            <dt>เงินที่ลงทุนแล้ว</dt>
            <dd>฿{money(s.investedThb)}</dd>
          </div>
          <div>
            <dt>เงินสดคงเหลือ</dt>
            <dd>฿{money(s.cashThb)}</dd>
          </div>
        </dl>
      </section>
      {empty ? (
        <div className="onboarding">
          <span className="cash-icon">
            <Wallet size={23} />
          </span>
          <div>
            <h2>เริ่มบันทึกการลงทุน</h2>
            <p>เพิ่มบัญชีเงินสด หรือบันทึกการซื้อด้วยเงินภายนอกได้ทันที</p>
          </div>
          <Button onClick={() => setCreate(true)}>
            <Plus />
            เพิ่มบัญชีเงินสด
          </Button>
        </div>
      ) : null}
      <div className="overview-split">
        <section className="allocation-section">
          <div className="section-top">
            <h2>สัดส่วนเงินต้น</h2>
            <span className="muted-label">ตามต้นทุนที่บันทึก</span>
          </div>
          <AllocationChart
            allocations={s.allocations}
            totalPrincipalThb={s.totalPrincipalThb}
          />
        </section>
        <BtcGoal btc={s.btc} />
      </div>
      <section className="dashboard-cash">
        <div className="section-top">
          <h2>
            บัญชีเงินสด <span className="count">{s.cashAccounts.length}</span>
          </h2>
          <Button variant="ghost" asChild>
            <Link to="/cash">
              จัดการบัญชี
              <ArrowUpRight />
            </Link>
          </Button>
        </div>
        {s.cashAccounts.length ? (
          <AccountCards accounts={s.cashAccounts} />
        ) : (
          <p className="section-note">ยังไม่มีบัญชีเงินสด</p>
        )}
      </section>
      <MonthlyPurchases />
      <section className="recent-section">
        <div className="section-top">
          <h2>รายการซื้อล่าสุด</h2>
          <Button variant="ghost" asChild>
            <Link to="/transactions">
              ดูทั้งหมด
              <ArrowUpRight />
            </Link>
          </Button>
        </div>
        {recent.isPending ? (
          <Loading />
        ) : recent.error ? (
          <ErrorNotice message={recent.error.message} />
        ) : recent.data?.data.items.length ? (
          <PurchaseTable
            items={recent.data.data.items}
            accounts={s.cashAccounts}
          />
        ) : (
          <Empty>
            <p>รายการซื้อของคุณจะแสดงที่นี่</p>
          </Empty>
        )}
      </section>
      {create && <CashForm action="create" onClose={() => setCreate(false)} />}
    </>
  );
}
