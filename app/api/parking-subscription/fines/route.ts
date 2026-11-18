import { NextRequest, NextResponse } from "next/server";
import {
  isOutstandingParkingFine,
  listParkingFinesByPlate,
  parkingFineAmount,
  parkingFinesPaymentUrl,
} from "@/app/lib/parking-fines";
import {
  isRussianPlateValid,
  normalizeRussianPlate,
} from "@/app/lib/parking-plate";

export async function GET(request: NextRequest) {
  const plate = normalizeRussianPlate(request.nextUrl.searchParams.get("plate"));
  if (!isRussianPlateValid(plate)) {
    return NextResponse.json(
      { error: "Введите российский госномер в формате А000АА77 или А000АА777." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const items = await listParkingFinesByPlate(plate);
    const outstanding = items.filter(isOutstandingParkingFine);

    return NextResponse.json(
      {
        plate,
        hasOutstandingFines: outstanding.length > 0,
        outstandingCount: outstanding.length,
        total: outstanding.reduce((sum, item) => sum + parkingFineAmount(item), 0),
        paymentPageUrl: parkingFinesPaymentUrl(plate),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(
      "PARKING_SUBSCRIPTION_FINE_CHECK_ERROR",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      { error: "Не удалось проверить штрафы. Попробуйте ещё раз через минуту." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
