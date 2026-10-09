import {
  pgTable,
  serial,
  integer,
  bigint,
  text,
  real,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

/**
 * Каталог SKU продавца, найденный парсером.
 * nmId — артикул Wildberries (уникальный).
 */
export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    nmId: bigint("nm_id", { mode: "number" }).notNull().unique(),
    supplierId: integer("supplier_id").notNull(),
    supplierName: text("supplier_name"),
    vendorCode: text("vendor_code"),
    name: text("name").notNull(),
    brand: text("brand"),
    subject: text("subject"),
    pics: integer("pics").default(0),
    rating: real("rating"),
    feedbacks: integer("feedbacks").default(0),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("products_supplier_idx").on(t.supplierId)]
);

export type ProductSizePrice = {
  name: string;
  basic: number | null;
  product: number | null;
  total: number | null;
};

/**
 * Снапшот цен на момент парсинга.
 * Все суммы — в рублях (целые).
 *
 * priceBasic   — закупочная цена (до скидки продавца)
 * priceProduct — цена на сайте ДО СПП / скидки WB (после скидки продавца)
 * priceTotal   — цена для покупателя после фактически применённой скидки WB
 * priceSppMax  — цена при максимальной скидке WB (сценарий 30%)
 */
export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dest: integer("dest").notNull(),
    priceBasic: integer("price_basic"),
    priceProduct: integer("price_product"),
    priceTotal: integer("price_total"),
    sppPercent: real("spp_percent"),
    sppAmount: integer("spp_amount"),
    priceSppMax: integer("price_spp_max"),
    priceWallet: integer("price_wallet"),
    totalQty: integer("total_qty").default(0),
    sizes: jsonb("sizes").$type<ProductSizePrice[]>().default([]),
    source: text("source").notNull().default("live"),
  },
  (t) => [
    index("snapshots_product_time_idx").on(t.productId, t.fetchedAt),
    index("snapshots_time_idx").on(t.fetchedAt),
  ]
);

/**
 * Загруженные выгрузки цен из личного кабинета WB.
 */
export const cabinetImports = pgTable("cabinet_imports", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  rowCount: integer("row_count").notNull().default(0),
  matchedCount: integer("matched_count").notNull().default(0),
});

/**
 * Настройки автоматизации (key-value).
 */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Журнал запусков: парсинг, выгрузка в Sheets, полный пайплайн.
 */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(), // parse | sheets_export | pipeline
    trigger: text("trigger").notNull().default("manual"), // manual | schedule | cron
    status: text("status").notNull().default("running"), // running | ok | error
    supplier: integer("supplier"),
    rowsProcessed: integer("rows_processed").notNull().default(0),
    snapshotsAdded: integer("snapshots_added").notNull().default(0),
    sheetRows: integer("sheet_rows").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    message: text("message"),
    error: text("error"),
  },
  (t) => [index("job_runs_started_idx").on(t.startedAt)]
);

/**
 * Строки выгрузки из ЛК: цены, которые продавец установил сам.
 * basePrice   — розничная цена продавца (до скидки)
 * discountPct — скидка продавца, %
 * sellerPrice — цена продавца со скидкой (ожидаемая "до СПП" на сайте)
 */
export const cabinetRows = pgTable(
  "cabinet_rows",
  {
    id: serial("id").primaryKey(),
    importId: integer("import_id")
      .notNull()
      .references(() => cabinetImports.id, { onDelete: "cascade" }),
    nmId: bigint("nm_id", { mode: "number" }),
    vendorCode: text("vendor_code"),
    title: text("title"),
    category: text("category"),
    basePrice: integer("base_price"),
    discountPct: real("discount_pct"),
    sellerPrice: integer("seller_price"),
  },
  (t) => [index("cabinet_rows_nm_idx").on(t.nmId)]
);
