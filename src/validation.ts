/**
 * Pure value validators for struct field types. Each is a total predicate over
 * unknown input: format is checked by pattern, then calendar values are proven
 * real with a round-trip through Date so impossible dates (e.g. Feb 30) fail.
 */

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a canonical v4 UUID (case-insensitive). */
export function isValidUUID(value: unknown): boolean {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/** True for a `YYYY-MM-DD HH:MM:SS` value whose parts form a real calendar time. */
export function isValidDatetime(value: unknown): boolean {
  if (typeof value !== 'string' || !DATETIME_PATTERN.test(value)) {
    return false;
  }

  const [datePart, timePart] = value.split(' ');
  const [year, month, day] = datePart!.split('-').map(Number) as [number, number, number];
  const [hour, minute, second] = timePart!.split(':').map(Number) as [
    number,
    number,
    number,
  ];

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (hour < 0 || hour > 23) return false;
  if (minute < 0 || minute > 59) return false;
  if (second < 0 || second > 59) return false;

  return isRealDate(year, month, day);
}

/** True for a `YYYY-MM-DD` value that is a real calendar date. */
export function isValidDate(value: unknown): boolean {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number) as [number, number, number];

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  return isRealDate(year, month, day);
}

/** True for a boolean or the integer/string forms MySQL uses for one. */
export function isValidBoolean(value: unknown): boolean {
  return (
    typeof value === 'boolean' ||
    value === 0 ||
    value === 1 ||
    value === '0' ||
    value === '1'
  );
}
