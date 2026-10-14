import { NextRequest, NextResponse } from "next/server";
import { requiredRuntimeValue } from "@/app/lib/config";
import { promoApiRequest } from "@/app/lib/promo-api";
import { verifyParkingReturn } from "@/app/lib/parking-return";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      dealId?: number;
      paymentId?: number;
      expires?: number;
      signature?: string;
    };
    const paymentReturn = {
      dealId: Number(body.dealId ?? 0),
      paymentId: Number(body.paymentId ?? 0),
      expires: Number(body.expires ?? 0),
      signature: String(body.signature ?? "").trim().toLowerCase(),
    };
    if (!(await verifyParkingReturn(
      paymentReturn,
      requiredRuntimeValue("BITRIX_PAYMENT_SIGNATURE_TOKEN"),
    ))) {
      return json({ error: "Недействительные данные возврата из оплаты." }, 400);
    }

    const status = await promoApiRequest<{
      paid?: boolean;
      expired?: boolean;
      expiresAt?: number;
    }>("payment_status", {
      dealId: paymentReturn.dealId,
      paymentId: paymentReturn.paymentId,
    });
    return json({
      paid: status.paid === true,
      expired: status.expired === true,
      dealId: paymentReturn.dealId,
      paymentId: paymentReturn.paymentId,
      expiresAt: Number(status.expiresAt || paymentReturn.expires * 1000),
    });
  } catch (error) {
    console.error("PARKING_RETURN_STATUS_ERROR", error);
    return json({ error: "Не удалось проверить результат оплаты." }, 502);
  }
}
