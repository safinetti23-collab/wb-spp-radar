"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bot,
  CalendarClock,
  CheckCircle2,
  Copy,
  Globe,
  KeyRound,
  Link2,
  Loader2,
  Play,
  RefreshCw,
  Sheet,
  TriangleAlert,
  UploadCloud,
  X,
} from "lucide-react";
import type { AutomationResponse, PipelineRunResponse } from "@/lib/types";
import { fmtDateTime, fmtNum } from "@/lib/format";
import type { Toast } from "./atoms";

interface SheetTestResult {
  ok: boolean;
  title?: string;
  sheets?: string[];
  email?: string | null;
  message?: string;
}

/** Центр управления: расписание, Google Sheets, журнал запусков */
export default function AutomationModal({
  open,
  onClose,
  onChanged,
  pushToast,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  pushToast: (kind: Toast["kind"], text: string) => void;
}) {
  const [data, setData] = useState<AutomationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [running, setRunning] = useState(false);
  const [testRes, setTestRes] = useState<SheetTestResult | null>(null);

  // локальная копия настроек
  const [enabled, setEnabled] = useState(false);
  const [exportEnabled, setExportEnabled] = useState(true);
  const [intervalHours, setIntervalHours] = useState(6);
  const [supplier, setSupplier] = useState(12520);
  const [sheetId, setSheetId] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/automation", { cache: "no-store" });
      const json = (await res.json()) as AutomationResponse;
      setData(json);
      setEnabled(json.config.enabled);
      setExportEnabled(json.config.exportEnabled);
      setIntervalHours(json.config.intervalHours);
      setSupplier(json.config.supplier);
      setSheetId(json.config.sheetId);
      setTestRes(null);
    } catch {
      pushToast("err", "Не удалось загрузить настройки автоматизации");
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/automation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, exportEnabled, intervalHours, supplier, sheetId }),
      });
      const json = await res.json();
      if (json.ok) {
        pushToast("ok", enabled ? `Расписание активно: каждые ${intervalHours} ч` : "Настройки сохранены");
        await reload();
      } else pushToast("err", "Не удалось сохранить настройки");
    } catch {
      pushToast("err", "Сеть недоступна");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestRes(null);
    try {
      const res = await fetch("/api/sheets/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sheetId }),
      });
      const json = (await res.json()) as SheetTestResult;
      setTestRes(json);
      if (json.ok) pushToast("ok", `Подключено: «${json.title}»`);
    } catch {
      setTestRes({ ok: false, message: "Сеть недоступна" });
    } finally {
      setTesting(false);
    }
  };

  const exportNow = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/sheets/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sheetId, saveSheetId: true }),
      });
      const json = await res.json();
      if (json.ok) {
        pushToast("ok", `Выгружено ${json.reportRows} строк отчёта + ${json.historyRows} в историю`);
        await reload();
      } else pushToast("err", json.message ?? "Выгрузка не удалась");
    } catch {
      pushToast("err", "Сеть недоступна");
    } finally {
      setExporting(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/pipeline/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ doExport: exportEnabled }),
      });
      const json = (await res.json()) as PipelineRunResponse;
      if (json.ok) {
        pushToast(
          "ok",
          `Пайплайн завершён: ${fmtNum(json.parse?.found)} SKU${json.export ? `, в Sheets: ${json.export.reportRows} строк` : ""}`
        );
      } else {
        pushToast("err", json.message ?? "Пайплайн завершился с ошибкой");
      }
      await reload();
      onChanged();
    } catch {
      pushToast("err", "Сеть недоступна");
    } finally {
      setRunning(false);
    }
  };

  const env = data?.env;
  const nextRunIn = (() => {
    if (!data?.config.enabled || !data.config.lastRunAt)
      return data?.config.enabled ? "первый запуск в течение минуты" : null;
    const ms =
      data.config.intervalHours * 3600_000 -
      (Date.now() - new Date(data.config.lastRunAt).getTime());
    if (ms <= 0) return "запуск в течение минуты";
    const h = Math.floor(ms / 3600_000);
    const m = Math.ceil((ms % 3600_000) / 60_000);
    return `следующий запуск через ${h > 0 ? `${h} ч ` : ""}${m > 0 && h === 0 ? `${m} мин` : h > 0 ? "" : ""}`.trim();
  })();

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[70] bg-black/65 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="glass-strong fixed left-1/2 top-1/2 z-[80] flex max-h-[92vh] w-[min(680px,95vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl"
          >
            {/* шапка */}
            <div className="flex items-center gap-3.5 border-b border-white/[0.07] p-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500">
                <Bot className="h-6 w-6 text-white" />
              </div>
              <div className="flex-1">
                <h2 className="text-[17px] font-bold text-zinc-50">Автоматизация</h2>
                <p className="text-[12.5px] text-zinc-500">
                  регулярный парсинг цен + выгрузка отчёта в Google Sheets
                </p>
              </div>
              {env && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                    enabled
                      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                      : "border-white/10 bg-white/[0.03] text-zinc-500"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-emerald-400" : "bg-zinc-600"}`} />
                  {enabled ? "расписание активно" : "расписание выключено"}
                </span>
              )}
              <button
                onClick={onClose}
                className="rounded-xl border border-white/10 p-2 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto p-5">
              {loading && !data ? (
                <div className="flex items-center justify-center py-16 text-zinc-500">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : (
                <>
                  {/* ===== расписание ===== */}
                  <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
                    <SectionTitle icon={<CalendarClock className="h-4 w-4 text-violet-300" />} title="Расписание парсинга" />
                    <div className="mt-4 space-y-3.5">
                      <div className="flex flex-wrap items-center gap-3">
                        <Toggle value={enabled} onChange={setEnabled} label={`Каждые`} />
                        <select
                          value={intervalHours}
                          onChange={(e) => setIntervalHours(Number(e.target.value))}
                          className="glass rounded-xl px-3 py-2 text-sm text-zinc-200 outline-none"
                        >
                          {[1, 2, 3, 4, 6, 8, 12, 24].map((h) => (
                            <option key={h} value={h}>{h} ч</option>
                          ))}
                        </select>
                        <span className="text-sm text-zinc-500">• продавец</span>
                        <input
                          value={supplier}
                          onChange={(e) => setSupplier(Number(e.target.value.replace(/[^\d]/g, "")) || 12520)}
                          className="glass w-24 rounded-xl px-3 py-2 text-sm tabular text-zinc-100 outline-none"
                          inputMode="numeric"
                        />
                        <Toggle
                          value={exportEnabled}
                          onChange={setExportEnabled}
                          label="сразу выгружать в Sheets"
                        />
                      </div>
                      {nextRunIn && (
                        <p className="text-[12px] text-zinc-500">
                          {data?.config.lastRunAt
                            ? `Последний запуск: ${fmtDateTime(data.config.lastRunAt)} · `
                            : ""}
                          {nextRunIn}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          onClick={save}
                          disabled={saving}
                          className="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                        >
                          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Сохранить расписание"}
                        </button>
                        <button
                          onClick={runNow}
                          disabled={running}
                          className="glass rounded-xl px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-violet-400/40 disabled:opacity-60"
                        >
                          <span className="flex items-center gap-2">
                            {running ? <Loader2 className="h-4 w-4 animate-spin text-violet-300" /> : <Play className="h-4 w-4 text-violet-300" />}
                            Запустить сейчас{exportEnabled ? " (парсинг + выгрузка)" : " (только парсинг)"}
                          </span>
                        </button>
                      </div>
                    </div>
                  </section>

                  {/* ===== google sheets ===== */}
                  <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
                    <SectionTitle icon={<Sheet className="h-4 w-4 text-emerald-300" />} title="Google Sheets" />
                    <div className="mt-4 space-y-3.5">
                      <div className="flex flex-wrap items-center gap-2 text-[12px]">
                        <StatusChip ok={Boolean(env?.googleCreds)} okText="ключи заданы" badText="ключи не заданы" />
                        {env?.serviceEmail && (
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(env.serviceEmail!);
                              pushToast("info", "Email сервисного аккаунта скопирован");
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1 font-mono text-[11.5px] text-zinc-300 transition hover:border-violet-400/40"
                            title="Скопировать email — на него нужно расшарить таблицу"
                          >
                            <KeyRound className="h-3 w-3 text-violet-300" />
                            {env.serviceEmail}
                            <Copy className="h-3 w-3 text-zinc-500" />
                          </button>
                        )}
                      </div>

                      <ol className="list-inside list-decimal space-y-1 text-[12.5px] leading-relaxed text-zinc-500">
                        <li>Google Cloud Console → создайте проект, включите <b className="text-zinc-300">Google Sheets API</b>;</li>
                        <li>создайте <b className="text-zinc-300">Service Account</b> и скачайте JSON-ключ;</li>
                        <li>положите JSON в переменную <code className="rounded bg-black/40 px-1 py-0.5 font-mono text-[11px] text-violet-200">GOOGLE_SERVICE_ACCOUNT_JSON</code> и перезапустите;</li>
                        <li>расшарьте таблицу (доступ «Редактор») на email сервисного аккаунта, вставьте её ссылку ниже.</li>
                      </ol>

                      <div className="flex flex-wrap items-center gap-2">
                        <div className="glass flex min-w-56 flex-1 items-center gap-2 rounded-xl px-3">
                          <Link2 className="h-4 w-4 shrink-0 text-zinc-500" />
                          <input
                            value={sheetId}
                            onChange={(e) => setSheetId(e.target.value)}
                            placeholder="Ссылка на таблицу или её ID"
                            className="w-full bg-transparent py-2.5 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600"
                          />
                        </div>
                        <button
                          onClick={test}
                          disabled={testing || !sheetId}
                          className="glass rounded-xl px-3.5 py-2.5 text-sm text-zinc-200 transition hover:border-emerald-400/40 disabled:opacity-50"
                        >
                          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Проверить"}
                        </button>
                        <button
                          onClick={exportNow}
                          disabled={exporting || !sheetId}
                          className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                        >
                          <span className="flex items-center gap-2">
                            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                            Выгрузить сейчас
                          </span>
                        </button>
                      </div>

                      <AnimatePresence>
                        {testRes && (
                          <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] ${
                              testRes.ok
                                ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                                : "border-rose-400/25 bg-rose-500/10 text-rose-200"
                            }`}
                          >
                            {testRes.ok ? (
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                            ) : (
                              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                            )}
                            <div>
                              {testRes.ok ? (
                                <>
                                  Подключено к «{testRes.title}»
                                  {testRes.sheets?.length ? (
                                    <span className="text-emerald-200/70"> · вкладки: {testRes.sheets.join(", ")}</span>
                                  ) : null}
                                </>
                              ) : (
                                testRes.message
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <p className="text-[12px] leading-relaxed text-zinc-600">
                        Вкладка «{data?.config.tabReport ?? "Отчёт"}» перезаписывается свежим снимком,
                        «{data?.config.tabHistory ?? "История"}» дополняется строками каждого прогона —
                        из неё удобно строить свою аналитику.
                      </p>
                    </div>
                  </section>

                  {/* ===== внешний cron ===== */}
                  <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
                    <SectionTitle icon={<Globe className="h-4 w-4 text-sky-300" />} title="Внешний планировщик (опционально)" />
                    <p className="mt-2.5 text-[12.5px] leading-relaxed text-zinc-500">
                      Если приложение живёт на serverless-хостинге, внутренний таймер не работает между
                      запросами — дёргайте эндпоинт из cron-job.org / Cloud Scheduler:
                    </p>
                    <div className="mt-2.5 overflow-x-auto rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 font-mono text-[12px] text-zinc-300">
                      curl -X POST {typeof window !== "undefined" ? window.location.origin : "https://your-host"}/api/cron/run
                      {env?.cronSecret ? ' \\\n  -H "Authorization: Bearer $CRON_SECRET"' : ""}
                    </div>
                    {!env?.cronSecret && (
                      <p className="mt-2 text-[12px] text-amber-300/80">
                        Эндпоинт открыт: задайте CRON_SECRET в переменных окружения, чтобы закрыть его токеном.
                      </p>
                    )}
                  </section>

                  {/* ===== журнал ===== */}
                  <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
                    <div className="flex items-center">
                      <SectionTitle icon={<RefreshCw className="h-4 w-4 text-zinc-400" />} title="Журнал запусков" />
                      <button
                        onClick={reload}
                        className="ml-auto rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
                        title="Обновить"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="mt-3.5 space-y-1.5">
                      {(data?.jobs ?? []).length === 0 && (
                        <p className="py-3 text-center text-[12.5px] text-zinc-600">Запусков пока не было</p>
                      )}
                      {(data?.jobs ?? []).map((j) => (
                        <div
                          key={j.id}
                          className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/25 px-3.5 py-2.5"
                        >
                          {j.status === "ok" ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                          ) : j.status === "error" ? (
                            <TriangleAlert className="h-4 w-4 shrink-0 text-rose-400" />
                          ) : (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-300" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
                              <span className="font-semibold text-zinc-200">
                                {j.kind === "pipeline" ? "Пайплайн" : j.kind === "parse" ? "Парсинг" : "Выгрузка"}
                              </span>
                              <span className="text-[11px] text-zinc-600">
                                {j.trigger === "schedule" ? "по расписанию" : j.trigger === "cron" ? "внешний cron" : "вручную"}
                              </span>
                              {j.rowsProcessed > 0 && (
                                <span className="tabular text-[11.5px] text-zinc-500">
                                  SKU {j.rowsProcessed}
                                  {j.snapshotsAdded > 0 && ` · снимков ${j.snapshotsAdded}`}
                                  {j.sheetRows > 0 && ` · в Sheets ${j.sheetRows}`}
                                </span>
                              )}
                            </div>
                            {(j.error || j.message) && (
                              <div className={`mt-0.5 truncate text-[11.5px] ${j.error ? "text-rose-300/80" : "text-zinc-500"}`} title={j.error ?? j.message ?? ""}>
                                {j.error ?? j.message}
                              </div>
                            )}
                          </div>
                          <span className="shrink-0 text-[11.5px] tabular text-zinc-600">
                            {fmtDateTime(j.startedAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <h3 className="text-[14px] font-bold text-zinc-100">{title}</h3>
    </div>
  );
}

function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className="inline-flex items-center gap-2 text-sm text-zinc-300"
    >
      <span
        className={`relative h-6 w-11 rounded-full border transition ${
          value
            ? "border-violet-400/50 bg-violet-500/60"
            : "border-white/10 bg-white/[0.06]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            value ? "left-[22px]" : "left-0.5"
          }`}
        />
      </span>
      {label && <span>{label}</span>}
    </button>
  );
}

function StatusChip({ ok, okText, badText }: { ok: boolean; okText: string; badText?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
        ok
          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
          : "border-amber-400/30 bg-amber-400/10 text-amber-300"
      }`}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />}
      {ok ? okText : badText ?? okText}
    </span>
  );
}
