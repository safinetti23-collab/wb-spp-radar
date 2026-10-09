import crypto from "node:crypto";
import type { ProductsResponse } from "@/lib/types";

/**
 * Интеграция с Google Sheets через сервисный аккаунт — без googleapis:
 * JWT (RS256) подписывается нативным crypto, дальше чистый REST API.
 *
 * Таблица должна быть расшарена (Editor) на email сервисного аккаунта.
 * Ключи из env:
 *   GOOGLE_SERVICE_ACCOUNT_JSON — полный JSON ключа (предпочтительно)
 * или
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY (переводы строк как \n)
 */

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

/* ===================== credentials ===================== */

interface Creds {
  email: string;
  key: string;
}

function readCreds(): Creds {
  const jsonEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  let email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "";
  let key = process.env.GOOGLE_PRIVATE_KEY ?? "";
  if (jsonEnv) {
    let parsed: { client_email?: string; private_key?: string } = {};
    try {
      parsed = JSON.parse(jsonEnv) as typeof parsed;
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON содержит невалидный JSON");
    }
    email = parsed.client_email ?? email;
    key = parsed.private_key ?? key;
  }
  if (!email || !key) {
    throw new Error(
      "Ключи Google не заданы. Укажите GOOGLE_SERVICE_ACCOUNT_JSON или пару GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY."
    );
  }
  return { email, key: key.replace(/\\n/g, "\n") };
}

export function googleCredsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY)
  );
}

export function serviceAccountEmail(): string | null {
  try {
    return readCreds().email;
  } catch {
    return process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null;
  }
}

/* ===================== OAuth2 (JWT bearer) ===================== */

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const { email, key } = readCreds();
  const now = Math.floor(Date.now() / 1000);
  const b64 = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: email,
    scope: SCOPES.join(" "),
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = crypto
    .sign("RSA-SHA256", Buffer.from(unsigned), key)
    .toString("base64url");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body:
      "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer" +
      `&assertion=${unsigned}.${signature}`,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Не удалось получить токен Google (HTTP ${res.status}). Проверьте ключ сервисного аккаунта. ${text.slice(0, 160)}`
    );
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

/* ===================== REST helpers ===================== */

async function gsApi<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const status = res.status;
    if (status === 404) throw new Error("SHEETS:NOT_FOUND");
    if (status === 403) throw new Error("SHEETS:FORBIDDEN");
    if (status === 400) throw new Error(`SHEETS:BAD_REQUEST:${text.slice(0, 240)}`);
    throw new Error(`Sheets API HTTP ${status}: ${text.slice(0, 240)}`);
  }
  return (await res.json()) as T;
}

const enc = encodeURIComponent;

interface SheetMeta {
  properties?: { title?: string };
  sheets?: Array<{ properties?: { title?: string; sheetId?: number } }>;
}

/* ===================== публичный API модуля ===================== */

export interface SheetTest {
  ok: boolean;
  title?: string;
  sheets?: string[];
  email?: string | null;
  message?: string;
}

/** Проверка доступа к таблице */
export async function testConnection(sheetId: string): Promise<SheetTest> {
  try {
    if (!sheetId) return { ok: false, message: "ID таблицы не задан" };
    const meta = await gsApi<SheetMeta>(
      `${enc(sheetId)}?fields=${enc("properties.title,sheets.properties.title")}`
    );
    return {
      ok: true,
      title: meta.properties?.title ?? sheetId,
      sheets: (meta.sheets ?? []).map((s) => s.properties?.title ?? "?"),
      email: serviceAccountEmail(),
    };
  } catch (e) {
    return { ok: false, message: friendlyError(e), email: serviceAccountEmail() };
  }
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg === "SHEETS:NOT_FOUND")
    return "Таблица не найдена — проверьте ID/ссылку.";
  if (msg === "SHEETS:FORBIDDEN")
    return "Нет доступа к таблице. Расшарьте её («Редактор») на email сервисного аккаунта.";
  if (msg.startsWith("SHEETS:BAD_REQUEST")) {
    return `Google отклонил запрос: ${msg.replace("SHEETS:BAD_REQUEST:", "")}`;
  }
  return msg;
}

async function ensureTab(
  sheetId: string,
  title: string
): Promise<{ numericId: number; meta: SheetMeta }> {
  const meta = await gsApi<SheetMeta>(`${enc(sheetId)}?fields=${enc("sheets.properties")}`);
  const found = (meta.sheets ?? []).find((s) => s.properties?.title === title);
  if (found?.properties?.sheetId != null) {
    return { numericId: found.properties.sheetId, meta };
  }
  const res = await gsApi<{
    replies?: Array<{ addSheet?: { properties?: { sheetId?: number } } }>;
  }>(`${enc(sheetId)}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
  const id = res.replies?.[0]?.addSheet?.properties?.sheetId;
  if (id == null) throw new Error(`Не удалось создать вкладку «${title}»`);
  return { numericId: id, meta };
}

type Cell = string | number;

function fmtNow(): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date());
}

const REPORT_HEADERS = [
  "Артикул WB",
  "Артикул продавца",
  "Название",
  "Бренд",
  "Категория",
  "Цена ЛК (закупочная), ₽",
  "Скидка продавца, %",
  "Цена ЛК со скидкой, ₽",
  "Сайт: до СПП, ₽",
  "СПП (соинвест), %",
  "Соинвест, ₽",
  "Цена покупателя, ₽",
  "Цена при СПП 30%, ₽",
  "Разница сайт−ЛК, ₽",
  "Остаток, шт",
  "Снято с сайта",
];

const HISTORY_HEADERS = [
  "Дата снимка",
  "Артикул WB",
  "Артикул продавца",
  "Название",
  "До СПП, ₽",
  "СПП, %",
  "Соинвест, ₽",
  "Цена покупателя, ₽",
  "Остаток, шт",
];

function num(v: number | null | undefined): number | "" {
  return v == null || !Number.isFinite(v) ? "" : Math.round(v);
}

function fmtIso(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export interface SheetExportResult {
  reportRows: number;
  historyRows: number;
  url: string;
}

/**
 * Выгрузка отчёта в Google Sheets:
 *  - вкладка «Отчёт» полностью перезаписывается свежим снимком цен;
 *  - вкладка «История» дополняется строками текущего прогона (таймсерия).
 */
export async function exportReportToSheets(
  report: ProductsResponse,
  opts: { sheetId: string; tabReport: string; tabHistory: string }
): Promise<SheetExportResult> {
  const { sheetId, tabReport, tabHistory } = opts;
  if (!sheetId) throw new Error("ID таблицы не задан");
  if (!report.rows.length)
    throw new Error("В базе нет товаров — сначала запустите парсинг");

  try {
    const supplierLabel =
      report.rows[0]?.supplierName ??
      String(report.suppliers[0]?.supplierId ?? "");

    /* ---- вкладка «Отчёт» ---- */
    const reportTab = await ensureTab(sheetId, tabReport);
    const values: Cell[][] = [
      [`СПП·Радар · отчёт по продавцу — ${supplierLabel}`],
      [
        `Сформировано: ${fmtNow()} · SKU: ${report.stats.total} · соинвест Σ ${report.stats.sumSppAmount} ₽ · средняя СПП: ${
          report.stats.avgSppPct ?? 0
        }% · снимок сайта: ${fmtIso(report.stats.lastFetchedAt)}`,
      ],
      REPORT_HEADERS,
      ...report.rows.map<Cell[]>((r) => [
        r.nmId,
        r.vendorCode ?? "",
        r.name,
        r.brand ?? "",
        r.subject ?? "",
        num(r.cabBasePrice),
        r.cabDiscountPct ?? "",
        num(r.cabSellerPrice),
        num(r.priceProduct),
        r.sppPercent ?? "",
        num(r.sppAmount),
        num(r.priceTotal),
        num(r.priceSppMax),
        num(r.siteVsCab),
        r.fetchedAt ? r.totalQty : "",
        fmtIso(r.fetchedAt),
      ]),
    ];

    await gsApi(`${enc(sheetId)}/values/${enc(`'${tabReport}'!A1:Z100000`)}:clear`, {
      method: "POST",
      body: "{}",
    });
    await gsApi(
      `${enc(sheetId)}/values/${enc(`'${tabReport}'!A1`)}?valueInputOption=USER_ENTERED`,
      { method: "PUT", body: JSON.stringify({ values }) }
    );

    /* ---- вкладка «История» (append) ---- */
    const historyTab = await ensureTab(sheetId, tabHistory);
    let hasHeader = false;
    try {
      const existing = await gsApi<{ values?: string[][] }>(
        `${enc(sheetId)}/values/${enc(`'${tabHistory}'!A1:A1`)}`
      );
      hasHeader = (existing.values?.[0]?.length ?? 0) > 0;
    } catch {
      hasHeader = false;
    }

    const snapDate = report.stats.lastFetchedAt ?? new Date().toISOString();
    const historyRows: Cell[][] = report.rows
      .filter((r) => r.fetchedAt)
      .map((r) => [
        fmtIso(snapDate),
        r.nmId,
        r.vendorCode ?? "",
        r.name,
        num(r.priceProduct),
        r.sppPercent ?? "",
        num(r.sppAmount),
        num(r.priceTotal),
        r.totalQty,
      ]);

    await gsApi(
      `${enc(sheetId)}/values/${enc(`'${tabHistory}'!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        body: JSON.stringify({
          values: [...(hasHeader ? [] : [HISTORY_HEADERS]), ...historyRows],
        }),
      }
    );

    /* ---- форматирование ---- */
    const headerBg = { red: 0.93, green: 0.89, blue: 0.98 };
    const requests: Array<Record<string, unknown>> = [
      {
        updateSheetProperties: {
          properties: {
            sheetId: reportTab.numericId,
            gridProperties: { frozenRowCount: 3 },
          },
          fields: "gridProperties.frozenRowCount",
        },
      },
      {
        repeatCell: {
          range: { sheetId: reportTab.numericId, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 12 } } },
          fields: "userEnteredFormat.textFormat",
        },
      },
      {
        repeatCell: {
          range: { sheetId: reportTab.numericId, startRowIndex: 2, endRowIndex: 3 },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true },
              backgroundColor: headerBg,
            },
          },
          fields: "userEnteredFormat",
        },
      },
      {
        autoResizeDimensions: {
          dimensions: {
            sheetId: reportTab.numericId,
            dimension: "COLUMNS",
            startIndex: 0,
            endIndex: REPORT_HEADERS.length,
          },
        },
      },
      {
        updateSheetProperties: {
          properties: {
            sheetId: historyTab.numericId,
            gridProperties: { frozenRowCount: 1 },
          },
          fields: "gridProperties.frozenRowCount",
        },
      },
      {
        repeatCell: {
          range: { sheetId: historyTab.numericId, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true },
              backgroundColor: headerBg,
            },
          },
          fields: "userEnteredFormat",
        },
      },
      {
        autoResizeDimensions: {
          dimensions: {
            sheetId: historyTab.numericId,
            dimension: "COLUMNS",
            startIndex: 0,
            endIndex: HISTORY_HEADERS.length,
          },
        },
      },
    ];
    await gsApi(`${enc(sheetId)}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests }),
    });

    return {
      reportRows: report.rows.length,
      historyRows: historyRows.length,
      url: `https://docs.google.com/spreadsheets/d/${sheetId}`,
    };
  } catch (e) {
    throw new Error(friendlyError(e));
  }
}
