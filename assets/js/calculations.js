// Pure calculation logic. No DOM access, so it can be unit-tested in Node
// (see tools/test.mjs). Charges and payments are separate records; balances
// and statuses are always derived, never stored.

import { addMonths, dueDateFor, roundMoney } from "./utils.js";

export const STATUS = Object.freeze({
  PAID: "paid",
  PARTIAL: "partial",
  PENDING: "pending",
  OVERDUE: "overdue",
});

/**
 * Build the rent schedule from the lease profile (one charge per contract
 * month). Optional overrides (data.rentCharges) are matched by period and can
 * change amountDue / dueDate for a specific month.
 */
export function buildRentCharges(profile, overrides = []) {
  const startPeriod = profile.leaseStart.slice(0, 7);
  const byPeriod = new Map(overrides.map((o) => [o.period, o]));
  const charges = [];
  for (let i = 0; i < profile.contractMonths; i++) {
    const period = addMonths(startPeriod, i);
    const o = byPeriod.get(period) || {};
    charges.push({
      id: `RENT-${period}`,
      kind: "rent",
      type: "rent",
      period,
      amountDue: o.amountDue ?? profile.monthlyRent,
      dueDate: o.dueDate ?? dueDateFor(period, profile.rentDueDay),
    });
  }
  return charges;
}

export function buildUtilityCharges(bills = []) {
  return bills.map((b) => ({ ...b, kind: "utility" }));
}

export function buildSecurityDepositCharge(deposit) {
  if (!deposit) return null;
  return {
    ...deposit,
    id: deposit.id === undefined ? "SECURITY-DEPOSIT" : deposit.id,
    kind: "security-deposit",
    type: "security-deposit",
  };
}

/** All payments that allocate money to a charge, oldest first. */
export function paymentsFor(chargeId, payments) {
  return payments
    .filter((p) => p.allocations.some((a) => a.chargeId === chargeId))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Total amount applied to a charge across all payments. */
export function amountPaid(chargeId, payments) {
  let total = 0;
  for (const p of payments) {
    for (const a of p.allocations) {
      if (a.chargeId === chargeId) total += a.amount;
    }
  }
  return roundMoney(total);
}

/**
 * paid:    fully settled (amount paid >= amount due)
 * partial: something paid but not settled
 * overdue: nothing paid and the due date has passed (strictly before today)
 * pending: nothing paid and not yet past due (includes future periods)
 */
export function determineStatus(amountDue, paid, dueDate, today) {
  if (paid >= amountDue) return STATUS.PAID;
  if (paid > 0) return STATUS.PARTIAL;
  if (dueDate < today) return STATUS.OVERDUE;
  return STATUS.PENDING;
}

/** Charge + derived fields (paid, outstanding, status, receipts...). */
export function summarizeCharge(charge, payments, today) {
  const related = paymentsFor(charge.id, payments);
  const paid = amountPaid(charge.id, payments);
  const lastPayment = related.length ? related[related.length - 1] : null;
  return {
    ...charge,
    amountPaid: paid,
    outstanding: roundMoney(Math.max(0, charge.amountDue - paid)),
    status: determineStatus(charge.amountDue, paid, charge.dueDate, today),
    paymentDate: lastPayment ? lastPayment.date : null,
    receipts: related
      .filter((p) => p.receipt)
      .map((p) => ({ paymentId: p.id, path: p.receipt, date: p.date })),
  };
}

export function summarizeCharges(charges, payments, today) {
  return charges.map((c) => summarizeCharge(c, payments, today));
}

/** Rental progress: only fully settled periods count as paid. */
export function rentProgress(rentSummaries, totalPeriods) {
  const total = totalPeriods ?? rentSummaries.length;
  const paid = rentSummaries.filter((r) => r.status === STATUS.PAID).length;
  return {
    total,
    paid,
    remaining: Math.max(0, total - paid),
    percent: total > 0 ? Math.round((paid / total) * 100) : 0,
  };
}

/** Totals over a list of summarized charges. */
export function totals(summaries) {
  const due = roundMoney(summaries.reduce((s, c) => s + c.amountDue, 0));
  const paid = roundMoney(summaries.reduce((s, c) => s + Math.min(c.amountPaid, c.amountDue), 0));
  return { due, paid, outstanding: roundMoney(due - paid) };
}

/** Outstanding amount on charges whose due date has already passed. */
export function overdueAmount(summaries, today) {
  return roundMoney(
    summaries.filter((c) => c.dueDate < today).reduce((s, c) => s + c.outstanding, 0)
  );
}
