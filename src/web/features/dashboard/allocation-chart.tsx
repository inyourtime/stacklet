import { useAmountVisibility } from "../../lib/amount-visibility";
import { useId, useState } from "react";
import type { Summary } from "../../../shared/contracts";
import { parseUnits } from "../../../shared/money";
import { assetLabels } from "../../components/common";

type AssetType = Summary["allocations"][number]["type"];

function sectorPath(offset: number, percentage: number) {
  const point = (radius: number, position: number) => {
    const angle = (position / 100) * Math.PI * 2 - Math.PI / 2;

    return `${100 + radius * Math.cos(angle)} ${100 + radius * Math.sin(angle)}`;
  };
  const middle = offset + percentage / 2;
  const end = offset + percentage;

  // Two arcs on each edge also handle a single category occupying the full ring.
  return [
    `M ${point(90, offset)}`,
    `A 90 90 0 0 1 ${point(90, middle)}`,
    `A 90 90 0 0 1 ${point(90, end)}`,
    `L ${point(66, end)}`,
    `A 66 66 0 0 0 ${point(66, middle)}`,
    `A 66 66 0 0 0 ${point(66, offset)}`,
    "Z",
  ].join(" ");
}

export function AllocationChart({
  allocations,
  totalPrincipalThb,
}: Pick<Summary, "allocations" | "totalPrincipalThb">) {
  const { money } = useAmountVisibility();
  const titleId = useId();
  const descriptionId = useId();
  const [hovered, setHovered] = useState<AssetType | null>(null);
  const [focused, setFocused] = useState<AssetType | null>(null);
  const [selected, setSelected] = useState<AssetType | null>(null);
  const total = parseUnits(totalPrincipalThb, 2);

  const segments = allocations.map((allocation, index) => {
    const amount = parseUnits(allocation.amountThb, 2);
    const percentage = total > 0 ? (amount / total) * 100 : 0;
    const preceding = allocations
      .slice(0, index)
      .reduce((sum, item) => sum + BigInt(parseUnits(item.amountThb, 2)), 0n);

    // Only SVG geometry uses fractional values; amounts stay in integer satang.
    return {
      ...allocation,
      amount,
      percentage,
      offset: total > 0 ? (Number(preceding) / total) * 100 : 0,
    };
  });

  const visibleSegments = segments.filter((segment) => segment.amount > 0);
  const activeType = hovered ?? focused ?? selected;
  const active = segments.find(
    (segment) => segment.type === activeType && segment.amount > 0,
  );
  const description =
    total > 0
      ? segments
          .map(
            (segment) =>
              `${assetLabels[segment.type]} ${segment.percentage.toFixed(1)} เปอร์เซ็นต์ จำนวน ${money(segment.amountThb)} บาท`,
          )
          .join("; ")
      : "ยังไม่มีเงินต้นสำหรับแสดงสัดส่วน";

  return (
    <figure className="allocation-chart">
      <div
        className="allocation-donut"
        data-active={active?.type}
        data-single={visibleSegments.length === 1}
      >
        {/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Inline SVG needs an image role to expose its chart title and description. */}
        <svg
          viewBox="0 0 200 200"
          role="img"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
        >
          <title id={titleId}>กราฟวงกลมสัดส่วนเงินต้น</title>
          <desc id={descriptionId}>{description}</desc>
          <circle className="donut-track" cx="100" cy="100" r="78" />
          {visibleSegments.map((segment) => (
            <path
              key={segment.type}
              data-asset={segment.type}
              className={`donut-segment ${segment.type}${active ? (active.type === segment.type ? " is-active" : " is-muted") : ""}`}
              d={sectorPath(segment.offset, segment.percentage)}
              onPointerEnter={(event) => {
                if (event.pointerType !== "touch") setHovered(segment.type);
              }}
              onPointerLeave={() => setHovered(null)}
              onPointerUp={(event) => {
                if (event.button === 0) {
                  setSelected((current) =>
                    current === segment.type ? null : segment.type,
                  );
                }
              }}
            >
              <title>
                {assetLabels[segment.type]} · ฿{money(segment.amountThb)} ·{" "}
                {segment.percentage.toFixed(1)}%
              </title>
            </path>
          ))}
        </svg>
        {/* oxlint-enable jsx-a11y/prefer-tag-over-role */}
        <div className="donut-center" aria-hidden="true">
          <span>
            {active
              ? assetLabels[active.type]
              : total > 0
                ? "เงินต้นรวม"
                : "ยังไม่มีข้อมูล"}
          </span>
          <strong>
            {active
              ? `${active.percentage.toFixed(1)}%`
              : total > 0
                ? "100%"
                : "0%"}
          </strong>
          <small className={active ? "donut-center-amount" : undefined}>
            {active ? `฿${money(active.amountThb)}` : "ตามต้นทุนที่บันทึก"}
          </small>
        </div>
      </div>
      <figcaption className="allocation-list">
        {segments.map((segment) => (
          <button
            key={segment.type}
            type="button"
            data-asset={segment.type}
            className={active?.type === segment.type ? "is-active" : undefined}
            disabled={segment.amount === 0}
            aria-pressed={selected === segment.type && segment.amount > 0}
            aria-label={`${assetLabels[segment.type]} ${money(segment.amountThb)} บาท สัดส่วน ${segment.percentage.toFixed(1)}%`}
            onPointerEnter={() => setHovered(segment.type)}
            onPointerLeave={() => setHovered(null)}
            onFocus={() => {
              setFocused(segment.type);
              setHovered(null);
            }}
            onBlur={() => setFocused(null)}
            onClick={() =>
              setSelected((current) =>
                current === segment.type ? null : segment.type,
              )
            }
          >
            <span>
              <i className={`allocation-dot ${segment.type}`} />
              {assetLabels[segment.type]}
            </span>
            <strong>฿{money(segment.amountThb)}</strong>
            <span className="allocation-percent">
              {segment.percentage.toFixed(1)}%
            </span>
          </button>
        ))}
      </figcaption>
    </figure>
  );
}
