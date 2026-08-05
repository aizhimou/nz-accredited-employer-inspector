const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const EXPIRY_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/u;

const aucklandDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Pacific/Auckland",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function partsToRecord(parts: Intl.DateTimeFormatPart[]): Record<string, string> {
  return Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
}

export function isValidDateOnly(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function getExpiryDate(value: string): string | null {
  if (!EXPIRY_PATTERN.test(value)) {
    return null;
  }
  const dateOnly = value.slice(0, 10);
  return isValidDateOnly(dateOnly) ? dateOnly : null;
}

export function getAucklandDate(epochMilliseconds = Date.now()): string {
  const values = partsToRecord(aucklandDateFormatter.formatToParts(epochMilliseconds));
  const year = values.year;
  const month = values.month;
  const day = values.day;
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error("Intl formatter did not return an Auckland calendar date.");
  }
  return `${year}-${month}-${day}`;
}

export function getAccreditationStatus(
  expiryDateOfAccreditation: string,
  nowMilliseconds = Date.now(),
): "accredited" | "expired" {
  const expiryDate = getExpiryDate(expiryDateOfAccreditation);
  if (expiryDate === null) {
    throw new Error("Employer contains an invalid accreditation expiry date.");
  }
  return expiryDate >= getAucklandDate(nowMilliseconds) ? "accredited" : "expired";
}

export function isRecentlyVerified(
  lastVerifiedAtSeconds: number,
  nowMilliseconds = Date.now(),
): boolean {
  return Math.floor(nowMilliseconds / 1000) - lastVerifiedAtSeconds < 7 * 24 * 60 * 60;
}
