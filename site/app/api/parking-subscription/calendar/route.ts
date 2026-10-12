import { NextResponse } from "next/server";
import { parkingCalendarWindow } from "@/app/lib/parking-dates";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    parkingCalendarWindow(),
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
  );
}
