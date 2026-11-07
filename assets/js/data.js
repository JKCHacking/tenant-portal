// Loads and validates data/tenant.json.

import { isISODate, isPeriod } from "./utils.js";

export const UTILITY_TYPES = ["electricity", "water", "internet"];
const RECEIPT_PATH = /^receipts\/[A-Za-z0-9_\-/]+\.(jpe?g|png|webp)$/i;

export class DataError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "DataError";
    this.details = details;
  }
}

/**
 * Basic structural validation. Returns a list of human-readable problems
 * (empty list = valid). Catching typos here beats showing wrong numbers.
 */
export function validateTenantData(data) {
  const errors = [];
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

  if (!isObj(data)) return ["tenant.json must contain a JSON object."];

  const p = data.profile;
  if (!isObj(p)) {
    errors.push("Missing 'profile' object.");
  } else {
    for (const key of ["name", "unit"]) {
      if (typeof p[key] !== "string" || !p[key].trim()) errors.push(`profile.${key} is required.`);
    }
    if (!isISODate(p.leaseStart)) errors.push("profile.leaseStart must be YYYY-MM-DD.");
    if (!isISODate(p.leaseEnd)) errors.push("profile.leaseEnd must be YYYY-MM-DD.");
    if (!Number.isInteger(p.contractMonths) || p.contractMonths < 1) errors.push("profile.contractMonths must be a positive integer.");
    if (typeof p.monthlyRent !== "number" || p.monthlyRent < 0) errors.push("profile.monthlyRent must be a number.");
    if (!Number.isInteger(p.rentDueDay) || p.rentDueDay < 1 || p.rentDueDay > 31) errors.push("profile.rentDueDay must be 1-31.");
  }

  for (const key of ["utilityBills", "payments"]) {
    if (!Array.isArray(data[key])) errors.push(`'${key}' must be an array.`);
  }
  if (data.rentCharges !== undefined && !Array.isArray(data.rentCharges)) {
    errors.push("'rentCharges' must be an array when present.");
  }
  if (errors.length) return errors;

  // Rent charge overrides
  for (const [i, o] of (data.rentCharges || []).entries()) {
    const label = `rentCharges[${i}]`;
    if (!isPeriod(o.period)) errors.push(`${label}.period must be YYYY-MM.`);
    if (o.amountDue !== undefined && typeof o.amountDue !== "number") errors.push(`${label}.amountDue must be a number.`);
    if (o.dueDate !== undefined && !isISODate(o.dueDate)) errors.push(`${label}.dueDate must be YYYY-MM-DD.`);
  }

  // Utility bills
  const chargeIds = new Set();
  const addId = (id, label) => {
    if (typeof id !== "string" || !id) errors.push(`${label}.id is required.`);
    else if (chargeIds.has(id)) errors.push(`Duplicate charge id '${id}'.`);
    else chargeIds.add(id);
  };

  // Rent charge ids are generated: RENT-YYYY-MM
  const startPeriod = isISODate(p.leaseStart) ? p.leaseStart.slice(0, 7) : null;
  if (startPeriod) {
    for (let i = 0; i < p.contractMonths; i++) {
      const [y, m] = startPeriod.split("-").map(Number);
      const idx = y * 12 + (m - 1) + i;
      chargeIds.add(`RENT-${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`);
    }
  }

  if (data.securityDeposit !== undefined) {
    const deposit = data.securityDeposit;
    if (!isObj(deposit)) {
      errors.push("'securityDeposit' must be an object when present.");
    } else {
      const id = deposit.id === undefined ? "SECURITY-DEPOSIT" : deposit.id;
      addId(id, "securityDeposit");
      if (typeof deposit.amountDue !== "number" || deposit.amountDue < 0) {
        errors.push("securityDeposit.amountDue must be a number.");
      }
      if (!isISODate(deposit.dueDate)) errors.push("securityDeposit.dueDate must be YYYY-MM-DD.");
    }
  }

  for (const [i, b] of data.utilityBills.entries()) {
    const label = `utilityBills[${i}]`;
    addId(b.id, label);
    if (!UTILITY_TYPES.includes(b.type)) errors.push(`${label}.type must be one of: ${UTILITY_TYPES.join(", ")}.`);
    if (!isPeriod(b.period)) errors.push(`${label}.period must be YYYY-MM.`);
    if (typeof b.amountDue !== "number" || b.amountDue < 0) errors.push(`${label}.amountDue must be a number.`);
    if (!isISODate(b.dueDate)) errors.push(`${label}.dueDate must be YYYY-MM-DD.`);
  }

  // Payments
  const paymentIds = new Set();
  for (const [i, pay] of data.payments.entries()) {
    const label = `payments[${i}]${pay && pay.id ? ` (${pay.id})` : ""}`;
    if (typeof pay.id !== "string" || !pay.id) errors.push(`${label}.id is required.`);
    else if (paymentIds.has(pay.id)) errors.push(`Duplicate payment id '${pay.id}'.`);
    else paymentIds.add(pay.id);

    if (!isISODate(pay.date)) errors.push(`${label}.date must be YYYY-MM-DD.`);
    if (typeof pay.amount !== "number" || pay.amount <= 0) errors.push(`${label}.amount must be a positive number.`);
    if (!Array.isArray(pay.allocations) || pay.allocations.length === 0) {
      errors.push(`${label}.allocations must list the charge(s) this payment covers.`);
      continue;
    }
    let allocated = 0;
    for (const a of pay.allocations) {
      if (!chargeIds.has(a.chargeId)) errors.push(`${label} references unknown charge '${a.chargeId}'.`);
      if (typeof a.amount !== "number" || a.amount <= 0) errors.push(`${label} has an allocation to '${a.chargeId}' with an invalid amount.`);
      else allocated += a.amount;
    }
    if (typeof pay.amount === "number" && allocated > pay.amount + 0.005) {
      errors.push(`${label}: allocations (${allocated}) exceed the payment amount (${pay.amount}).`);
    }
    if (pay.receipt != null && (typeof pay.receipt !== "string" || !RECEIPT_PATH.test(pay.receipt) || pay.receipt.includes(".."))) {
      errors.push(`${label}.receipt must be a path like receipts/rent/ID.jpg (jpg, jpeg, png or webp).`);
    }
  }

  return errors;
}

/** Fetch + validate tenant.json. Throws DataError with a friendly message. */
export async function loadTenantData(url = "data/tenant.json") {
  let response;
  try {
    // Resolve relative to the current page so GitHub Pages repo subpaths work.
    response = await fetch(new URL(url, document.baseURI), { cache: "no-store" });
  } catch {
    throw new DataError("Could not reach the server. Check your connection and try again.");
  }
  if (!response.ok) {
    throw new DataError(`Could not load your records (error ${response.status}).`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new DataError("Your records file is not valid JSON. Please contact your landlord.");
  }

  const problems = validateTenantData(data);
  if (problems.length) {
    throw new DataError("Your records file has errors. Please contact your landlord.", problems);
  }
  return data;
}
