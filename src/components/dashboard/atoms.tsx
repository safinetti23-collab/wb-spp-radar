"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, Package, TriangleAlert, X } from "lucide-react";

export type ToastKind = "ok" | "err" | "info";
export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

const toastStyles: Record<ToastKind, { icon: typeof Info; cls: string }> = {
  ok: { icon: CheckCircle2, cls: "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" },
  err: { icon: TriangleAlert, cls: "border-rose-400/25 bg-rose-500/10 text-rose-200" },
  info: { icon: Info, cls: "border-violet-400/25 bg-violet-500/10 text-violet-200" },
};

export function Toasts({
  toasts,
  dismiss,
}: {
  toasts: Toast[];
  dismiss: (id: number) => void;
}) {
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[90] flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {toasts.map((t) => {
          const S = toastStyles[t.kind];
          const Icon = S.icon;
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
              className={`glass-strong pointer-events-auto flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-2xl ${S.cls}`}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1 leading-snug text-zinc-100">{t.text}</span>
              <button
                onClick={() => dismiss(t.id)}
                className="rounded-md p-0.5 text-zinc-500 transition hover:bg-white/10 hover:text-zinc-200"
                aria-label="Закрыть"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/** Превью товара с градиентным фолбэком на первую букву бренда */
export function Thumb({ src, label }: { src: string; label: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-violet-500/25 to-fuchsia-500/15 text-sm font-bold text-violet-200">
        {(label || "·").slice(0, 1).toUpperCase() || <Package className="h-4 w-4" />}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className="h-11 w-11 shrink-0 rounded-xl border border-white/10 object-cover"
    />
  );
}

export function DeltaChip({ delta, unit = "₽" }: { delta: number | null; unit?: string }) {
  if (delta == null || Math.abs(delta) < 1) {
    return <span className="text-[11px] text-zinc-600">без изменений</span>;
  }
  const down = delta < 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular ${
        down
          ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
          : "border-rose-400/25 bg-rose-400/10 text-rose-300"
      }`}
    >
      {down ? "▼" : "▲"} {new Intl.NumberFormat("ru-RU").format(Math.abs(Math.round(delta)))} {unit}
    </span>
  );
}

export function SkeletonRows({ count = 8 }: { count?: number }) {
  return (
    <div className="divide-y divide-white/5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-4 px-5 py-4">
          <div className="h-11 w-11 rounded-xl bg-white/5" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 rounded bg-white/5" />
            <div className="h-2.5 w-1/5 rounded bg-white/5" />
          </div>
          {[0, 1, 2, 3].map((k) => (
            <div key={k} className="h-3 w-16 rounded bg-white/5" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="glass animate-pulse rounded-2xl p-5">
      <div className="h-3 w-24 rounded bg-white/5" />
      <div className="mt-3 h-7 w-32 rounded bg-white/5" />
      <div className="mt-3 h-2.5 w-40 rounded bg-white/5" />
    </div>
  );
}
