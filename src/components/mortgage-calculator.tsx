import { useState } from "react";
import { Calculator } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { calculateMortgage } from "@/lib/mortgage";
import { sar } from "@/lib/format";

/** حاسبة تقديرية للقسط الشهري لعروض البيع — لا تتصل بأي بنك، قيم افتراضية قابلة للتعديل. */
export function MortgageCalculator({ price }: { price: number }) {
  const [downPaymentPct, setDownPaymentPct] = useState(20);
  const [annualRatePct, setAnnualRatePct] = useState(6.5);
  const [years, setYears] = useState(20);

  const result = calculateMortgage({
    price,
    downPaymentPct: Number.isFinite(downPaymentPct) ? downPaymentPct : 0,
    annualRatePct: Number.isFinite(annualRatePct) ? annualRatePct : 0,
    years: Number.isFinite(years) && years > 0 ? years : 1,
  });

  return (
    <Card className="shadow-deed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Calculator className="size-4 text-brass" aria-hidden />
          حاسبة التمويل العقاري
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="mortgage-down">الدفعة المقدمة %</Label>
            <Input
              id="mortgage-down"
              type="number"
              min={0}
              max={100}
              value={downPaymentPct}
              onChange={(e) => setDownPaymentPct(e.target.valueAsNumber)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mortgage-rate">نسبة الربح السنوية %</Label>
            <Input
              id="mortgage-rate"
              type="number"
              min={0}
              step={0.1}
              value={annualRatePct}
              onChange={(e) => setAnnualRatePct(e.target.valueAsNumber)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mortgage-years">مدة التمويل (سنوات)</Label>
            <Input
              id="mortgage-years"
              type="number"
              min={1}
              max={30}
              value={years}
              onChange={(e) => setYears(e.target.valueAsNumber)}
            />
          </div>
        </div>

        <div className="rounded-md border border-border bg-muted/40 p-4">
          <p className="text-sm text-muted-foreground">القسط الشهري التقديري</p>
          <p className="mt-1 font-display text-2xl font-bold">
            {sar(Number.isFinite(result.monthlyPayment) ? result.monthlyPayment : 0)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            الدفعة المقدمة {sar(result.downPayment)} · إجمالي المبلغ الممول {sar(result.principal)}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          تقدير مبدئي لأغراض التخطيط فقط، وليس عرض تمويل فعلي — راجع البنك أو جهة التمويل للحصول على
          القسط الدقيق.
        </p>
      </CardContent>
    </Card>
  );
}
