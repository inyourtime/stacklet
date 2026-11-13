import { useQuery } from "@tanstack/react-query";
import { calculateBtcPerformance } from "../../../shared/btc";
import { useAmountVisibility } from "../../lib/amount-visibility";
import { fetchBtcPrice } from "../../lib/btc-price";
import { queryKeys } from "../../lib/query-keys";
import { Button } from "../../components/ui/button";

export function BtcPerformance({
  quantity,
  costThb,
}: {
  quantity: string;
  costThb: string;
}) {
  const { money, hidden } = useAmountVisibility();
  const quote = useQuery({
    queryKey: queryKeys.btcPrice,
    queryFn: ({ signal }) => fetchBtcPrice(signal),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const performance = quote.data
    ? calculateBtcPerformance(quantity, costThb, quote.data)
    : null;
  const direction =
    !performance || performance.profitLossThb === "0.00"
      ? "neutral"
      : performance.profitLossThb.startsWith("-")
        ? "loss"
        : "gain";
  const sign = direction === "gain" && !hidden ? "+" : "";

  return (
    <section
      className="btc-performance"
      aria-labelledby="btc-performance-title"
    >
      <h3 id="btc-performance-title">กำไร / ขาดทุน BTC</h3>
      <p className="btc-profit" data-direction={hidden ? "neutral" : direction}>
        <strong>
          {performance ? `${sign}฿${money(performance.profitLossThb)}` : "—"}
        </strong>
        {performance && performance.profitLossPercent !== null && (
          <span>
            ({hidden ? "••••••" : `${sign}${performance.profitLossPercent}%`})
          </span>
        )}
      </p>
      <dl className="btc-valuation">
        <div>
          <dt>ต้นทุน BTC</dt>
          <dd>฿{money(costThb)}</dd>
        </div>
        <div>
          <dt>มูลค่าปัจจุบัน</dt>
          <dd>{performance ? `฿${money(performance.marketValueThb)}` : "—"}</dd>
        </div>
        <div>
          <dt>ราคา BTC / THB</dt>
          <dd>{performance ? `฿${money(performance.priceThb)}` : "—"}</dd>
        </div>
      </dl>
      {quote.isPending ? (
        <output className="section-note block">กำลังโหลดราคา BTC…</output>
      ) : quote.isError ? (
        <div className="btc-price-error">
          <p>
            <output>
              {performance
                ? "อัปเดตราคาไม่สำเร็จ กำลังแสดงราคาครั้งล่าสุด"
                : "ไม่สามารถโหลดราคา BTC ได้ในขณะนี้"}
            </output>
          </p>
          <Button
            variant="ghost"
            size="sm"
            disabled={quote.isFetching}
            onClick={() => void quote.refetch()}
          >
            ลองใหม่
          </Button>
        </div>
      ) : null}
      {performance && (
        <p className="section-note btc-price-note">
          กำไร/ขาดทุนที่ยังไม่รับรู้ · Binance TH
          <br />
          อัปเดต{" "}
          {new Date(quote.dataUpdatedAt).toLocaleTimeString("th-TH", {
            timeZone: "Asia/Bangkok",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}{" "}
          น. · ทุก 1 นาที
        </p>
      )}
    </section>
  );
}
