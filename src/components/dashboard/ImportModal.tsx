"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, FileSpreadsheet, FileUp, Loader2, TriangleAlert, X } from "lucide-react";
import type { ImportResponse } from "@/lib/types";
import type { Toast } from "./atoms";

type Phase =
  | { kind: "idle" }
  | { kind: "busy"; name: string }
  | { kind: "done"; res: ImportResponse }
  | { kind: "error"; message: string };

/**
 * Модал загрузки выгрузки цен из личного кабинета WB.
 * ЛК: «Цены и скидки» → выгрузить список товаров (.xlsx) — соинвеста площадки
 * там нет, поэтому файл становится эталоном цен продавца.
 */
export default function ImportModal({
  open,
  onClose,
  onDone,
  pushToast,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => Promise<void> | void;
  pushToast: (kind: Toast["kind"], text: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setPhase({ kind: "error", message: "Поддерживаются .xlsx, .xls и .csv — выгрузка раздела «Цены и скидки»" });
      return;
    }
    setPhase({ kind: "busy", name: file.name });
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const json = await res.json();
      if (json.ok) {
        const typed = json as ImportResponse;
        setPhase({ kind: "done", res: typed });
        pushToast("ok", `Импортировано ${typed.rowCount} строк, совпадений с каталогом: ${typed.matchedCount}`);
      } else {
        setPhase({ kind: "error", message: json.message ?? "Не удалось разобрать файл" });
      }
    } catch {
      setPhase({ kind: "error", message: "Сеть недоступна — попробуйте ещё раз" });
    }
  };

  const close = async () => {
    if (phase.kind === "done") await onDone();
    setPhase({ kind: "idle" });
    setDrag(false);
    onClose();
  };

  const colEntries = (res: ImportResponse) =>
    [
      ["Артикул WB", res.columns.nmId],
      ["Артикул продавца", res.columns.vendorCode],
      ["Цена", res.columns.basePrice],
      ["Скидка", res.columns.discount],
      ["Цена со скидкой", res.columns.sellerPrice],
    ].filter(([, v]) => v) as Array<[string, string]>;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
            className="fixed inset-0 z-[70] bg-black/65 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="glass-strong fixed left-1/2 top-1/2 z-[80] w-[min(560px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-3xl p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[18px] font-bold text-zinc-50">Выгрузка цен из ЛК WB</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
                  Кабинет продавца → «Цены и скидки» → выгрузить (.xlsx). Мы свяжем строки с тем, что
                  реально показывает сайт, и вычислим скрытый соинвест площадки.
                </p>
              </div>
              <button
                onClick={close}
                className="rounded-xl border border-white/10 p-2 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5">
              {phase.kind === "idle" || phase.kind === "error" ? (
                <>
                  <label
                    onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDrag(false);
                      const f = e.dataTransfer.files?.[0];
                      if (f) upload(f);
                    }}
                    className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
                      drag
                        ? "border-violet-400/60 bg-violet-500/10"
                        : "border-white/10 bg-white/[0.02] hover:border-violet-400/30 hover:bg-violet-500/[0.04]"
                    }`}
                  >
                    <FileUp className="h-8 w-8 text-violet-300" />
                    <p className="mt-3 text-sm font-semibold text-zinc-200">
                      Перетащите файл сюда или кликните для выбора
                    </p>
                    <p className="mt-1 text-[12px] text-zinc-500">
                      .xlsx, .xls или .csv · колонки «Артикул WB», «Цена», «Скидка, %»
                    </p>
                    <input
                      ref={inputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) upload(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {phase.kind === "error" && (
                    <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3.5 py-3 text-[13px] text-rose-200">
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      {phase.message}
                    </div>
                  )}
                </>
              ) : phase.kind === "busy" ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-14">
                  <Loader2 className="h-8 w-8 animate-spin text-violet-300" />
                  <p className="mt-4 text-sm font-medium text-zinc-300">Разбираем файл…</p>
                  <p className="mt-1 text-[12px] tabular text-zinc-500">{phase.name}</p>
                </div>
              ) : (
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.06] p-5">
                  <div className="flex items-center gap-2.5 text-emerald-300">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="text-[15px] font-bold">Файл разобран</span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2.5">
                    <div className="rounded-xl bg-black/30 p-3">
                      <div className="text-[11px] uppercase tracking-wider text-zinc-500">строк импортировано</div>
                      <div className="tabular mt-1 font-mono text-xl font-bold text-zinc-50">
                        {phase.res.rowCount}
                      </div>
                    </div>
                    <div className="rounded-xl bg-black/30 p-3">
                      <div className="text-[11px] uppercase tracking-wider text-zinc-500">совпало с каталогом</div>
                      <div className="tabular mt-1 font-mono text-xl font-bold text-emerald-300">
                        {phase.res.matchedCount}
                      </div>
                    </div>
                  </div>
                  {colEntries(phase.res).length > 0 && (
                    <div className="mt-4">
                      <div className="text-[11px] uppercase tracking-wider text-zinc-500">найденные колонки</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {colEntries(phase.res).map(([label, col]) => (
                          <span
                            key={label}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1 text-[11.5px] text-zinc-300"
                          >
                            <FileSpreadsheet className="h-3 w-3 text-emerald-300/80" />
                            {label}: «{col}»
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-5 flex justify-end gap-2">
                    <button
                      onClick={() => setPhase({ kind: "idle" })}
                      className="rounded-xl border border-white/10 px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/5"
                    >
                      Загрузить ещё
                    </button>
                    <button
                      onClick={close}
                      className="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110"
                    >
                      Готово
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
