import { useEffect, useState } from "react";
import { version as appVersion } from "../../package.json";
import { NavLink, Route, Routes, Link, useLocation } from "react-router-dom";
import {
  Layers2,
  LayoutDashboard,
  Wallet,
  ArrowDownLeft,
  Settings2,
  Plus,
  LockKeyhole,
  ArrowUpRight,
  Eye,
  EyeOff,
  Sun,
  Moon,
} from "lucide-react";
import { Dashboard } from "./features/dashboard";
import { CashPage } from "./features/cash";
import { TransactionsPage, PurchaseForm } from "./features/transactions";
import { SettingsPage } from "./features/backup";
import { useNotice, useSummary } from "./lib/hooks";
import { useAmountVisibility } from "./lib/amount-visibility";
import { useTheme } from "./lib/theme";
import { Button } from "./components/ui/button";
import { ErrorNotice, Loading, SuccessNotice } from "./components/common";

const nav = [
  { to: "/", label: "ภาพรวม", icon: LayoutDashboard },
  { to: "/cash", label: "บัญชีเงินสด", icon: Wallet },
  { to: "/transactions", label: "รายการซื้อ", icon: ArrowDownLeft },
  { to: "/settings", label: "ตั้งค่า", icon: Settings2 },
];

function Brand({ className = "" }: { className?: string }) {
  return (
    <Link className={`brand ${className}`} to="/" aria-label="Stacklet หน้าหลัก">
      <span className="brand-symbol">
        <Layers2 size={25} strokeWidth={2} />
      </span>
      stacklet<span className="brand-period">.</span>
    </Link>
  );
}

export function App() {
  const { pathname } = useLocation();
  const { hidden, toggle } = useAmountVisibility();
  const { dark, toggle: toggleTheme } = useTheme();
  const [purchase, setPurchase] = useState(false);
  const [notice, setNotice] = useNotice();
  const query = useSummary();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <span className="workspace-label">บันทึกการลงทุนส่วนตัว</span>
        <nav aria-label="เมนูหลัก">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"}>
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.to === "/" && <span className="nav-indicator" />}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="private-note">
            <LockKeyhole size={15} />
            <span>พื้นที่ส่วนตัวของคุณ</span>
          </div>
          <span className="sidebar-caption">บันทึกวันนี้ เห็นภาพระยะยาว</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <Brand className="mobile-brand" />
          <div className="topbar-brand">
            <span className="status-dot" />
            <span className="journal-label">Investment journal</span>
          </div>
          <div className="topbar-actions">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="theme-toggle"
              aria-label={dark ? "ใช้โหมดสว่าง" : "ใช้โหมดมืด"}
              aria-pressed={dark}
              title={dark ? "ใช้โหมดสว่าง" : "ใช้โหมดมืด"}
              onClick={toggleTheme}
            >
              {dark ? <Sun /> : <Moon />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="amount-toggle"
              aria-label={hidden ? "แสดงจำนวนเงิน" : "ซ่อนจำนวนเงิน"}
              aria-pressed={hidden}
              title={hidden ? "แสดงจำนวนเงิน" : "ซ่อนจำนวนเงิน"}
              onClick={toggle}
            >
              {hidden ? <EyeOff /> : <Eye />}
              <span className="amount-toggle-label">
                {hidden ? "แสดงยอดเงิน" : "ซ่อนยอดเงิน"}
              </span>
            </Button>
            <Button
              size="sm"
              className="purchase-button"
              aria-label="บันทึกการซื้อ"
              onClick={() => setPurchase(true)}
              disabled={!query.data}
            >
              <Plus />
              <span>บันทึกการซื้อ</span>
            </Button>
          </div>
        </header>
        <main>
          <SuccessNotice message={notice} onClose={() => setNotice("")} />
          {query.isPending ? (
            <Loading />
          ) : query.error ? (
            <div className="session-error">
              <ErrorNotice message={query.error.message} />
              <Button variant="outline" onClick={() => location.reload()}>
                โหลดหน้าใหม่
                <ArrowUpRight />
              </Button>
            </div>
          ) : (
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/cash" element={<CashPage />} />
              <Route path="/transactions" element={<TransactionsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route
                path="*"
                element={
                  <div className="empty">
                    <h1>ไม่พบหน้านี้</h1>
                    <Link to="/">กลับหน้าภาพรวม</Link>
                  </div>
                }
              />
            </Routes>
          )}
        </main>
        <footer>
          <span className="footer-brand">
            Stacklet <span className="app-version">v{appVersion}</span>
          </span>
          <span>ต้นทุนที่คุณบันทึก · ไม่ใช่มูลค่าตลาด</span>
        </footer>
      </div>
      {purchase && query.data && (
        <PurchaseForm
          accounts={query.data.data.cashAccounts}
          onClose={() => setPurchase(false)}
          onSaved={() => setNotice("บันทึกรายการเรียบร้อยแล้ว")}
        />
      )}
    </div>
  );
}
