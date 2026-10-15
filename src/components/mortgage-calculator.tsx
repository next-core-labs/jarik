import { useId, useState } from "react";

import { formatNumber, tf } from "@/components/listing-detail/format";
import { translate, type Locale } from "@/lib/i18n";
import { calculateMortgage } from "@/lib/mortgage";

/** حاسبة تقديرية للقسط الشهري لعروض البيع — لا تتصل بأي بنك، قيم افتراضية قابلة للتعديل. */
export function MortgageCalculator({ price, locale = "ar" }: { price: number; locale?: Locale }) {
  const [downPaymentPct, setDownPaymentPct] = useState(20);
  const [annualRatePct, setAnnualRatePct] = useState(6.5);
  const [years, setYears] = useState(20);
  const id = useId();

  const result = calculateMortgage({
    price,
    downPaymentPct: Number.isFinite(downPaymentPct) ? downPaymentPct : 0,
    annualRatePct: Number.isFinite(annualRatePct) ? annualRatePct : 0,
    years: Number.isFinite(years) && years > 0 ? years : 1,
  });

  const currency = translate(locale, "price_sale_unit");
  const money = (n: number) => `${formatNumber(Number.isFinite(n) ? n : 0, locale)} ${currency}`;

  const sliders = [
    {
      key: "down",
      label: tf(locale, "ld_mortgage_down"),
      value: `${formatNumber(downPaymentPct, locale)}% · ${money(result.downPayment)}`,
      min: 10,
      max: 50,
      step: 5,
      current: downPaymentPct,
      set: setDownPaymentPct,
    },
    {
      key: "rate",
      label: tf(locale, "ld_mortgage_rate"),
      value: `${formatNumber(annualRatePct, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`,
      min: 2,
      max: 8,
      step: 0.25,
      current: annualRatePct,
      set: setAnnualRatePct,
    },
    {
      key: "years",
      label: tf(locale, "ld_mortgage_term"),
      value: tf(locale, "ld_mortgage_years", { n: formatNumber(years, locale) }),
      min: 5,
      max: 30,
      step: 1,
      current: years,
      set: setYears,
    },
  ];

  return (
    <section className="flex flex-col gap-3.5 border border-border bg-card p-[22px]">
      <h2 className="text-xl font-bold">{translate(locale, "unit_mortgage")}</h2>
      <div className="grid items-center gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-[18px]">
          {sliders.map((s) => (
            <div key={s.key} className="flex flex-col gap-2">
              <label
                htmlFor={`${id}-${s.key}`}
                className="flex justify-between gap-3 text-sm font-medium"
              >
                <span>{s.label}</span>
                <span className="font-bold tabular-nums">{s.value}</span>
              </label>
              <input
                id={`${id}-${s.key}`}
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={s.current}
                aria-valuetext={s.value}
                onChange={(e) => s.set(e.target.valueAsNumber)}
                className="w-full cursor-pointer accent-foreground"
              />
            </div>
          ))}
        </div>

        <div
          className="flex flex-col gap-1.5 bg-foreground p-[22px] text-background"
          aria-live="polite"
        >
          <span className="text-sm text-background/70">{tf(locale, "ld_mortgage_monthly")}</span>
          <span className="text-4xl font-bold tabular-nums">{money(result.monthlyPayment)}</span>
          <span className="text-[13px] text-background/70 tabular-nums">
            {tf(locale, "ld_mortgage_loan", { v: money(result.principal) })}
          </span>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {tf(locale, "ld_mortgage_disclaimer")}
      </p>
    </section>
  );
}
