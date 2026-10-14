import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://parking.luzhniki.ru"),
  title: "Абонементы на проезд · Лужники",
  description:
    "Оформление и оплата абонемента на проезд на территорию спортивного комплекса «Лужники».",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
