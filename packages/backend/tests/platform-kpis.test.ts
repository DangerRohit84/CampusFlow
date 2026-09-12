/**
 * #11 platform KPIs: pure day-bucketing for DAU/registrations/syncs graphs.
 * Hermetic (no DB): bucket helpers fill zero-days and dedupe DAU keys.
 */
import { describe, it, expect } from 'vitest'
import { bucketByDay, bucketDau, bucketWau, sumSeries, dayRange, toDay } from '../src/services/platformKpis'

const D = (s: string) => new Date(`${s}T12:00:00.000Z`)

describe('dayRange / toDay', () => {
  it('dayRange_inclusive_utc_days', () => {
    expect(dayRange(D('2026-09-01'), D('2026-09-03'))).toEqual(['2026-09-01', '2026-09-02', '2026-09-03'])
  })
  it('toDay_uses_utc_date', () => {
    expect(toDay(D('2026-09-10'))).toBe('2026-09-10')
  })
})

describe('bucketByDay', () => {
  it('bucketByDay_counts_and_zero_fills', () => {
    const series = bucketByDay([D('2026-09-01'), D('2026-09-01'), D('2026-09-03')], D('2026-09-01'), D('2026-09-03'))
    expect(series).toEqual([
      { day: '2026-09-01', count: 2 },
      { day: '2026-09-02', count: 0 },
      { day: '2026-09-03', count: 1 },
    ])
  })
  it('bucketByDay_skips_invalid_dates', () => {
    const series = bucketByDay([new Date('invalid'), D('2026-09-01')], D('2026-09-01'), D('2026-09-01'))
    expect(series).toEqual([{ day: '2026-09-01', count: 1 }])
  })
})

describe('bucketDau', () => {
  it('bucketDau_dedupes_same_key_per_day_case_insensitive', () => {
    const series = bucketDau(
      [
        { key: 'A@x.edu', at: D('2026-09-01') },
        { key: 'a@X.edu', at: D('2026-09-01') },
        { key: 'b@x.edu', at: D('2026-09-01') },
        { key: 'a@x.edu', at: D('2026-09-02') },
      ],
      D('2026-09-01'),
      D('2026-09-02'),
    )
    expect(series).toEqual([
      { day: '2026-09-01', count: 2 },
      { day: '2026-09-02', count: 1 },
    ])
  })
})

describe('sumSeries', () => {
  it('sumSeries_totals_counts', () => {
    expect(sumSeries([{ day: 'd1', count: 2 }, { day: 'd2', count: 3 }])).toBe(5)
    expect(sumSeries([])).toBe(0)
  })
})

describe('bucketWau', () => {
  it('bucketWau_rolling_7d_union_per_day', () => {
    // a active day1+day2, b active day1 only, c active day8 only.
    const series = bucketWau(
      [
        { key: 'a@x.edu', at: D('2026-09-01') },
        { key: 'b@x.edu', at: D('2026-09-01') },
        { key: 'a@x.edu', at: D('2026-09-02') },
        { key: 'c@x.edu', at: D('2026-09-08') },
      ],
      D('2026-09-01'),
      D('2026-09-08'),
    )
    expect(series).toEqual([
      { day: '2026-09-01', count: 2 }, // {a,b}
      { day: '2026-09-02', count: 2 }, // {a,b}
      { day: '2026-09-03', count: 2 }, // window still covers day1
      { day: '2026-09-04', count: 2 },
      { day: '2026-09-05', count: 2 },
      { day: '2026-09-06', count: 2 },
      { day: '2026-09-07', count: 2 }, // window [09-01, 09-07] still covers day1
      { day: '2026-09-08', count: 2 }, // a(day2, within 7d) + c; day1 aged out
    ])
  })
  it('bucketWau_uses_lookback_rows_before_from', () => {
    const series = bucketWau(
      [{ key: 'a@x.edu', at: D('2026-08-30') }],
      D('2026-09-01'),
      D('2026-09-01'),
    )
    // 2026-08-30 is within the trailing 7d window ending 2026-09-01.
    expect(series).toEqual([{ day: '2026-09-01', count: 1 }])
  })
  it('bucketWau_dedupes_case_insensitive_and_skips_invalid', () => {
    const series = bucketWau(
      [
        { key: 'A@x.edu', at: D('2026-09-01') },
        { key: 'a@X.edu', at: D('2026-09-02') },
        { key: '', at: D('2026-09-02') },
        { key: 'b@x.edu', at: new Date('invalid') },
      ],
      D('2026-09-01'),
      D('2026-09-02'),
    )
    expect(series).toEqual([
      { day: '2026-09-01', count: 1 },
      { day: '2026-09-02', count: 1 },
    ])
  })
  it('bucketWau_zero_fills_empty_range', () => {
    expect(bucketWau([], D('2026-09-01'), D('2026-09-02'))).toEqual([
      { day: '2026-09-01', count: 0 },
      { day: '2026-09-02', count: 0 },
    ])
  })
})
