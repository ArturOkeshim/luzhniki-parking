import { NextRequest, NextResponse } from "next/server";
import { activateParkingPayment } from "@/app/lib/parking-bitrix";
import { createParkingPaymentUrl } from "@/app/lib/parking-payment-url";
import { ParkingPaymentToken, verifyToken } from "@/app/lib/tokens";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { paymentToken?: string };
    const checkout = await verifyToken<ParkingPaymentToken>(body.paymentToken ?? "", "parking-payment");
    if (Date.now() >= checkout.expiresAt) {
      return json({ error: "Срок оплаты истёк. Создайте новую заявку.", expired: true }, 410);
    }
    const paymentUrl = await createParkingPaymentUrl({
      dealId: checkout.dealId,
      paymentId: checkout.paymentId,
      expiresAt: checkout.expiresAt,
    });
    void activateParkingPayment(checkout.dealId, checkout.paymentId, paymentUrl).catch((error) => {
      console.error(
        "PARKING_PAYMENT_ACTIVATION_ERROR",
        error instanceof Error ? error.message : String(error),
      );
    });
    return json({ ready: true, paymentUrl, expiresAt: checkout.expiresAt });
  } catch (error) {
    console.error("PARKING_PAYMENT_LINK_ERROR", error);
    return json({ error: error instanceof Error ? error.message : "Не удалось получить ссылку на оплату." }, 502);
  }
}
