export const fmtRub = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n)
    ? "—"
    : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(n));

export const fmtRubSign = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n)
    ? "—"
    : `${n > 0 ? "+" : n < 0 ? "−" : ""}${new Intl.NumberFormat("ru-RU", {
        maximumFractionDigits: 0,
      }).format(Math.abs(Math.round(n)))}`;

export const fmtPct = (n: number | null | undefined, digits = 1): string =>
  n == null || !Number.isFinite(n)
    ? "—"
    : `${new Intl.NumberFormat("ru-RU", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(n)}%`;

export const fmtNum = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n)
    ? "—"
    : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n);

export const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
};

export const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  }).format(d);
};

export const plural = (n: number, one: string, few: string, many: string): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};
