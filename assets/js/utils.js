// Shared helpers: formatting and date math.
// All dates are handled as plain "YYYY-MM-DD" strings and billing periods as
// "YYYY-MM" strings, never through local-time Date objects, so results do not
// shift with the viewer's timezone.

export const TIMEZONE = "Asia/Manila";

const pesoFormat = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isISODate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isPeriod(value) {
  return typeof value === "string" && PERIOD.test(value);
}

/** Round to centavos to avoid floating point drift when summing money. */
export function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function formatPeso(amount) {
  return pesoFormat.format(Number(amount) || 0);
}

/** Today's date in Asia/Manila as YYYY-MM-DD. `now` is injectable for tests. */
export function todayManila(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** "2026-01-04" -> "Jan 4, 2026" */
export function formatDate(iso) {
  if (!isISODate(iso)) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** "2026-10" -> "October 2026" */
export function formatPeriod(period) {
  if (!isPeriod(period)) return "—";
  const [y, m] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** Add n months to a "YYYY-MM" period. */
export function addMonths(period, n) {
  const [y, m] = period.split("-").map(Number);
  const index = y * 12 + (m - 1) + n;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Due date inside a period; the day is clamped to the month's length. */
export function dueDateFor(period, day) {
  const [y, m] = period.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = Math.min(Math.max(1, Number(day) || 1), lastDay);
  return `${period}-${String(d).padStart(2, "0")}`;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}
