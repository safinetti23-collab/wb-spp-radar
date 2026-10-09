"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  BadgePercent,
  Flame,
  Loader2,
  Star,
  Store,
  Tags,
  Wallet,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HistoryResponse, ReportRow } from "@/lib/types";
import { fmtDateTime, fmtNum, fmtPct, fmtRub } from "@/lib/format";
import { Thumb } from "./atoms";

/**
 * Прайсинг-панель: полная математика цены SKU —
 * цена ЛК → скидка продавца → до СПП → соинвест WB → цена покупателя,
 * плюс сценарий СПП, история цен, размеры.
 */
export default function PriceMathDrawer({
  row,
  onClose,
}: {
  row: ReportRow | null;
  onClose: () => void;
}) {
  const [hist, setHist] = useState<HistoryResponse | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const [scenario, setScenario] = useState(15);

  useEffect(() => {
    if (!row) return;
    setHist(null);
    setHistLoading(true);
    setScenario(Math.max(row.sppPercent ?? 0, 15));
    document.body.style.overflow = "hidden";
    let cancelled = false;
    fetch(`/api/products/${row.nmId}/history`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: HistoryResponse) => {
        if (!cancelled) setHist(j);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setHistLoading(false);
      });
    return () => {
      cancelled = true;
      document.body.style.overflow = "";
    };
  }, [row]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chartData = useMemo(
    () =>
      (hist?.history ?? []).map((h) => ({
        d: fmtDateTime(h.fetchedAt),
        product: h.priceProduct,
        total: h.priceTotal,
        qty: h.totalQty,
      })),
    [hist]
  );

  return (
    <AnimatePresence>
      {row && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[70] bg-black/65 backdrop-blur-sm"
          />
          <motion.aside
            key="panel"
            initial={{ x: "104%" }}
            animate={{ x: 0 }}
            exit={{ x: "104%" }}
            transition={{ type: "spring", stiffness: 300, damping: 34 }}
            className="fixed inset-y-0 right-0 z-[80] flex w-[min(620px,96vw)] flex-col border-l border-white/10 bg-[#0c0d13]/97 shadow-2xl"
          >
            {/* шапка */}
            <div className="flex items-start gap-4 border-b border-white/[0.07] p-5">
              <Thumb src={row.coverUrl} label={row.brand ?? row.name} />
              <div className="min-w-0 flex-1">
                <h2 className="truncate pr-6 text-[17px] font-bold text-zinc-50">{row.name}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-zinc-500">
                  <a
                    href={`https://www.wildberries.ru/catalog/${row.nmId}/detail.aspx`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono tabular text-violet-300 transition hover:text-violet-200"
                  >
                    {row.nmId} <ArrowUpRight className="h-3 w-3" />
                  </a>
                  {(hist?.vendorCode ?? row.vendorCode) && (
                    <span className="rounded bg-white/[0.05] px-1.5 py-px font-mono text-[11px] text-zinc-400">
                      {hist?.vendorCode ?? row.vendorCode}
                    </span>
                  )}
                  {row.brand && <span>{row.brand}</span>}
                  {row.subject && <span>· {row.subject}</span>}
                  {row.rating != null && (
                    <span className="inline-flex items-center gap-1 text-amber-300/90">
                      <Star className="h-3 w-3 fill-amber-300/80 text-amber-300/80" />
                      {row.rating.toFixed(1)} <span className="text-zinc-500">({fmtNum(row.feedbacks)})</span>
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={onClose}
                className="rounded-xl border border-white/10 p-2 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto p-5">
              {/* ===== Математика цены ===== */}
              <section>
                <SectionTitle
                  icon={<Tags className="h-4 w-4 text-violet-300" />}
                  title="Математика цены"
                  sub={row.fetchedAt ? `снято с сайта ${fmtDateTime(row.fetchedAt)}` : "нет свежего снимка"}
                />
                <PriceWaterfall row={row} />
              </section>

              {/* ===== Сценарий СПП ===== */}
              {row.priceProduct != null && (
                <section className="rounded-2xl border border-violet-400/15 bg-violet-500/[0.05] p-4">
                  <SectionTitle
                    icon={<BadgePercent className="h-4 w-4 text-fuchsia-300" />}
                    title="Сценарий покупателя"
                    sub="СПП персональна — смоделируйте любой процент"
                  />
                  <div className="mt-3 flex items-center gap-4">
                    <input
                      type="range"
                      min={0}
                      max={30}
                      step={1}
                      value={scenario}
                      onChange={(e) => setScenario(Number(e.target.value))}
                      className="flex-1"
                    />
                    <span className="tabular w-14 text-right font-mono text-[15px] font-bold text-violet-200">
                      {scenario}%
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2.5">
                    <div className="rounded-xl border border-white/[0.07] bg-black/30 p-3">
                      <div className="text-[11px] uppercase tracking-wider text-zinc-500">соинвест WB</div>
                      <div className="tabular mt-1 font-mono text-[18px] font-bold text-fuchsia-300">
                        −{fmtRub(Math.round((row.priceProduct * scenario) / 100))} ₽
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/[0.07] bg-black/30 p-3">
                      <div className="text-[11px] uppercase tracking-wider text-zinc-500">цена покупателя</div>
                      <div className="tabular mt-1 font-mono text-[18px] font-bold text-zinc-50">
                        {fmtRub(row.priceProduct - Math.round((row.priceProduct * scenario) / 100))} ₽
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* ===== История цен ===== */}
              <section>
                <SectionTitle
                  icon={<Flame className="h-4 w-4 text-orange-300" />}
                  title="История цен"
                  sub={hist ? `${hist.history.length} снимков` : ""}
                />
                <div className="mt-3 h-48 rounded-2xl border border-white/[0.07] bg-black/25 p-2">
                  {histLoading ? (
                    <div className="flex h-full items-center justify-center text-zinc-500">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                  ) : chartData.length < 2 ? (
                    <div className="flex h-full items-center justify-center px-6 text-center text-[12.5px] leading-relaxed text-zinc-500">
                      Пока один снимок цены. Запускайте парсинг регулярно — график истории построится
                      автоматически.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: -6 }}>
                        <defs>
                          <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.45} />
                            <stop offset="100%" stopColor="#a78bfa" stopOpacity={0.02} />
                          </linearGradient>
                          <linearGradient id="gProduct" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#71717a" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#71717a" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                        <XAxis
                          dataKey="d"
                          tick={{ fill: "#71717a", fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                          interval="preserveStartEnd"
                          minTickGap={40}
                        />
                        <YAxis
                          tick={{ fill: "#71717a", fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                          domain={["dataMin - 30", "dataMax + 30"]}
                          tickFormatter={(v: number) =>
                            v >= 10000 ? `${Math.round(v / 1000)}к` : String(Math.round(v))
                          }
                        />
                        <Tooltip
                          contentStyle={{
                            background: "#14161e",
                            border: "1px solid rgba(255,255,255,0.1)",
                            borderRadius: 12,
                            fontSize: 12,
                          }}
                          labelStyle={{ color: "#a1a1aa" }}
                          formatter={(value: unknown, name: unknown) => [
                            `${fmtRub(Number(value))} ₽`,
                            name === "product" ? "До СПП" : "Покупатель",
                          ]}
                        />
                        <Area
                          type="monotone"
                          dataKey="product"
                          stroke="#a1a1aa"
                          strokeWidth={1.6}
                          strokeDasharray="5 4"
                          fill="url(#gProduct)"
                          dot={false}
                        />
                        <Area
                          type="monotone"
                          dataKey="total"
                          stroke="#a78bfa"
                          strokeWidth={2.4}
                          fill="url(#gTotal)"
                          dot={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </section>

              {/* ===== Размеры ===== */}
              {row.sizes.length > 0 && (
                <section>
                  <SectionTitle
                    icon={<Store className="h-4 w-4 text-emerald-300" />}
                    title="Цены по размерам"
                    sub={`всего на складах: ${fmtNum(row.totalQty)} шт`}
                  />
                  <div className="mt-3 overflow-hidden rounded-2xl border border-white/[0.07]">
                    <table className="w-full text-left text-[12.5px]">
                      <thead>
                        <tr className="bg-white/[0.03] text-[10.5px] uppercase tracking-wider text-zinc-500">
                          <th className="px-3.5 py-2.5">Размер</th>
                          <th className="px-3.5 py-2.5 text-right">Закупочная</th>
                          <th className="px-3.5 py-2.5 text-right">До СПП</th>
                          <th className="px-3.5 py-2.5 text-right">Покупатель</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.05]">
                        {row.sizes.map((s, i) => (
                          <tr key={`${s.name}-${i}`} className="tabular text-zinc-300">
                            <td className="px-3.5 py-2.5 font-mono">{s.name || "ONE"}</td>
                            <td className="px-3.5 py-2.5 text-right text-zinc-500">{fmtRub(s.basic)}</td>
                            <td className="px-3.5 py-2.5 text-right">{fmtRub(s.product)}</td>
                            <td className="px-3.5 py-2.5 text-right font-semibold text-zinc-100">
                              {fmtRub(s.total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* ===== WB кошелёк ===== */}
              <div className="flex items-start gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 text-[12.5px] leading-relaxed text-zinc-400">
                <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                {hist?.walletNote ??
                  "Скидка «WB Кошелёк» применяется при оплате кошельком поверх цены с СПП — в открытом API маркетплейс её не отдаёт."}
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function SectionTitle({
  icon,
  title,
  sub,
}: {
  icon: React.ReactNode;
  title: string;
  sub?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <h3 className="text-[14px] font-bold text-zinc-100">{title}</h3>
      {sub && <span className="ml-auto text-[11px] tabular text-zinc-500">{sub}</span>}
    </div>
  );
}

/* ===================== waterfall ===================== */
interface Step {
  label: string;
  sub?: string;
  value: number | null;
  delta?: number | null;
  kind: "base" | "seller" | "site" | "spp" | "final";
}

function PriceWaterfall({ row }: { row: ReportRow }) {
  const steps: Step[] = [];

  const base = row.cabBasePrice ?? row.priceBasic;
  steps.push({
    label: row.cabBasePrice != null ? "Цена продавца (из ЛК)" : "Закупочная цена на сайте",
    sub: row.cabBasePrice != null ? "выгрузка личного кабинета" : "до всех скидок",
    value: base,
    kind: "base",
  });

  if (row.cabSellerPrice != null || row.cabDiscountPct != null) {
    steps.push({
      label: `Цена ЛК со скидкой продавца ${row.cabDiscountPct != null ? `−${fmtPct(row.cabDiscountPct, 0)}` : ""}`,
      sub: "эта цена не содержит соинвеста площадки",
      value: row.cabSellerPrice,
      delta:
        row.cabSellerPrice != null && base != null ? row.cabSellerPrice - base : null,
      kind: "seller",
    });
  }

  steps.push({
    label: "Факт на сайте: до СПП",
    sub:
      row.siteVsCab != null && Math.abs(row.siteVsCab) >= 2
        ? row.siteVsCab < 0
          ? `ниже ЛК на ${fmtRub(Math.abs(row.siteVsCab))} ₽ — площадка доп. снижает`
          : `выше ЛК на ${fmtRub(row.siteVsCab)} ₽`
        : "совпадает с ценой ЛК",
    value: row.priceProduct,
    delta:
      row.cabSellerPrice != null && row.priceProduct != null
        ? row.priceProduct - row.cabSellerPrice
        : null,
    kind: "site",
  });

  steps.push({
    label: `Скидка WB · соинвест ${fmtPct(row.sppPercent)}`,
    sub: "СПП — оплачивает маркетплейс, из цены не видна в ЛК",
    value: row.priceTotal,
    delta: row.sppAmount != null ? -Math.abs(row.sppAmount) : null,
    kind: "spp",
  });

  steps.push({
    label: "Цена для покупателя",
    sub: "итог на витрине (анонимный запрос)",
    value: row.priceTotal,
    kind: "final",
  });

  const max = Math.max(...steps.map((s) => s.value ?? 0), 1);

  const colors: Record<Step["kind"], string> = {
    base: "linear-gradient(90deg, rgba(113,113,122,0.55), rgba(113,113,122,0.3))",
    seller: "linear-gradient(90deg, #52525b, #3f3f46)",
    site: "linear-gradient(90deg, #0ea5e9, #0369a1)",
    spp: "linear-gradient(90deg, #8b5cf6, #d946ef)",
    final: "linear-gradient(90deg, #10b981, #047857)",
  };

  return (
    <div className="mt-3 space-y-2 rounded-2xl border border-white/[0.07] bg-black/25 p-4">
      {steps.map((s, i) => {
        const width = s.value != null ? Math.max(6, (s.value / max) * 100) : 0;
        return (
          <motion.div
            key={s.label + i}
            initial={{ opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.06 * i, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-semibold text-zinc-200">{s.label}</div>
                {s.sub && <div className="truncate text-[11px] text-zinc-500">{s.sub}</div>}
              </div>
              <div className="flex shrink-0 items-baseline gap-2">
                {s.delta != null && Math.abs(s.delta) >= 1 && (
                  <span
                    className={`tabular text-[11px] font-bold ${
                      s.kind === "spp" ? "text-fuchsia-300" : s.delta < 0 ? "text-emerald-300" : "text-sky-300"
                    }`}
                  >
                    {s.delta > 0 ? "+" : "−"}
                    {fmtRub(Math.abs(s.delta))} ₽
                  </span>
                )}
                <span className="tabular font-mono text-[14px] font-bold text-zinc-50">
                  {fmtRub(s.value)} ₽
                </span>
              </div>
            </div>
            <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-white/[0.05]">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${width}%` }}
                transition={{ delay: 0.1 + 0.06 * i, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className={`h-full rounded-full ${s.kind === "spp" ? "shadow-[0_0_14px_rgba(217,70,239,0.5)]" : ""}`}
                style={{ background: colors[s.kind] }}
              />
            </div>
          </motion.div>
        );
      })}
      {row.priceSppMax != null && row.priceProduct != null && (
        <div className="mt-3 flex items-center justify-between rounded-xl border border-dashed border-violet-400/25 bg-violet-500/[0.06] px-3.5 py-2.5 text-[12px]">
          <span className="text-zinc-400">Худший сценарий: СПП 30%</span>
          <span className="tabular font-mono font-bold text-violet-200">
            {fmtRub(row.priceSppMax)} ₽
          </span>
        </div>
      )}
    </div>
  );
}
