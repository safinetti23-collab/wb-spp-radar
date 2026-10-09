import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "СПП·Радар — парсер цен Wildberries и соинвестиций площадки",
  description:
    "Мониторинг цен продавца Wildberries: парсинг цен с сайта, сверка с выгрузкой из личного кабинета, полная математика цены и соинвест (СПП) площадки по каждому SKU.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="scene-noise min-h-screen antialiased">
        <div className="scene" />
        <div className="scene-grid" />
        {children}
      </body>
    </html>
  );
}
