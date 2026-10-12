import assert from "node:assert/strict";
import test from "node:test";
import { addIsoDays, parkingCalendarWindow } from "../app/lib/parking-dates.ts";
import { PARKING_TARIFFS } from "../app/lib/parking-tariffs.ts";

const DEVICE_TIME_ZONES = [
  "Pacific/Honolulu",
  "America/Los_Angeles",
  "Europe/Moscow",
  "Asia/Tokyo",
  "Pacific/Kiritimati",
];

test("московское окно календаря не зависит от часового пояса устройства", () => {
  const instant = new Date("2026-10-09T21:30:45.000Z");
  const originalTimeZone = process.env.TZ;
  const results = [];

  try {
    for (const timeZone of DEVICE_TIME_ZONES) {
      process.env.TZ = timeZone;
      results.push(parkingCalendarWindow(instant));
    }
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  }

  for (const result of results) {
    assert.deepEqual(result, {
      timeZone: "Europe/Moscow",
      moscowNow: "2026-10-10T00:30:45+03:00",
      minStartDate: "2026-10-11",
      maxStartDate: "2026-11-09",
    });
  }
});

test("30 календарных дней считаются включительно как дата старта плюс 29 дней", () => {
  const examples = [
    ["2026-01-01", "2026-01-30"],
    ["2026-02-01", "2026-03-02"],
    ["2026-08-08", "2026-09-06"],
    ["2026-10-08", "2026-11-06"],
    ["2026-12-15", "2027-01-13"],
  ];

  for (const [startDate, expectedEndDate] of examples) {
    assert.equal(addIsoDays(startDate, 29), expectedEndDate);
    const inclusiveDays = Math.round(
      (Date.parse(`${expectedEndDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000,
    ) + 1;
    assert.equal(inclusiveDays, 30);
  }
});

test("ни один тариф не превышает 30 календарных дней", () => {
  for (const [tariffId, tariff] of Object.entries(PARKING_TARIFFS)) {
    assert.equal(tariff.durationDays, 30, `тариф ${tariffId}`);
    assert.equal(addIsoDays("2026-10-08", tariff.durationDays - 1), "2026-11-06", `тариф ${tariffId}`);
  }
});
