export type MortgageInput = {
  /** سعر الوحدة (ريال). */
  price: number;
  /** نسبة الدفعة المقدمة، 0-100. */
  downPaymentPct: number;
  /** نسبة الربح السنوية للتمويل، مثال 6.5. */
  annualRatePct: number;
  /** مدة التمويل بالسنوات. */
  years: number;
};

export type MortgageResult = {
  downPayment: number;
  principal: number;
  monthlyPayment: number;
  totalPayment: number;
  totalInterest: number;
};

/** Standard amortizing-loan formula. A 0% rate degrades to a flat principal/months split. */
export function calculateMortgage(input: MortgageInput): MortgageResult {
  const price = Math.max(0, input.price);
  const downPaymentPct = Math.min(100, Math.max(0, input.downPaymentPct));
  // Matches the calculator UI's max={30}; unclamped, an extreme years input drives (1+rate)^months
  // to Infinity, silently turning monthlyPayment into a NaN the UI displays as "0 ر.س".
  const years = Math.min(30, Math.max(1, input.years));
  const months = years * 12;
  const downPayment = (price * downPaymentPct) / 100;
  const principal = price - downPayment;
  const monthlyRate = Math.max(0, input.annualRatePct) / 100 / 12;

  const monthlyPayment =
    monthlyRate === 0
      ? principal / months
      : (principal * monthlyRate * (1 + monthlyRate) ** months) / ((1 + monthlyRate) ** months - 1);

  const totalPayment = monthlyPayment * months;
  const totalInterest = totalPayment - principal;

  return { downPayment, principal, monthlyPayment, totalPayment, totalInterest };
}
