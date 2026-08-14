/**
 * Get day of week as a number (Monday=0, Tuesday=1, ..., Sunday=6).
 * Maps JavaScript's getDay() (Sunday=0, Monday=1, ..., Saturday=6) to
 * a Monday-start convention used in the database schema.
 *
 * @param date - Optional date to compute day of week for. Defaults to today.
 */
export function getDayOfWeek(date?: Date): number {
  const d = date || new Date()
  const day = d.getDay()
  return day === 0 ? 6 : day - 1
}
