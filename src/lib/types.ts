import type { ProductSizePrice } from "@/db/schema";

/** Строка отчёта: товар + последний снапшот цен + цена из ЛК WB */
export interface ReportRow {
  id: number;
  nmId: number;
  vendorCode: string | null;
  name: string;
  brand: string | null;
  subject: string | null;
  supplierName: string | null;
  pics: number;
  rating: number | null;
  feedbacks: number | null;
  coverUrl: string;

  // последний снапшот (сайт)
  fetchedAt: string | null;
  priceBasic: number | null;
  priceProduct: number | null;
  priceTotal: number | null;
  sppPercent: number | null;
  sppAmount: number | null;
  priceSppMax: number | null;
  priceWallet: number | null;
  totalQty: number;
  sizes: ProductSizePrice[];
  source: string | null;

  // дельта к предыдущему снапшоту
  prevProduct: number | null;
  prevTotal: number | null;
  deltaProduct: number | null;
  deltaTotal: number | null;

  // выгрузка из ЛК WB
  cabBasePrice: number | null;
  cabDiscountPct: number | null;
  cabSellerPrice: number | null;
  cabImportedAt: string | null;

  // вычисленные флаги
  siteVsCab: number | null; // priceProduct - cabSellerPrice
  flags: ReportFlag[];
}

export type ReportFlag =
  | "spp_high" // СПП/соинвест ≥ 10%
  | "below_cab" // сайт (до СПП) ниже цены продавца из ЛК — площадка доп. снижает
  | "above_cab"
  | "out_of_stock"
  | "price_up"
  | "price_down"
  | "no_snapshot"
  | "no_cabinet";

export interface ReportStats {
  total: number;
  withSnapshot: number;
  withSpp: number;
  avgSppPct: number | null;
  sumSppAmount: number;
  belowCab: number;
  outOfStock: number;
  priceUp: number;
  priceDown: number;
  lastFetchedAt: string | null;
}

export interface ProductsResponse {
  ok: boolean;
  rows: ReportRow[];
  stats: ReportStats;
  suppliers: { supplierId: number; supplierName: string | null; count: number }[];
  hasImport: boolean;
  lastImportAt: string | null;
}

export interface ParseResponse {
  ok: boolean;
  supplier: number;
  pages: number;
  found: number;
  upserted: number;
  snapshots: number;
  durationMs: number;
  errors: string[];
  message?: string;
}

export interface ImportResponse {
  ok: boolean;
  importId: number;
  rowCount: number;
  matchedCount: number;
  sheetName: string;
  columns: { nmId?: string; vendorCode?: string; basePrice?: string; discount?: string; sellerPrice?: string };
  message?: string;
}

export interface HistoryPoint {
  fetchedAt: string;
  priceProduct: number | null;
  priceTotal: number | null;
  priceBasic: number | null;
  sppPercent: number | null;
  totalQty: number;
}

export interface HistoryResponse {
  ok: boolean;
  history: HistoryPoint[];
  vendorCode: string | null;
  walletNote: string | null;
}

/* ---------- автоматизация ---------- */

export interface AutomationConfigDto {
  enabled: boolean;
  exportEnabled: boolean;
  intervalHours: number;
  supplier: number;
  sheetId: string;
  tabReport: string;
  tabHistory: string;
  lastRunAt: string | null;
  lastExportAt: string | null;
}

export interface JobRunDto {
  id: number;
  kind: string;
  trigger: string;
  status: string;
  supplier: number | null;
  rowsProcessed: number;
  snapshotsAdded: number;
  sheetRows: number;
  startedAt: string;
  finishedAt: string | null;
  message: string | null;
  error: string | null;
}

export interface AutomationResponse {
  ok: boolean;
  config: AutomationConfigDto;
  jobs: JobRunDto[];
  env: {
    googleCreds: boolean;
    wbProxy: boolean;
    cronSecret: boolean;
    serviceEmail: string | null;
  };
}

export interface PipelineRunResponse {
  ok: boolean;
  jobId: number;
  parse?: { found: number; snapshots: number; durationMs: number; errors: string[] };
  export?: { reportRows: number; historyRows: number; url: string };
  message?: string;
}

export interface SheetsExportResponse {
  ok: boolean;
  reportRows?: number;
  historyRows?: number;
  url?: string;
  message?: string;
}
