import type { Metadata } from "next";
import ParkingSubscription from "./ParkingSubscription";

export const metadata: Metadata = {
  title: "Абонементы на проезд · Лужники",
  description:
    "Оформление и оплата абонемента на проезд на территорию спортивного комплекса «Лужники».",
  openGraph: {
    title: "Абонементы на проезд · Лужники",
    description:
      "Оформление и оплата абонемента на проезд на территорию спортивного комплекса «Лужники».",
    type: "website",
    locale: "ru_RU",
    images: [{ url: "/og-parking-clean.png", width: 1731, height: 909 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Абонементы на проезд · Лужники",
    description:
      "Оформление и оплата абонемента на проезд на территорию спортивного комплекса «Лужники».",
    images: ["/og-parking-clean.png"],
  },
  robots: { index: true, follow: true },
};

export default function ParkingSubscriptionPage() {
  return <ParkingSubscription />;
}
