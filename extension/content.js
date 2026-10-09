function nmFromUrl() {
  const m = location.pathname.match(/\/catalog\/(\d+)\/detail\.aspx/);
  return m ? Number(m[1]) : 0;
}

function rub(text) {
  if (!text) return null;
  const n = Number(String(text).replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function readDom() {
  const finalEl =
    document.querySelector(".price-block__final-price") ||
    document.querySelector("[class*='priceBlockFinalPrice']") ||
    document.querySelector("ins.price-block__final-price");
  const oldEl =
    document.querySelector(".price-block__old-price") ||
    document.querySelector("[class*='priceBlockOldPrice']") ||
    document.querySelector("del");
  const walletEl = document.querySelector(".price-block__wallet-price");
  const total = rub(finalEl && finalEl.textContent);
  const basic = rub(oldEl && oldEl.textContent);
  const wallet = rub(walletEl && walletEl.textContent);
  return {
    priceBasic: basic,
    priceProduct: basic && total && basic > total ? basic : total,
    priceTotal: wallet && total && wallet < total ? wallet : total,
    totalQty: 0,
  };
}

async function readApi(nmId) {
  const url =
    "https://card.wb.ru/cards/v4/detail?appType=1&curr=rub&dest=-1257786&lang=ru&nm=" +
    nmId;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("card " + res.status);
  const json = await res.json();
  const p = (json.data && json.data.products && json.data.products[0]) || (json.products && json.products[0]);
  if (!p) throw new Error("пустая карточка");
  const sizes = Array.isArray(p.sizes) ? p.sizes : [];
  const toRub = (k) => (typeof k === "number" ? Math.round(k / 100) : null);
  let basic = null;
  let product = null;
  let total = null;
  for (const s of sizes) {
    const price = (s && s.price) || {};
    const b = toRub(price.basic);
    const pr = toRub(price.product);
    const t = toRub(price.total);
    if (b != null && (basic == null || b < basic)) basic = b;
    if (pr != null && (product == null || pr < product)) product = pr;
    if (t != null && (total == null || t < total)) total = t;
  }
  return {
    priceBasic: basic,
    priceProduct: product || basic,
    priceTotal: total || product || basic,
    totalQty: Number(p.totalQuantity) || 0,
  };
}

async function send(nmId, prices) {
  const payload = { nmId, ...prices };
  const reply = await chrome.runtime.sendMessage({ type: "wb-price", payload });
  const note = document.createElement("div");
  note.textContent = reply && reply.ok
    ? "СПП-Радар: цена сохранена"
    : "СПП-Радар: " + ((reply && reply.json && reply.json.message) || "не сохранилось");
  note.style.cssText =
    "position:fixed;z-index:2147483647;right:16px;bottom:16px;background:#1c1028;color:#fff;border:1px solid #7c3aed;border-radius:12px;padding:10px 14px;font:13px/1.3 Segoe UI,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35)";
  document.body.appendChild(note);
  setTimeout(() => note.remove(), 4000);
}

async function run() {
  const nmId = nmFromUrl();
  if (!nmId) return;
  let prices = null;
  try {
    prices = await readApi(nmId);
  } catch {
    prices = readDom();
  }
  if (!prices || (!prices.priceProduct && !prices.priceTotal)) {
    await new Promise((r) => setTimeout(r, 1500));
    prices = readDom();
  }
  if (!prices || (!prices.priceProduct && !prices.priceTotal)) return;
  await send(nmId, prices);
}

run();
