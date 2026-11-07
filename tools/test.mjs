// Run with:  node tools/test.mjs   (Node 18+, no dependencies)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildRentCharges, buildUtilityCharges, buildSecurityDepositCharge, summarizeCharges, summarizeCharge,
  rentProgress, determineStatus, amountPaid, overdueAmount, STATUS,
} from "../assets/js/calculations.js";
import { validateTenantData } from "../assets/js/data.js";
import {
  formatPeso, formatDate, formatPeriod, todayManila, addMonths, dueDateFor, isISODate,
} from "../assets/js/utils.js";
import { verifyCredentials } from "../assets/js/auth.js";

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
};

const profile = { name: "T", unit: "U1", leaseStart: "2026-01-01", leaseEnd: "2026-12-31", contractMonths: 12, monthlyRent: 12000, rentDueDay: 4 };
const pay = (id, date, amount, chargeId, extra = {}) => ({ id, date, amount, allocations: [{ chargeId, amount }], ...extra });

console.log("utils");
await test("formatPeso", () => assert.equal(formatPeso(12000), "₱12,000.00"));
await test("formatDate has no timezone shift", () => assert.equal(formatDate("2026-01-01"), "Jan 1, 2026"));
await test("formatPeriod", () => assert.equal(formatPeriod("2026-10"), "October 2026"));
await test("addMonths crosses years", () => { assert.equal(addMonths("2026-11", 3), "2027-02"); assert.equal(addMonths("2026-01", 0), "2026-01"); });
await test("dueDateFor clamps to month end", () => { assert.equal(dueDateFor("2026-02", 31), "2026-02-28"); assert.equal(dueDateFor("2026-03", 4), "2026-03-04"); });
await test("isISODate rejects impossible dates", () => { assert.equal(isISODate("2026-02-30"), false); assert.equal(isISODate("2026-02-28"), true); });
await test("todayManila uses Asia/Manila (UTC+8)", () => {
  assert.equal(todayManila(new Date("2026-11-07T17:00:00Z")), "2026-11-08"); // 01:00 next day in Manila
  assert.equal(todayManila(new Date("2026-11-07T15:59:00Z")), "2026-11-07");
});

console.log("calculations");
await test("rent schedule derives from contract", () => {
  const c = buildRentCharges(profile);
  assert.equal(c.length, 12);
  assert.equal(c[0].id, "RENT-2026-01"); assert.equal(c[0].dueDate, "2026-01-04");
  assert.equal(c[11].id, "RENT-2026-12");
});
await test("schedule supports overrides", () => {
  const c = buildRentCharges(profile, [{ period: "2026-03", amountDue: 10000, dueDate: "2026-03-10" }]);
  assert.equal(c[2].amountDue, 10000); assert.equal(c[2].dueDate, "2026-03-10"); assert.equal(c[3].amountDue, 12000);
});
await test("status rules", () => {
  assert.equal(determineStatus(100, 100, "2026-01-04", "2026-02-01"), STATUS.PAID);
  assert.equal(determineStatus(100, 50, "2026-01-04", "2026-02-01"), STATUS.PARTIAL);
  assert.equal(determineStatus(100, 0, "2026-01-04", "2026-02-01"), STATUS.OVERDUE);
  assert.equal(determineStatus(100, 0, "2026-01-04", "2026-01-04"), STATUS.PENDING); // due today is not overdue yet
  assert.equal(determineStatus(100, 0, "2026-12-04", "2026-02-01"), STATUS.PENDING); // future is never overdue
});
await test("partial payments do not count as paid periods", () => {
  const charges = buildRentCharges(profile);
  const payments = [pay("P1", "2026-01-03", 12000, "RENT-2026-01"), pay("P2", "2026-02-03", 5000, "RENT-2026-02")];
  const p = rentProgress(summarizeCharges(charges, payments, "2026-03-01"), 12);
  assert.deepEqual(p, { total: 12, paid: 1, remaining: 11, percent: 8 });
});
await test("multiple partial payments add up to paid", () => {
  const payments = [pay("A", "2026-02-02", 5000, "RENT-2026-02"), pay("B", "2026-02-20", 7000, "RENT-2026-02")];
  const s = summarizeCharge(buildRentCharges(profile)[1], payments, "2026-03-01");
  assert.equal(s.status, STATUS.PAID); assert.equal(s.amountPaid, 12000); assert.equal(s.paymentDate, "2026-02-20");
});
await test("one payment can cover several charges", () => {
  const payments = [{ id: "X", date: "2026-03-01", amount: 24000, allocations: [{ chargeId: "RENT-2026-01", amount: 12000 }, { chargeId: "RENT-2026-02", amount: 12000 }] }];
  const s = summarizeCharges(buildRentCharges(profile).slice(0, 2), payments, "2026-03-02");
  assert.ok(s.every((r) => r.status === STATUS.PAID));
});
await test("float sums stay exact to the centavo", () => {
  const payments = [pay("A", "2026-01-01", 0.1, "C"), pay("B", "2026-01-02", 0.2, "C")];
  assert.equal(amountPaid("C", payments), 0.3);
});
await test("outstanding only counts past-due charges for overdue amount", () => {
  const s = summarizeCharges(buildRentCharges(profile), [], "2026-03-10"); // Jan, Feb, Mar due dates have passed
  assert.equal(overdueAmount(s, "2026-03-10"), 36000);
  assert.equal(rentProgress(s, 12).paid, 0);
});
await test("receipts attach to the charge via its payments", () => {
  const payments = [pay("R1", "2026-01-03", 12000, "RENT-2026-01", { receipt: "receipts/rent/R1.jpg" })];
  const s = summarizeCharge(buildRentCharges(profile)[0], payments, "2026-02-01");
  assert.deepEqual(s.receipts, [{ paymentId: "R1", path: "receipts/rent/R1.jpg", date: "2026-01-03" }]);
});
await test("unpaid deposit is pending or overdue based on its due date", () => {
  const charge = buildSecurityDepositCharge({ amountDue: 24000, dueDate: "2026-01-01" });
  assert.equal(charge.id, "SECURITY-DEPOSIT");
  assert.equal(summarizeCharge(charge, [], "2025-12-31").status, STATUS.PENDING);
  const summary = summarizeCharge(charge, [], "2026-01-02");
  assert.equal(summary.status, STATUS.OVERDUE);
  assert.equal(summary.outstanding, 24000);
  assert.equal(summary.paymentDate, null);
});
await test("partially paid deposit derives balance, status and last payment date", () => {
  const charge = buildSecurityDepositCharge({ id: "SECURITY-DEPOSIT", amountDue: 24000, dueDate: "2026-01-01" });
  const payments = [pay("D1", "2026-01-01", 10000, charge.id)];
  const summary = summarizeCharge(charge, payments, "2026-01-02");
  assert.equal(summary.status, STATUS.PARTIAL);
  assert.equal(summary.amountPaid, 10000);
  assert.equal(summary.outstanding, 14000);
  assert.equal(summary.paymentDate, "2026-01-01");
});
await test("fully paid deposit and its receipt use the existing charge summary", () => {
  const charge = buildSecurityDepositCharge({ amountDue: 24000, dueDate: "2026-01-01" });
  const payments = [pay("D1", "2026-01-01", 24000, charge.id, { receipt: "receipts/security-deposit/D1.jpg" })];
  const summary = summarizeCharge(charge, payments, "2026-01-02");
  assert.equal(summary.status, STATUS.PAID);
  assert.equal(summary.amountPaid, 24000);
  assert.equal(summary.outstanding, 0);
  assert.deepEqual(summary.receipts, [{ paymentId: "D1", path: "receipts/security-deposit/D1.jpg", date: "2026-01-01" }]);
});
await test("one payment can cover advance rent and the security deposit", () => {
  const deposit = buildSecurityDepositCharge({ amountDue: 24000, dueDate: "2026-01-01" });
  const payment = {
    id: "MOVE-IN", date: "2025-12-20", amount: 36000,
    allocations: [
      { chargeId: "RENT-2026-01", amount: 12000 },
      { chargeId: deposit.id, amount: 24000 },
    ],
  };
  const rent = summarizeCharge(buildRentCharges(profile)[0], [payment], "2026-01-02");
  const secured = summarizeCharge(deposit, [payment], "2026-01-02");
  assert.equal(rent.status, STATUS.PAID);
  assert.equal(secured.status, STATUS.PAID);
});
await test("deposit-only payments do not affect rent progress or overdue rent", () => {
  const rent = summarizeCharges(buildRentCharges(profile), [], "2026-02-01");
  const deposit = buildSecurityDepositCharge({ amountDue: 24000, dueDate: "2026-01-01" });
  const depositPayment = pay("D1", "2026-01-01", 24000, deposit.id);
  const rentWithDepositPayment = summarizeCharges(buildRentCharges(profile), [depositPayment], "2026-02-01");
  assert.deepEqual(rentProgress(rentWithDepositPayment, 12), rentProgress(rent, 12));
  assert.equal(overdueAmount(rentWithDepositPayment, "2026-02-01"), overdueAmount(rent, "2026-02-01"));
});

console.log("data validation");
const data = JSON.parse(readFileSync(new URL("../data/tenant.json", import.meta.url)));
await test("shipped tenant.json is valid", () => assert.deepEqual(validateTenantData(data), []));
const validData = structuredClone(data);
validData.profile = profile;
await test("deposit accepts its default id in allocations", () => {
  const sample = structuredClone(validData);
  delete sample.securityDeposit.id;
  sample.payments.push(pay("SECURITY-DEPOSIT-DEFAULT", "2026-01-01", 24000, "SECURITY-DEPOSIT"));
  assert.deepEqual(validateTenantData(sample), []);
});
await test("validates deposit structure, amount, date and unique id", () => {
  const bad = structuredClone(validData);
  bad.securityDeposit = { id: bad.utilityBills[0].id, amountDue: "24000", dueDate: "2026-02-30" };
  const errs = validateTenantData(bad);
  assert.ok(errs.some((e) => e.includes("Duplicate charge id")));
  assert.ok(errs.some((e) => e.includes("amountDue")));
  assert.ok(errs.some((e) => e.includes("dueDate")));
  bad.securityDeposit = [];
  assert.ok(validateTenantData(bad).some((e) => e.includes("securityDeposit' must be an object")));
});
await test("detects unknown charge reference", () => {
  const bad = structuredClone(validData); bad.payments[0].allocations[0].chargeId = "RENT-1999-01";
  assert.ok(validateTenantData(bad).some((e) => e.includes("unknown charge")));
});
await test("detects over-allocated payment", () => {
  const bad = structuredClone(validData); bad.payments[0].allocations[0].amount = 999999;
  assert.ok(validateTenantData(bad).some((e) => e.includes("exceed")));
});
await test("detects duplicate payment ids and bad receipt paths", () => {
  const bad = structuredClone(validData); bad.payments[1].id = bad.payments[0].id; bad.payments[2].receipt = "../secrets.jpg";
  const errs = validateTenantData(bad);
  assert.ok(errs.some((e) => e.includes("Duplicate payment"))); assert.ok(errs.some((e) => e.includes("receipt must be")));
});
await test("detects bad structure", () => {
  assert.ok(validateTenantData({}).length > 0); assert.ok(validateTenantData(null).length > 0);
});
await test("mock data yields expected dashboard numbers", () => {
  const today = "2026-11-07";
  const rent = summarizeCharges(buildRentCharges(data.profile, data.rentCharges), data.payments, today);
  const p = rentProgress(rent, data.profile.contractMonths);
  assert.equal(p.paid, 9); assert.equal(p.remaining, 3); assert.equal(p.percent, 75);
  const status = Object.fromEntries(rent.map((r) => [r.period, r.status]));
  assert.equal(status["2026-10"], "partial"); assert.equal(status["2026-11"], "overdue"); assert.equal(status["2026-12"], "pending");
  const util = summarizeCharges(buildUtilityCharges(data.utilityBills), data.payments, today);
  assert.equal(util.length, 12);
  assert.equal(util.find((u) => u.id === "INTERNET-2026-09").status, "overdue");
  assert.equal(util.find((u) => u.id === "WATER-2026-09").status, "partial");
  assert.equal(util.find((u) => u.id === "ELECTRICITY-2026-10").status, "pending");
});

console.log("auth");
await test("demo credentials verify; wrong ones fail", async () => {
  assert.equal(await verifyCredentials("tenant", "demo1234"), true);
  assert.equal(await verifyCredentials("TENANT ", "demo1234"), true);
  assert.equal(await verifyCredentials("tenant", "wrong"), false);
  assert.equal(await verifyCredentials("someone", "demo1234"), false);
});

console.log(`\n${passed} passed${process.exitCode ? ", with failures" : ""}`);
