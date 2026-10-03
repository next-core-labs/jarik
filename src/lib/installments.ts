/**
 * Split an annual rent into `count` installments, in whole halalas, so the schedule always adds
 * up to the rent exactly. The remainder goes to the LAST installment (100,000 / 3 becomes
 * 33,333.33 + 33,333.33 + 33,333.34). Rounding each installment independently, as the renewal
 * screen used to, over- or under-collects (35,000 / 12 -> 35,004; 10,000 / 3 -> 9,999).
 */
export function splitInstallments(total: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 1) throw new Error("عدد الدفعات غير صحيح");
  const halalas = Math.round(total * 100);
  let base = Math.round(halalas / count);
  // Only possible for absurdly small totals: rounding up could leave a negative last installment.
  if (halalas - base * (count - 1) < 0) base = Math.floor(halalas / count);
  const parts = Array.from({ length: count }, () => base);
  parts[count - 1] = halalas - base * (count - 1);
  return parts.map((h) => h / 100);
}
