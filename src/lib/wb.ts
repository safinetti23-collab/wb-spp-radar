/**
 * Клиент публичных API Wildberries.
 *
 * Режимы работы (выбирается автоматически по наличию env-переменных):
 *
 * 1. BROWSER (по умолчанию, WB_USE_FETCH не задан)
 *    Реальный Chromium через Playwright. Работает с домашнего IP без прокси.
 *    Браузер запускается один раз, живёт пока работает сервер.
 *
 * 2. FETCH + PROXY (WB_USE_FETCH=1 + WB_PROXY_URL задан)
 *    Обычный HTTP-запрос через прокси (http://user:pass@host:port).
 *    Быстрее, не требует Chromium, но нужен резидентный прокси.
 *
 * 3. FETCH без прокси (WB_USE_FETCH=1, WB_PROXY_URL не задан)
 *    Только для локальной сети, где IP не заблокирован.
 */

import { browserFetchJson } from "@/lib/browser";
import { ProxyAgent, fetch as undiciFetch } from "undici";

export const DEFAULT_DEST = -1257786; // Московский регион
export const DEFAULT_SPP_MAX = 30;    // максимальный сценарий СПП
const CHUNK_SIZE = 100;               // лимит артикулов на один запрос detail
const REQUEST_TIMEOUT = 30_000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/* ─── интерфейсы ──────────────────────────────────────────────────────── */

export interface WbSizePrice {
  name: string;
  basic: number | null;
  product: number | null;
  total: number | null;
}

export interface WbProduct {
  nmId: number;
  name: string;
  brand: string | null;
  subject: string | null;
  supplierId: number;
  supplierName: string | null;
  vendorCode: string | null;
  pics: number;
  rating: number | null;
  feedbacks: number | null;
  totalQuantity: number;
  priceBasic: number | null;
  priceProduct: number | null;
  priceTotal: number | null;
  sizes: WbSizePrice[];
}

export class WbApiError extends Error {
  status: number;
  url: string;
  constructor(status: number, url: string) {
    super(
      status === 403 || status === 498
        ? `WB заблокировал запрос (HTTP ${status}). ` +
          `Убедитесь, что Playwright установлен (npx playwright install chromium) ` +
          `или задайте WB_USE_FETCH=1 + WB_PROXY_URL.`
        : `WB API ответил HTTP ${status}`
    );
    this.status = status;
    this.url = url;
  }
}

/* ─── вспомогательное ────────────────────────────────────────────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toRub(kopecks: unknown): number | null {
  if (typeof kopecks !== "number" || !Number.isFinite(kopecks)) return null;
  return Math.round(kopecks / 100);
}

/** Использовать обычный fetch (true) или Playwright (false) */
function useFetch(): boolean {
  return process.env.WB_USE_FETCH === "1";
}

/* ─── HTTP-прокси (режим FETCH) ─────────────────────────────────────── */

function proxyMode(): "standard" | "prefix" | null {
  const val = (process.env.WB_PROXY_URL ?? "").trim();
  if (!val) return null;
  try {
    const u = new URL(val);
    if (u.hostname && u.port && (u.pathname === "/" || u.pathname === "")) {
      return "standard";
    }
  } catch { /* не URL — значит префикс */ }
  return "prefix";
}

let _proxyAgent: ProxyAgent | null = null;
function getProxyAgent(): ProxyAgent {
  if (_proxyAgent) return _proxyAgent;
  _proxyAgent = new ProxyAgent((process.env.WB_PROXY_URL ?? "").trim());
  return _proxyAgent;
}

async function fetchJsonHttp(url: string, attempt = 0): Promise<unknown> {
  const mode = proxyMode();
  let targetUrl = url;
  const opts: Record<string, unknown> = {
    headers: {
      "user-agent": UA,
      accept: "application/json, text/plain, */*",
      "accept-language": "ru-RU,ru;q=0.9",
      origin: "https://www.wildberries.ru",
      referer: "https://www.wildberries.ru/",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  };
  if (mode === "prefix") {
    targetUrl = `${process.env.WB_PROXY_URL}${encodeURIComponent(url)}`;
  } else if (mode === "standard") {
    opts.dispatcher = getProxyAgent();
  }
  const res = mode === "standard"
    ? await undiciFetch(targetUrl, opts as Parameters<typeof undiciFetch>[1])
    : await fetch(targetUrl, opts as RequestInit);

  if (!res.ok) {
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(700 * (attempt + 1));
      return fetchJsonHttp(url, attempt + 1);
    }
    throw new WbApiError(res.status, url);
  }
  return res.json();
}

/* ─── единая точка входа ─────────────────────────────────────────────── */

async function fetchJson(url: string): Promise<unknown> {
  if (useFetch()) {
    return fetchJsonHttp(url);
  }
  // Режим Playwright
  try {
    return await browserFetchJson(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("HTTP 403")) throw new WbApiError(403, url);
    if (msg.includes("HTTP 498")) throw new WbApiError(498, url);
    throw e;
  }
}

/* ─── маппер сырого продукта ─────────────────────────────────────────── */

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRawProduct(p: any): WbProduct {
  const sizes: WbSizePrice[] = Array.isArray(p?.sizes)
    ? p.sizes.map((s: any): WbSizePrice => {
        const price = s?.price ?? {};
        const product = toRub(price.product);
        return {
          name: String(s?.name ?? s?.origName ?? ""),
          basic: toRub(price.basic),
          product,
          total: toRub(price.total) ?? product,
        };
      })
    : [];

  const legacyBasic = toRub(p?.priceU);
  const legacyProduct = toRub(p?.salePriceU) ?? legacyBasic;

  const priced = sizes.filter((s) => s.product != null);
  const pick = (key: "basic" | "product" | "total") =>
    priced.length
      ? priced.reduce<number | null>(
          (min, s) =>
            s[key] != null && (min == null || s[key]! < min) ? s[key] : min,
          null
        )
      : null;

  return {
    nmId: Number(p?.id ?? p?.nmId),
    name: String(p?.name ?? ""),
    brand: p?.brand ?? null,
    subject: p?.subject ?? p?.subjectName ?? null,
    supplierId: Number(p?.supplierId ?? 0),
    supplierName: p?.supplier ?? null,
    vendorCode: p?.vendorCode ?? p?.vendor_code ?? null,
    pics: Number(p?.pics ?? 0),
    rating: typeof p?.reviewRating === "number" ? p.reviewRating : (p?.rating ?? null),
    feedbacks: p?.feedbacks ?? p?.nmFeedbacks ?? null,
    totalQuantity: Number(p?.totalQuantity ?? 0),
    priceBasic: pick("basic") ?? legacyBasic,
    priceProduct: pick("product") ?? legacyProduct,
    priceTotal: pick("total") ?? pick("product") ?? legacyProduct,
    sizes,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ─── публичные функции ──────────────────────────────────────────────── */

export async function fetchSellerCatalogPage(
  supplier: number,
  page: number,
  dest = DEFAULT_DEST
): Promise<WbProduct[]> {
  const url =
    `https://catalog.wb.ru/sellers/catalog?appType=1&curr=rub&dest=${dest}` +
    `&lang=ru&locale=ru&sort=popular&page=${page}&supplier=${supplier}&spp=0`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await fetchJson(url)) as any;
  const raw: unknown[] = json?.data?.products ?? json?.products ?? [];
  return (raw as any[])
    .map(mapRawProduct)
    .filter((p) => Number.isFinite(p.nmId) && p.nmId > 0);
}

export async function fetchCardsDetail(
  nmIds: number[],
  dest = DEFAULT_DEST,
  spp: number | null = null
): Promise<WbProduct[]> {
  if (!nmIds.length) return [];
  const sppPart = spp != null ? `&spp=${spp}` : "";
  const url =
    `https://card.wb.ru/cards/v4/detail?appType=1&curr=rub&dest=${dest}` +
    `&lang=ru&nm=${nmIds.join(";")}${sppPart}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await fetchJson(url)) as any;
  const raw: unknown[] = json?.data?.products ?? json?.products ?? [];
  return (raw as any[])
    .map(mapRawProduct)
    .filter((p) => Number.isFinite(p.nmId) && p.nmId > 0);
}

export async function enumerateSellerProducts(
  supplier: number,
  dest = DEFAULT_DEST,
  maxPages = 20,
  onPage?: (page: number, count: number) => void
): Promise<{ products: WbProduct[]; pages: number }> {
  const all: WbProduct[] = [];
  const seen = new Set<number>();
  let pages = 0;
  for (let page = 1; page <= maxPages; page++) {
    const batch = await fetchSellerCatalogPage(supplier, page, dest);
    pages = page;
    const fresh = batch.filter((p) => !seen.has(p.nmId));
    fresh.forEach((p) => seen.add(p.nmId));
    all.push(...fresh);
    onPage?.(page, fresh.length);
    if (batch.length < CHUNK_SIZE || fresh.length === 0) break;
    // В режиме Playwright не нужна дополнительная задержка — она внутри browserFetchJson
    if (useFetch()) await sleep(350);
  }
  return { products: all, pages };
}

export function basketHost(nmId: number): string {
  const vol = Math.floor(nmId / 100000);
  const ranges: Array<[number, number]> = [
    [143, 1], [287, 2], [431, 3], [719, 4], [1007, 5], [1061, 6],
    [1115, 7], [1169, 8], [1313, 9], [1601, 10], [1655, 11], [1919, 12],
    [2045, 13], [2189, 14], [2405, 15], [2621, 16], [2837, 17], [3053, 18],
    [3269, 19], [3485, 20], [3701, 21], [3917, 22], [4133, 23],
  ];
  const match = ranges.find(([max]) => vol <= max);
  return `basket-${String(match ? match[1] : 24).padStart(2, "0")}.wbbasket.ru`;
}

export function coverUrl(nmId: number): string {
  const vol = Math.floor(nmId / 100000);
  const part = Math.floor(nmId / 1000);
  return `https://${basketHost(nmId)}/vol${vol}/part${part}/${nmId}/images/big/1.webp`;
}

export async function fetchVendorCode(nmId: number): Promise<string | null> {
  try {
    const vol = Math.floor(nmId / 100000);
    const part = Math.floor(nmId / 1000);
    const url = `https://${basketHost(nmId)}/vol${vol}/part${part}/${nmId}/info/ru/card.json`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await fetchJson(url)) as any;
    return json?.vendor_code ?? json?.vendorCode ?? null;
  } catch {
    return null;
  }
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export { CHUNK_SIZE };
