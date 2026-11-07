// Dashboard rendering and interaction.

import { requireAuth, logout, getSessionUser } from "./auth.js";
import { loadTenantData, DataError } from "./data.js";
import {
  buildRentCharges,
  buildUtilityCharges,
  summarizeCharges,
  rentProgress,
  overdueAmount,
  STATUS,
} from "./calculations.js";
import { formatPeso, formatDate, formatPeriod, todayManila, escapeHtml } from "./utils.js";

const STATUS_LABEL = {
  [STATUS.PAID]: "Paid",
  [STATUS.PARTIAL]: "Partially paid",
  [STATUS.PENDING]: "Pending",
  [STATUS.OVERDUE]: "Overdue",
};
const STATUS_ICON = {
  [STATUS.PAID]: "✓",
  [STATUS.PARTIAL]: "◐",
  [STATUS.PENDING]: "○",
  [STATUS.OVERDUE]: "!",
};
const UTILITY_LABEL = { electricity: "Electricity", water: "Water", internet: "Internet" };

const $ = (selector) => document.querySelector(selector);

const PAGE_SIZE = 6;
const state = { rent: [], rentPage: 1, utilities: [], filter: "all", utilityPage: 1 };
let modal;

if (requireAuth()) {
  document.body.classList.remove("is-locked");
  init();
}

function init() {
  $("#logout-btn").addEventListener("click", logout);
  $("#retry-btn").addEventListener("click", load);
  $("#utility-filter").addEventListener("click", onFilterClick);
  document.addEventListener("click", onReceiptClick);
  document.addEventListener("click", onPageClick);
  setupModal();
  load();
}

/* ---------------- Loading ---------------- */

async function load() {
  show("loading");
  try {
    const data = await loadTenantData();
    render(data);
    show("content");
  } catch (err) {
    console.error(err);
    $("#error-message").textContent =
      err instanceof DataError ? err.message : "Something went wrong while loading your records.";
    if (err instanceof DataError && err.details.length) {
      console.warn("tenant.json problems:\n- " + err.details.join("\n- "));
    }
    show("error");
  }
}

function show(which) {
  $("#loading").hidden = which !== "loading";
  $("#error").hidden = which !== "error";
  $("#content").hidden = which !== "content";
}

/* ---------------- Rendering ---------------- */

function render(data) {
  const today = todayManila();
  const { profile } = data;

  const rent = summarizeCharges(buildRentCharges(profile, data.rentCharges), data.payments, today);
  const utilities = summarizeCharges(buildUtilityCharges(data.utilityBills), data.payments, today)
    .sort((a, b) => b.period.localeCompare(a.period) || a.type.localeCompare(b.type));
  state.rent = rent;
  state.rentPage = 1;
  state.utilityPage = 1;
  state.utilities = utilities;

  $("#welcome").textContent = profile.name ? `Hi, ${profile.name.split(" ")[0]}` : getSessionUser() || "";
  renderLease(profile);
  renderProgress(rentProgress(rent, profile.contractMonths), overdueAmount(rent, today));
  renderRent();
  renderUtilities();
}

function renderLease(p) {
  const items = [
    ["Tenant", p.name],
    ["Unit", p.unit],
    ["Lease start", formatDate(p.leaseStart)],
    ["Lease end", formatDate(p.leaseEnd)],
    ["Monthly rent", formatPeso(p.monthlyRent)],
    ["Contract duration", `${p.contractMonths} month${p.contractMonths === 1 ? "" : "s"}`],
  ];
  $("#lease-info").innerHTML = items
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join("");
}

function renderProgress(p, overdue) {
  $("#progress").innerHTML = `
    <p class="progress-headline"><strong>${p.paid} / ${p.total}</strong> rental periods paid</p>
    <div class="progress" role="progressbar" aria-label="Rental periods paid"
         aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.paid}"
         aria-valuetext="${p.paid} of ${p.total} periods paid">
      <div class="progress-fill" style="width:${p.percent}%"></div>
    </div>
    <dl class="stats">
      <div><dt>Paid</dt><dd>${p.paid}</dd></div>
      <div><dt>Remaining</dt><dd>${p.remaining}</dd></div>
      <div><dt>Completion</dt><dd>${p.percent}%</dd></div>
      <div><dt>Overdue amount</dt><dd class="${overdue > 0 ? "text-bad" : ""}">${formatPeso(overdue)}</dd></div>
    </dl>`;
}

function badge(status) {
  return `<span class="badge badge-${status}"><span aria-hidden="true">${STATUS_ICON[status]}</span> ${STATUS_LABEL[status]}</span>`;
}

function paginate(rows, page) {
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * PAGE_SIZE;
  return { items: rows.slice(start, start + PAGE_SIZE), current, totalPages, total: rows.length, start };
}

function renderPagination(containerSelector, target, p) {
  if (p.totalPages <= 1) return;
  const nav = document.createElement("nav");
  nav.className = "pagination";
  nav.setAttribute("aria-label", "Pagination");
  const info = document.createElement("span");
  info.className = "muted";
  info.textContent = "Showing " + (p.start + 1) + "–" + Math.min(p.start + PAGE_SIZE, p.total) + " of " + p.total;
  const mk = (label, page, disabled) => { const b = document.createElement("button"); b.type = "button"; b.className = "btn btn-ghost"; b.textContent = label; b.dataset.pageTarget = target; b.dataset.page = page; b.disabled = disabled; return b; };
  const pageLabel = document.createElement("span");
  pageLabel.textContent = "Page " + p.current + " of " + p.totalPages;
  const controls = document.createElement("div");
  controls.className = "pagination-controls";
  controls.append(mk("Previous", p.current - 1, p.current === 1), pageLabel, mk("Next", p.current + 1, p.current === p.totalPages));
  nav.append(info, controls);
  $(containerSelector).append(nav);
}

function onPageClick(event) {
  const btn = event.target.closest("[data-page-target]");
  if (!btn || btn.disabled) return;
  const page = Number(btn.dataset.page);
  if (btn.dataset.pageTarget === "rent") { state.rentPage = page; renderRent(); }
  else { state.utilityPage = page; renderUtilities(); }
}

function receiptCell(receipts, title) {
  if (!receipts.length) return `<span class="muted">None</span>`;
  return receipts
    .map((r, i) => {
      const label = receipts.length > 1 ? `Receipt ${i + 1}` : "View receipt";
      return `<button type="button" class="btn btn-link" data-receipt="${escapeHtml(r.path)}"
                data-title="${escapeHtml(`${title} – ${formatDate(r.date)}`)}">${label}</button>`;
    })
    .join(" ");
}

function renderRent() {
  const p = paginate(state.rent, state.rentPage);
  $("#rent-history").innerHTML = `
    <div class="table-wrap">
      <table class="records">
        <thead><tr>
          <th scope="col">Period</th><th scope="col" class="num">Amount due</th>
          <th scope="col" class="num">Amount paid</th><th scope="col">Payment date</th>
          <th scope="col">Status</th><th scope="col">Receipt</th>
        </tr></thead>
        <tbody>${p.items
          .map(
            (r) => `<tr>
          <th scope="row" data-label="Period">${formatPeriod(r.period)}</th>
          <td class="num" data-label="Amount due">${formatPeso(r.amountDue)}</td>
          <td class="num" data-label="Amount paid">${formatPeso(r.amountPaid)}</td>
          <td data-label="Payment date">${formatDate(r.paymentDate)}</td>
          <td data-label="Status">${badge(r.status)}</td>
          <td data-label="Receipt">${receiptCell(r.receipts, `Rent ${formatPeriod(r.period)}`)}</td>
        </tr>`
          )
          .join("")}</tbody>
      </table>
    </div>`;
  renderPagination("#rent-history", "rent", p);
}

function renderUtilities() {
  const rows = state.utilities.filter((u) => state.filter === "all" || u.type === state.filter);

  document.querySelectorAll("#utility-filter .chip").forEach((chip) => {
    chip.setAttribute("aria-pressed", String(chip.dataset.filter === state.filter));
  });

  if (!rows.length) {
    $("#utility-history").innerHTML = `<p class="muted empty">No bills to show.</p>`;
    return;
  }

  const p = paginate(rows, state.utilityPage);

  $("#utility-history").innerHTML = `
    <div class="table-wrap">
      <table class="records">
        <thead><tr>
          <th scope="col">Utility</th><th scope="col">Billing period</th>
          <th scope="col" class="num">Amount due</th><th scope="col">Due date</th>
          <th scope="col" class="num">Amount paid</th><th scope="col">Payment date</th>
          <th scope="col">Status</th><th scope="col">Receipt</th>
        </tr></thead>
        <tbody>${p.items
          .map(
            (u) => `<tr>
          <th scope="row" data-label="Utility">${UTILITY_LABEL[u.type]}</th>
          <td data-label="Billing period">${formatPeriod(u.period)}</td>
          <td class="num" data-label="Amount due">${formatPeso(u.amountDue)}</td>
          <td data-label="Due date">${formatDate(u.dueDate)}</td>
          <td class="num" data-label="Amount paid">${formatPeso(u.amountPaid)}</td>
          <td data-label="Payment date">${formatDate(u.paymentDate)}</td>
          <td data-label="Status">${badge(u.status)}</td>
          <td data-label="Receipt">${receiptCell(u.receipts, `${UTILITY_LABEL[u.type]} ${formatPeriod(u.period)}`)}</td>
        </tr>`
          )
          .join("")}</tbody>
      </table>
    </div>`;
  renderPagination("#utility-history", "utility", p);
}

function onFilterClick(event) {
  const chip = event.target.closest("[data-filter]");
  if (!chip) return;
  state.filter = chip.dataset.filter;
  state.utilityPage = 1;
  renderUtilities();
}

/* ---------------- Receipt modal ---------------- */

function setupModal() {
  modal = $("#receipt-modal");
  $("#receipt-close").addEventListener("click", () => modal.close());
  // Click on the backdrop (the dialog element itself) closes the modal.
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.close();
  });
  modal.addEventListener("close", () => {
    const img = $("#receipt-img");
    img.removeAttribute("src");
    img.hidden = true;
  });
}

function onReceiptClick(event) {
  const btn = event.target.closest("[data-receipt]");
  if (btn) openReceipt(btn.dataset.receipt, btn.dataset.title);
}

function openReceipt(path, title) {
  const img = $("#receipt-img");
  const loading = $("#receipt-loading");
  const error = $("#receipt-error");
  const actions = $("#receipt-actions");

  // Resolve relative to the page so repo subpaths work on GitHub Pages.
  const url = new URL(path, document.baseURI).href;

  $("#receipt-title").textContent = title || "Receipt";
  loading.hidden = false;
  error.hidden = true;
  actions.hidden = true;
  img.hidden = true;

  img.onload = () => {
    loading.hidden = true;
    img.hidden = false;
    $("#receipt-open").href = url;
    $("#receipt-download").href = url;
    $("#receipt-download").setAttribute("download", path.split("/").pop());
    actions.hidden = false;
  };
  img.onerror = () => {
    loading.hidden = true;
    img.hidden = true;
    error.hidden = false;
  };
  img.src = url;

  if (!modal.open) modal.showModal();
}
