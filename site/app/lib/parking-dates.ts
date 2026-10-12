export const MOSCOW_TIME_ZONE = "Europe/Moscow" as const;

export type ParkingCalendarWindow = {
  timeZone: typeof MOSCOW_TIME_ZONE;
  moscowNow: string;
  minStartDate: string;
  maxStartDate: string;
};

function dateParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MOSCOW_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

export function addIsoDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function moscowIsoDate(offsetDays = 0, now = new Date()) {
  const parts = dateParts(now);
  return addIsoDays(
    `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    offsetDays,
  );
}

export function parkingCalendarWindow(now = new Date()): ParkingCalendarWindow {
  const parts = dateParts(now);
  const two = (value: number) => String(value).padStart(2, "0");

  return {
    timeZone: MOSCOW_TIME_ZONE,
    moscowNow: `${parts.year}-${two(parts.month)}-${two(parts.day)}T${two(parts.hour)}:${two(parts.minute)}:${two(parts.second)}+03:00`,
    minStartDate: moscowIsoDate(1, now),
    maxStartDate: moscowIsoDate(30, now),
  };
}
