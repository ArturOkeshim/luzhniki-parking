import { NextRequest, NextResponse } from "next/server";
import { promoApiRequest } from "@/app/lib/promo-api";
import { ParkingPaymentToken, verifyToken } from "@/app/lib/tokens";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { paymentToken?: string };
    const checkout = await verifyToken<ParkingPaymentToken>(body.paymentToken ?? "", "parking-payment");
    const status = await promoApiRequest<{
      paid?: boolean;
      expired?: boolean;
      promoReleased?: boolean;
      expiresAt?: number;
      updated?: boolean;
      duplicate?: boolean;
      couponFinalized?: boolean;
      receiptReady?: boolean;
      receiptUpdated?: boolean;
      receiptCheckCount?: number;
      receiptCheckId?: number;
    }>("payment_status", {
      dealId: checkout.dealId,
      paymentId: checkout.paymentId,
    });

    if (status.paid === true) {
      return json({
        paid: true,
        expired: false,
        updated: status.updated === true,
        duplicate: status.duplicate === true,
        couponFinalized: status.couponFinalized === true,
        receiptReady: status.receiptReady === true,
        receiptUpdated: status.receiptUpdated === true,
        receiptCheckCount: Number(status.receiptCheckCount || 0),
        receiptCheckId: Number(status.receiptCheckId || 0),
        dealId: checkout.dealId,
        paymentId: checkout.paymentId,
        expiresAt: checkout.expiresAt,
      });
    }

    if (status.expired === true || Date.now() >= checkout.expiresAt) {
      return json({
        paid: false,
        expired: true,
        promoReleased: status.promoReleased === true,
        dealId: checkout.dealId,
        paymentId: checkout.paymentId,
        expiresAt: Number(status.expiresAt || checkout.expiresAt),
      });
    }

    return json({
      paid: false,
      expired: false,
      dealId: checkout.dealId,
      paymentId: checkout.paymentId,
      expiresAt: Number(status.expiresAt || checkout.expiresAt),
    });
  } catch (error) {
    console.error("PARKING_PAYMENT_STATUS_ERROR", error);
    return json({ error: "Статус оплаты временно недоступен." }, 502);
  }
}
