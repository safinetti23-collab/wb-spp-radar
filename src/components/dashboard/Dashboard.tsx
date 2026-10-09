"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  BadgePercent,
  Bot,
  Calculator,
  CloudOff,
  Database,
  Eraser,
  FileDown,
  FileUp,
  Flame,
  Loader2,
  PackageX,
  Play,
  Radar,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Store,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { ProductsResponse, ReportRow } from "@/lib/types";
import { fmtDateTime, fmtNum, fmtPct, fmtRub, fmtRubSign } from "@/lib/format";
import PriceMathDrawer from "./PriceMathDrawer";
import ImportModal from "./ImportModal";
import AutomationModal from "./AutomationModal";
import {
  CardSkeleton,
  DeltaChip,
  SkeletonRows,
  Thumb,
  Toasts,
  type Toast,
} from "./atoms";

type Chip =
  | "all"
  | "spp"
  | "below"
  | "above"
  | "oos"
  | "up"
  | "down"
  | "nodata";

const CHIPS: Array<{ id: Chip; label: string }> = [
  { id: "all", label: "Все SKU" },
  { id: "spp", label: "Соинвест ≥ 10%" },
  { id: "below", label: "Сайт ниже ЛК" },
  { id: "above", label: "Выше ЛК" },
  { id: "oos", label: "Нет остатков" },
  { id: "down", label: "Цена упала" },
  { id: "up", label: "Цена выросла" },
  { id: "nodata", label: "Без данных" },
];

const SORTS = [
  { id: "spp", label: "Соинвест ₽ ↓" },
  { id: "sppPct", label: "СПП % ↓" },
  { id: "buyer", label: "Цена покупателя ↑" },
  { id: "diff", label: "Сайт ниже ЛК ↓" },
  { id: "name", label: "Название А–Я" },
  { id: "qty", label: "Остаток ↓" },
] as const;

let toastSeq = 1;

export default function Dashboard() {
  const [data, setData] = useState<ProductsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [parseElapsed, setParseElapsed] = useState(0);
  const [demoing, setDemoing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [drawerRow, setDrawerRow] = useState<ReportRow | null>(null);

  const [supplierSel, setSupplierSel] = useState<string>("all");
  const [parseSupplier, setParseSupplier] = useState("12520");
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<Chip>("all");
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("spp");

  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = useCallback((kind: Toast["kind"], text: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5200);
  }, []);
  const dismissToast = useCallback(
    (id: number) => setToasts((t) => t.filter((x) => x.id !== id)),
    []
  );

  const parseTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // восстановить выбор продавца
  useEffect(() => {
    const saved = window.localStorage.getItem("spp-radar-supplier");
    if (saved) setSupplierSel(saved);
    const savedParse = window.localStorage.getItem("spp-radar-parse-supplier");
    if (savedParse) setParseSupplier(savedParse);
  }, []);

  const load = useCallback(async (supplier: string, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const qs = supplier !== "all" ? `?supplier=${encodeURIComponent(supplier)}` : "";
      const res = await fetch(`/api/products${qs}`, { cache: "no-store" });
      const json = (await res.json()) as ProductsResponse;
      setData(json);
    } catch {
      pushToast("err", "Не удалось загрузить отчёт из базы");
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    load(supplierSel, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeSupplier = (v: string) => {
    setSupplierSel(v);
    window.localStorage.setItem("spp-radar-supplier", v);
    load(v);
  };

  const runParse = async () => {
    const supplier = Math.max(1, Number(parseSupplier) || 12520);
    window.localStorage.setItem("spp-radar-parse-supplier", String(supplier));
    setParsing(true);
    setParseError(null);
    setParseElapsed(0);
    parseTimer.current = setInterval(() => setParseElapsed((s) => s + 1), 1000);
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ supplier }),
      });
      const json = await res.json();
      if (json.ok) {
        pushToast(
          "ok",
          `Парсинг завершён: ${json.found} SKU, ${json.snapshots} точек цен за ${(json.durationMs / 1000).toFixed(0)} c${
            json.errors?.length ? ` · предупреждений: ${json.errors.length}` : ""
          }`
        );
        setSupplierSel(String(supplier));
        window.localStorage.setItem("spp-radar-supplier", String(supplier));
        await load(String(supplier));
      } else {
        setParseError(json.message ?? "Парсинг не удался");
      }
    } catch {
      setParseError("Сеть недоступна или сервер перезапускается — попробуйте ещё раз");
    } finally {
      if (parseTimer.current) clearInterval(parseTimer.current);
      setParsing(false);
    }
  };

  const seedDemo = async () => {
    setDemoing(true);
    try {
      const res = await fetch("/api/demo", { method: "POST" });
      const json = await res.json();
      if (json.ok) {
        pushToast("ok", json.message);
        await load(supplierSel);
      } else pushToast("err", json.message ?? "Демо-данные не созданы");
    } catch {
      pushToast("err", "Не удалось создать демо-данные");
    } finally {
      setDemoing(false);
    }
  };

  const clearAll = async () => {
    if (!window.confirm("Удалить все товары, снапшоты и импорты из базы?")) return;
    setClearing(true);
    try {
      const res = await fetch("/api/demo", { method: "DELETE" });
      const json = await res.json();
      if (json.ok) {
        pushToast("info", "База очищена");
        setData(null);
        await load(supplierSel);
      }
    } catch {
      pushToast("err", "Не удалось очистить базу");
    } finally {
      setClearing(false);
    }
  };

  /* ---------- фильтрация и сортировка ---------- */
  const rows = useMemo(() => {
    let list = data?.rows ?? [];
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          String(r.nmId).includes(q) ||
          (r.vendorCode ?? "").toLowerCase().includes(q) ||
          (r.brand ?? "").toLowerCase().includes(q)
      );
    }
    switch (chip) {
      case "spp": list = list.filter((r) => (r.sppPercent ?? 0) >= 10); break;
      case "below": list = list.filter((r) => r.flags.includes("below_cab")); break;
      case "above": list = list.filter((r) => r.flags.includes("above_cab")); break;
      case "oos": list = list.filter((r) => r.flags.includes("out_of_stock")); break;
      case "up": list = list.filter((r) => r.flags.includes("price_up")); break;
      case "down": list = list.filter((r) => r.flags.includes("price_down")); break;
      case "nodata": list = list.filter((r) => r.flags.includes("no_snapshot")); break;
      default: break;
    }
    const copy = [...list];
    switch (sort) {
      case "sppPct": copy.sort((a, b) => (b.sppPercent ?? 0) - (a.sppPercent ?? 0)); break;
      case "buyer": copy.sort((a, b) => (a.priceTotal ?? Infinity) - (b.priceTotal ?? Infinity)); break;
      case "diff": copy.sort((a, b) => (a.siteVsCab ?? Infinity) - (b.siteVsCab ?? Infinity)); break;
      case "name": copy.sort((a, b) => a.name.localeCompare(b.name, "ru")); break;
      case "qty": copy.sort((a, b) => (b.totalQty ?? 0) - (a.totalQty ?? 0)); break;
      default: copy.sort((a, b) => (b.sppAmount ?? 0) - (a.sppAmount ?? 0));
    }
    return copy;
  }, [data, query, chip, sort]);

  /* ---------- экспорт CSV ---------- */
  const exportCsv = () => {
    if (!rows.length) return pushToast("info", "Нет строк для экспорта");
    const head = [
      "Артикул WB", "Артикул продавца", "Название", "Бренд", "Категория",
      "Цена ЛК (закупочная)", "Скидка продавца %", "Цена ЛК со скидкой",
      "Сайт: до СПП", "СПП % (соинвест)", "Соинвест ₽", "Цена покупателя",
      "Цена при СПП 30%", "Разница сайт−ЛК", "Остаток", "Снято с сайта",
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = rows.map((r) =>
      [
        r.nmId, r.vendorCode ?? "", r.name, r.brand ?? "", r.subject ?? "",
        r.cabBasePrice ?? "", r.cabDiscountPct ?? "", r.cabSellerPrice ?? "",
        r.priceProduct ?? "", r.sppPercent ?? "", r.sppAmount ?? "",
        r.priceTotal ?? "", r.priceSppMax ?? "", r.siteVsCab ?? "",
        r.totalQty, r.fetchedAt ? fmtDateTime(r.fetchedAt) : "",
      ].map(esc).join(";")
    );
    const csv = "\uFEFF" + head.map(esc).join(";") + "\n" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `spp-radar-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    pushToast("ok", `Экспортировано строк: ${rows.length}`);
  };

  const stats = data?.stats;
  const hasRows = (data?.rows.length ?? 0) > 0;
  const isDemo = data?.rows.some((r) => r.source === "demo") ?? false;

  return (
    <div className="mx-auto max-w-[1500px] px-4 pb-24 pt-6 sm:px-6 lg:px-8">
      {/* ===================== ШАПКА ===================== */}
      <header className="fade-up flex flex-wrap items-center gap-4">
        <div className="relative flex h-12 w-12 items-center justify-center">
          <span className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 opacity-90" />
          <span className="absolute inset-0 rounded-2xl animate-pulse-ring border border-violet-400/60" />
          <Radar className="relative h-6 w-6 text-white" />
        </div>
        <div className="mr-auto">
          <h1 className="text-2xl font-black leading-none tracking-tight">
            <span className="text-gradient">СПП·Радар</span>
          </h1>
          <p className="mt-1.5 text-[13px] text-zinc-500">
            парсинг цен Wildberries · полная математика цены · соинвестиция площадки
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={supplierSel}
            onChange={(e) => changeSupplier(e.target.value)}
            className="glass rounded-xl px-3 py-2.5 text-sm text-zinc-200 outline-none transition hover:border-violet-400/30"
            title="Продавцы в базе"
          >
            <option value="all">Все продавцы</option>
            {(data?.suppliers ?? []).map((s) => (
              <option key={s.supplierId} value={String(s.supplierId)}>
                {s.supplierName ?? `Продавец ${s.supplierId}`} · {s.count}
              </option>
            ))}
          </select>

          <div className="glass flex items-center rounded-xl">
            <span className="pl-3 text-[11px] uppercase tracking-wider text-zinc-500">ID</span>
            <input
              value={parseSupplier}
              onChange={(e) => setParseSupplier(e.target.value.replace(/[^\d]/g, ""))}
              className="w-20 bg-transparent px-2 py-2.5 text-sm tabular text-zinc-100 outline-none placeholder:text-zinc-600"
              placeholder="12520"
              inputMode="numeric"
            />
          </div>

          <button
            onClick={runParse}
            disabled={parsing}
            className="group relative overflow-hidden rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition hover:brightness-110 disabled:opacity-60"
          >
            <span className="relative flex items-center gap-2">
              {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {parsing ? `Парсим… ${parseElapsed}с` : "Парсить цены"}
            </span>
          </button>

          <button
            onClick={() => setImportOpen(true)}
            className="glass rounded-xl px-3.5 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-violet-400/30"
            title="Загрузить выгрузку цен из личного кабинета WB (.xlsx/.csv)"
          >
            <span className="flex items-center gap-2">
              <FileUp className="h-4 w-4 text-violet-300" /> Выгрузка ЛК
            </span>
          </button>

          <button
            onClick={seedDemo}
            disabled={demoing}
            className="glass rounded-xl px-3.5 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-fuchsia-400/30 disabled:opacity-60"
            title="Заполнить базу учебными данными, пока нет доступа к WB"
          >
            <span className="flex items-center gap-2">
              {demoing ? <Loader2 className="h-4 w-4 animate-spin text-fuchsia-300" /> : <Sparkles className="h-4 w-4 text-fuchsia-300" />}
              Демо
            </span>
          </button>

          <button
            onClick={() => setAutomationOpen(true)}
            className="glass rounded-xl px-3.5 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-violet-400/40"
            title="Расписание парсинга и выгрузка в Google Sheets"
          >
            <span className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-violet-300" /> Автоматика
            </span>
          </button>

          <button
            onClick={exportCsv}
            className="glass rounded-xl px-3.5 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-emerald-400/30"
            title="Экспорт отчёта в CSV"
          >
            <span className="flex items-center gap-2">
              <FileDown className="h-4 w-4 text-emerald-300" /> CSV
            </span>
          </button>

          <button
            onClick={clearAll}
            disabled={clearing}
            className="glass rounded-xl px-3 py-2.5 text-zinc-400 transition hover:border-rose-400/30 hover:text-rose-300 disabled:opacity-60"
            title="Очистить базу"
          >
            {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eraser className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* ===================== БАННЕР ОШИБКИ ПАРСИНГА ===================== */}
      {parseError && (
        <div className="fade-up mt-5 rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] p-4">
          <div className="flex items-start gap-3">
            <CloudOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <div className="flex-1 text-sm leading-relaxed text-amber-100/90">
              <p className="font-semibold text-amber-200">{parseError}</p>
              <p className="mt-1 text-amber-100/70">
                Wildberries блокирует запросы с датацентровых IP (HTTP 403/498). Варианты решения:
              </p>
              <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-amber-100/70">
                <li>
                  задать переменную окружения <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[12px]">WB_PROXY_URL</code> — подстановка перед URL запроса (резидентный прокси);
                </li>
                <li>запускать приложение с машины/сети с «домашним» IP;</li>
                <li>либо нажать «Демо» и изучить отчёт на учебных данных.</li>
              </ul>
            </div>
            <button
              onClick={() => setParseError(null)}
              className="rounded-lg px-2 py-1 text-xs text-amber-300/70 transition hover:bg-white/5"
            >
              Скрыть
            </button>
          </div>
        </div>
      )}

      {isDemo && (
        <div className="fade-up mt-5 flex items-center gap-3 rounded-2xl border border-fuchsia-400/20 bg-fuchsia-400/[0.06] px-4 py-3 text-sm text-fuchsia-200/90">
          <Sparkles className="h-4 w-4 shrink-0 text-fuchsia-300" />
          Сейчас показаны демо-данные. Запустите «Парсить цены», когда будет доступ к API Wildberries, — отчёт пересоберётся на реальных ценах.
        </div>
      )}

      {/* ===================== СТАТИСТИКА ===================== */}
      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {loading && !data ? (
          <>
            <CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton />
          </>
        ) : (
          <>
            <StatCard
              icon={<Database className="h-4 w-4 text-violet-300" />}
              label="SKU на мониторинге"
              value={fmtNum(stats?.total)}
              sub={`с ценами сайта: ${fmtNum(stats?.withSnapshot)}`}
              delay={0}
            />
            <StatCard
              icon={<BadgePercent className="h-4 w-4 text-fuchsia-300" />}
              label="Средняя скидка WB (СПП)"
              value={stats?.avgSppPct != null ? fmtPct(stats.avgSppPct) : "—"}
              sub={`SKU со скидкой: ${fmtNum(stats?.withSpp)}`}
              delay={0.05}
              accent="fuchsia"
            />
            <StatCard
              icon={<Flame className="h-4 w-4 text-orange-300" />}
              label="Σ соинвеста площадки"
              value={`${fmtRub(stats?.sumSppAmount)} ₽`}
              sub="скидка WB суммарно по всем SKU"
              delay={0.1}
              accent="orange"
            />
            <StatCard
              icon={<SlidersHorizontal className="h-4 w-4 text-amber-300" />}
              label="Сайт ниже ЛК"
              value={fmtNum(stats?.belowCab)}
              sub={`площадка доп. снижает цену · без остатков: ${fmtNum(stats?.outOfStock)}`}
              delay={0.15}
              accent="amber"
            />
            <StatCard
              icon={<RefreshCw className="h-4 w-4 text-emerald-300" />}
              label="Последний снимок цен"
              value={stats?.lastFetchedAt ? fmtDateTime(stats.lastFetchedAt) : "—"}
              sub={
                data?.hasImport
                  ? `выгрузка ЛК: ${fmtDateTime(data.lastImportAt)}`
                  : "выгрузка ЛК не загружена"
              }
              delay={0.2}
              accent="emerald"
            />
          </>
        )}
      </section>

      {/* ===================== ОТЧЁТ ===================== */}
      {loading && !data ? (
        <div className="glass mt-6 overflow-hidden rounded-2xl">
          <SkeletonRows />
        </div>
      ) : !hasRows ? (
        <EmptyState
          onParse={runParse}
          onDemo={seedDemo}
          onImport={() => setImportOpen(true)}
          parsing={parsing}
          demoing={demoing}
          elapsed={parseElapsed}
        />
      ) : (
        <ReportTable
          rows={rows}
          total={data?.rows.length ?? 0}
          query={query}
          setQuery={setQuery}
          chip={chip}
          setChip={setChip}
          sort={sort}
          setSort={setSort}
          onOpen={setDrawerRow}
          onRefresh={() => load(supplierSel)}
        />
      )}

      {/* ===================== МЕТОДОЛОГИЯ ===================== */}
      <Methodology />

      <PriceMathDrawer row={drawerRow} onClose={() => setDrawerRow(null)} />
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => load(supplierSel)}
        pushToast={pushToast}
      />
      <AutomationModal
        open={automationOpen}
        onClose={() => setAutomationOpen(false)}
        onChanged={() => load(supplierSel)}
        pushToast={pushToast}
      />
      <Toasts toasts={toasts} dismiss={dismissToast} />
    </div>
  );
}

/* ===================== карточка статистики ===================== */
function StatCard({
  icon,
  label,
  value,
  sub,
  delay,
  accent = "violet",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  delay: number;
  accent?: "violet" | "fuchsia" | "orange" | "amber" | "emerald";
}) {
  const glow: Record<string, string> = {
    violet: "from-violet-500/12",
    fuchsia: "from-fuchsia-500/12",
    orange: "from-orange-500/12",
    amber: "from-amber-500/12",
    emerald: "from-emerald-500/12",
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className={`glass ring-hover relative overflow-hidden rounded-2xl bg-gradient-to-br ${glow[accent]} to-transparent p-5`}
    >
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {icon} {label}
      </div>
      <div className="tabular mt-2.5 font-mono text-[26px] font-bold leading-none text-zinc-50">
        {value}
      </div>
      <div className="mt-2 text-[12px] leading-snug text-zinc-500">{sub}</div>
    </motion.div>
  );
}

/* ===================== таблица отчёта ===================== */
function ReportTable({
  rows,
  total,
  query,
  setQuery,
  chip,
  setChip,
  sort,
  setSort,
  onOpen,
  onRefresh,
}: {
  rows: ReportRow[];
  total: number;
  query: string;
  setQuery: (v: string) => void;
  chip: Chip;
  setChip: (v: Chip) => void;
  sort: string;
  setSort: (v: (typeof SORTS)[number]["id"]) => void;
  onOpen: (r: ReportRow) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="fade-up mt-6">
      {/* контролы */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="glass flex min-w-56 flex-1 items-center gap-2 rounded-xl px-3">
          <Search className="h-4 w-4 shrink-0 text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск: название, артикул WB, артикул продавца, бренд…"
            className="w-full bg-transparent py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as (typeof SORTS)[number]["id"])}
          className="glass rounded-xl px-3 py-2.5 text-sm text-zinc-200 outline-none"
        >
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        <button
          onClick={onRefresh}
          className="glass rounded-xl p-2.5 text-zinc-400 transition hover:border-violet-400/30 hover:text-violet-300"
          title="Обновить отчёт"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {CHIPS.map((c) => (
          <button
            key={c.id}
            onClick={() => setChip(c.id)}
            className={`rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition ${
              chip === c.id
                ? "border-violet-400/50 bg-violet-500/20 text-violet-100"
                : "border-white/[0.07] bg-white/[0.02] text-zinc-400 hover:border-white/15 hover:text-zinc-200"
            }`}
          >
            {c.label}
          </button>
        ))}
        <span className="ml-auto self-center text-[12px] tabular text-zinc-600">
          показано {rows.length} из {total}
        </span>
      </div>

      {/* таблица */}
      <div className="glass overflow-hidden rounded-2xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-collapse text-left">
            <thead>
              <tr className="border-b border-white/[0.07] text-[10.5px] font-semibold uppercase tracking-[0.13em] text-zinc-500">
                <th className="px-5 py-3.5">SKU · товар</th>
                <th className="px-3 py-3.5">
                  Цена из ЛК
                  <Hint text="Цена продавца со скидкой из выгрузки личного кабинета. Соинвестиции площадки там нет — поэтому сверяем с сайтом." />
                </th>
                <th className="px-3 py-3.5">
                  Сайт: до СПП
                  <Hint text="Цена на сайте до скидки WB — по факту ваша цена со скидкой. Отклонение от ЛК означает доп. вмешательство площадки." />
                </th>
                <th className="px-3 py-3.5">
                  СПП · соинвест
                  <Hint text="Фактическая скидка WB: разница между ценой до СПП и ценой, которую отдал сервер при анонимном запросе. СПП персональна (0–30%)." />
                </th>
                <th className="px-3 py-3.5">Покупатель</th>
                <th className="px-3 py-3.5">Δ цены</th>
                <th className="px-3 py-3.5">Остаток</th>
                <th className="px-4 py-3.5 text-right">Снято</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {rows.map((r, i) => (
                <motion.tr
                  key={r.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.02, 0.4), duration: 0.4 }}
                  onClick={() => onOpen(r)}
                  className="group cursor-pointer transition-colors hover:bg-white/[0.03]"
                >
                  {/* товар */}
                  <td className="px-5 py-3">
                    <div className="flex max-w-[380px] items-center gap-3">
                      <Thumb src={r.coverUrl} label={r.brand ?? r.name} />
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-medium text-zinc-100">
                          {r.name}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-zinc-500">
                          <a
                            href={`https://www.wildberries.ru/catalog/${r.nmId}/detail.aspx`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="tabular font-mono transition hover:text-violet-300"
                            title="Открыть на Wildberries"
                          >
                            {r.nmId}
                          </a>
                          {r.vendorCode && (
                            <span className="rounded bg-white/[0.05] px-1.5 py-px font-mono text-[10.5px] text-zinc-400">
                              {r.vendorCode}
                            </span>
                          )}
                          {r.brand && <span className="hidden xl:inline">· {r.brand}</span>}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* цена ЛК */}
                  <td className="px-3 py-3">
                    {r.cabSellerPrice != null ? (
                      <>
                        <div className="tabular font-mono text-[14px] font-semibold text-zinc-200">
                          {fmtRub(r.cabSellerPrice)} ₽
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
                          {r.cabBasePrice != null && (
                            <span className="tabular line-through decoration-zinc-600">
                              {fmtRub(r.cabBasePrice)}
                            </span>
                          )}
                          {r.cabDiscountPct != null && (
                            <span className="text-zinc-400">−{fmtPct(r.cabDiscountPct, 0)}</span>
                          )}
                        </div>
                      </>
                    ) : (
                      <span className="text-[12px] text-zinc-600">нет выгрузки</span>
                    )}
                  </td>

                  {/* сайт до СПП */}
                  <td className="px-3 py-3">
                    <div className="tabular font-mono text-[14px] font-semibold text-zinc-100">
                      {fmtRub(r.priceProduct)} ₽
                    </div>
                    <SiteVsCab row={r} />
                  </td>

                  {/* СПП + соинвест */}
                  <td className="px-3 py-3">
                    <SppCell row={r} />
                  </td>

                  {/* покупатель */}
                  <td className="px-3 py-3">
                    <div className="tabular font-mono text-[15px] font-bold text-zinc-50">
                      {fmtRub(r.priceTotal)} ₽
                    </div>
                    {r.priceSppMax != null && r.priceSppMax !== r.priceTotal && (
                      <div className="mt-0.5 text-[11px] tabular text-zinc-500">
                        при СПП 30% → {fmtRub(r.priceSppMax)} ₽
                      </div>
                    )}
                  </td>

                  {/* дельта */}
                  <td className="px-3 py-3">
                    <DeltaChip delta={r.deltaTotal} />
                  </td>

                  {/* остаток */}
                  <td className="px-3 py-3">
                    {r.fetchedAt == null ? (
                      <span className="text-[12px] text-zinc-600">—</span>
                    ) : r.totalQty <= 0 ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/25 bg-rose-400/10 px-2 py-0.5 text-[11px] font-semibold text-rose-300">
                        <PackageX className="h-3 w-3" /> 0 шт
                      </span>
                    ) : (
                      <span className="tabular font-mono text-[13px] text-zinc-300">
                        {fmtNum(r.totalQty)}
                      </span>
                    )}
                  </td>

                  {/* дата */}
                  <td className="px-4 py-3 text-right text-[12px] tabular text-zinc-500">
                    {fmtDateTime(r.fetchedAt)}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <div className="px-6 py-14 text-center text-sm text-zinc-500">
            По текущим фильтрам ничего не найдено
          </div>
        )}
      </div>
    </section>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <span className="group/h relative ml-1 inline-block align-middle text-zinc-600 hover:text-violet-300">
      ⓘ
      <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 hidden w-64 -translate-x-1/2 rounded-xl border border-white/10 bg-[#14161e] p-3 text-[11px] normal-case tracking-normal text-zinc-300 shadow-2xl group-hover/h:block">
        {text}
      </span>
    </span>
  );
}

function SiteVsCab({ row }: { row: ReportRow }) {
  if (row.siteVsCab == null) {
    return <span className="mt-0.5 block text-[11px] text-zinc-600">сверка с ЛК недоступна</span>;
  }
  if (Math.abs(row.siteVsCab) < 2) {
    return <span className="mt-0.5 block text-[11px] text-zinc-600">совпадает с ЛК</span>;
  }
  const below = row.siteVsCab < 0;
  return (
    <span
      className={`mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold tabular ${
        below ? "text-amber-300" : "text-sky-300"
      }`}
    >
      {below ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
      {fmtRubSign(row.siteVsCab)} ₽ к ЛК {below && "· площадка режет"}
    </span>
  );
}

function SppCell({ row }: { row: ReportRow }) {
  const spp = row.sppPercent ?? 0;
  const amount = row.sppAmount ?? 0;
  if (row.priceProduct == null) return <span className="text-[12px] text-zinc-600">—</span>;
  if (spp <= 0.01) {
    return (
      <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11.5px] font-medium text-zinc-400">
        0% · без соинвеста
      </span>
    );
  }
  const width = Math.min(100, (spp / 30) * 100);
  return (
    <div className="min-w-[132px]">
      <div className="flex items-baseline gap-2">
        <span className="tabular font-mono text-[14px] font-bold text-violet-300">
          {fmtPct(spp)}
        </span>
        <span className="tabular text-[12px] font-semibold text-fuchsia-300/90">
          −{fmtRub(amount)} ₽
        </span>
      </div>
      <div className="mt-1.5 h-1 w-28 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="spp-bar h-full rounded-full" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

/* ===================== пустое состояние ===================== */
function EmptyState({
  onParse,
  onDemo,
  onImport,
  parsing,
  demoing,
  elapsed,
}: {
  onParse: () => void;
  onDemo: () => void;
  onImport: () => void;
  parsing: boolean;
  demoing: boolean;
  elapsed: number;
}) {
  return (
    <div className="fade-up mt-6">
      <div className="glass relative overflow-hidden rounded-3xl px-6 py-16 text-center sm:py-20">
        <div className="absolute -left-24 -top-24 h-72 w-72 animate-float rounded-full bg-violet-500/15 blur-3xl" />
        <div className="absolute -bottom-24 -right-16 h-72 w-72 animate-float rounded-full bg-fuchsia-500/12 blur-3xl [animation-delay:1.8s]" />
        <div className="relative mx-auto flex h-16 w-16 items-center justify-center">
          <span className="absolute inset-0 rounded-3xl bg-gradient-to-br from-violet-500 to-fuchsia-500 opacity-90" />
          <span className="absolute inset-0 animate-pulse-ring rounded-3xl border border-violet-400/60" />
          <Radar className="relative h-8 w-8 text-white" />
        </div>
        <h2 className="relative mx-auto mt-7 max-w-2xl text-3xl font-black tracking-tight text-zinc-50 sm:text-4xl">
          Покажем площадку <span className="text-gradient">в настоящих ценах</span>
        </h2>
        <p className="relative mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-zinc-400">
          Парсер снимет цены всех SKU продавца прямо с сайта Wildberries, сверит их с выгрузкой из
          личного кабинета и покажет полную математику цены: скидка продавца → цена до СПП →
          соинвестиция WB → цена покупателя.
        </p>
        <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={onParse}
            disabled={parsing}
            className="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/30 transition hover:brightness-110 disabled:opacity-60"
          >
            <span className="flex items-center gap-2">
              {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {parsing ? `Парсим каталог… ${elapsed}с` : "Запустить парсинг продавца 12520"}
            </span>
          </button>
          <button
            onClick={onDemo}
            disabled={demoing}
            className="glass rounded-xl px-6 py-3 text-sm font-semibold text-zinc-100 transition hover:border-fuchsia-400/40 disabled:opacity-60"
          >
            <span className="flex items-center gap-2">
              {demoing ? <Loader2 className="h-4 w-4 animate-spin text-fuchsia-300" /> : <Sparkles className="h-4 w-4 text-fuchsia-300" />}
              Собрать демо-отчёт
            </span>
          </button>
          <button
            onClick={onImport}
            className="glass rounded-xl px-6 py-3 text-sm font-medium text-zinc-300 transition hover:border-violet-400/30"
          >
            <span className="flex items-center gap-2">
              <FileUp className="h-4 w-4 text-violet-300" /> Загрузить выгрузку ЛК
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===================== методология ===================== */
function Methodology() {
  const items = [
    {
      icon: <Store className="h-5 w-5 text-violet-300" />,
      title: "1 · Снимаем цены с сайта",
      text: "Публичные API WB: каталог продавца + карточки товаров батчами по 100 SKU. Для каждого товара берём закупочную цену, цену до СПП и финальную цену сервера.",
    },
    {
      icon: <FileUp className="h-5 w-5 text-fuchsia-300" />,
      title: "2 · Сверяем с личным кабинетом",
      text: "Загрузите выгрузку «Цены и скидки» из ЛК WB (.xlsx/.csv). В ней соинвестиции площадки нет — поэтому она становится эталоном ваших цен для сравнения.",
    },
    {
      icon: <Calculator className="h-5 w-5 text-emerald-300" />,
      title: "3 · Считаем полную математику",
      text: "Цена ЛК → скидка продавца → до СПП на сайте → скидка WB (соинвест) → цена покупателя. Отклонение «сайт ниже ЛК» ловит доп. снижения со стороны площадки.",
    },
  ];
  return (
    <section className="mt-10">
      <div className="grid gap-3 md:grid-cols-3">
        {items.map((it, i) => (
          <motion.div
            key={it.title}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: i * 0.08, duration: 0.55 }}
            className="glass ring-hover rounded-2xl p-5"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
              {it.icon}
            </div>
            <h3 className="mt-4 text-[15px] font-bold text-zinc-100">{it.title}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-500">{it.text}</p>
          </motion.div>
        ))}
      </div>
      <p className="mt-6 text-center text-[12px] leading-relaxed text-zinc-600">
        СПП (скидка WB) — персональная скидка 0–30%, зависит от покупателя. Радар измеряет её так, как
        видит анонимный посетитель сайта, и показывает сценарий максимальной скидки. Регион снятия
        цен: Москва (dest −1257786). Скидка при оплате «WB Кошельком» в открытый API не выдаётся.
      </p>
    </section>
  );
}
