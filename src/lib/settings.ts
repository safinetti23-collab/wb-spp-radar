import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

export interface AutomationConfig {
  /** автопарсинг по расписанию */
  enabled: boolean;
  /** автовыгрузка в Google Sheets после парсинга */
  exportEnabled: boolean;
  intervalHours: number;
  supplier: number;
  sheetId: string;
  tabReport: string;
  tabHistory: string;
  lastRunAt: string | null;
  lastExportAt: string | null;
}

const DEFAULTS: AutomationConfig = {
  enabled: false,
  exportEnabled: true,
  intervalHours: 6,
  supplier: 12520,
  sheetId: "",
  tabReport: "Отчёт",
  tabHistory: "История",
  lastRunAt: null,
  lastExportAt: null,
};

const KEYS: Record<keyof AutomationConfig, string> = {
  enabled: "auto.enabled",
  exportEnabled: "auto.export",
  intervalHours: "auto.intervalH",
  supplier: "auto.supplier",
  sheetId: "sheets.id",
  tabReport: "sheets.tabReport",
  tabHistory: "sheets.tabHistory",
  lastRunAt: "auto.lastRunAt",
  lastExportAt: "auto.lastExportAt",
};

export async function getAutomation(): Promise<AutomationConfig> {
  const rows = await db.select().from(settings);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const cfg = { ...DEFAULTS };
  cfg.enabled = map.get(KEYS.enabled) === "1";
  cfg.exportEnabled = map.get(KEYS.exportEnabled) !== "0";
  cfg.intervalHours = Math.max(
    1,
    Math.min(168, Number(map.get(KEYS.intervalHours)) || DEFAULTS.intervalHours)
  );
  cfg.supplier = Math.max(1, Number(map.get(KEYS.supplier)) || DEFAULTS.supplier);
  cfg.sheetId = (map.get(KEYS.sheetId) ?? "").trim();
  cfg.tabReport = map.get(KEYS.tabReport) || DEFAULTS.tabReport;
  cfg.tabHistory = map.get(KEYS.tabHistory) || DEFAULTS.tabHistory;
  cfg.lastRunAt = map.get(KEYS.lastRunAt) ?? null;
  cfg.lastExportAt = map.get(KEYS.lastExportAt) ?? null;
  return cfg;
}

export async function patchAutomation(
  patch: Partial<AutomationConfig>
): Promise<void> {
  const now = new Date();
  const entries: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(patch) as Array<
    [keyof AutomationConfig, AutomationConfig[keyof AutomationConfig]]
  >) {
    if (!(k in KEYS) || v === undefined) continue;
    const val =
      typeof v === "boolean" ? (v ? "1" : "0") : v == null ? "" : String(v);
    entries.push([KEYS[k], val]);
  }
  for (const [key, value] of entries) {
    await db
      .insert(settings)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } });
  }
}

/** Извлекает ID таблицы из URL Google Sheets или возвращает как есть */
export function extractSheetId(input: string): string {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return (m ? m[1] : input).trim();
}
