import { describe, expect, it } from 'vitest'

import {
  cmToMm,
  fromMm,
  inchToMm,
  kgToLb,
  lbToKg,
  mmToCm,
  mmToInch,
  toMm,
} from '@/lib/units'

describe('length conversions', () => {
  it('mm ↔ cm are exact and inverse', () => {
    expect(mmToCm(300)).toBe(30)
    expect(cmToMm(30)).toBe(300)
    // round trip mm → cm → mm = mm (exact for the ×10 factor)
    expect(cmToMm(mmToCm(300))).toBe(300)
    expect(cmToMm(mmToCm(1))).toBe(1)
  })

  it('mm ↔ inch use the exact 25.4 factor', () => {
    expect(mmToInch(25.4)).toBe(1)
    expect(inchToMm(1)).toBe(25.4)
    // round trip mm → inch → mm = mm (float, so close-to)
    expect(inchToMm(mmToInch(300))).toBeCloseTo(300, 10)
    expect(inchToMm(mmToInch(150))).toBeCloseTo(150, 10)
  })
})

describe('weight conversions', () => {
  it('kg ↔ lb round-trip', () => {
    expect(lbToKg(1)).toBeCloseTo(0.45359237, 10)
    expect(kgToLb(lbToKg(2.4))).toBeCloseTo(2.4, 10)
    expect(lbToKg(kgToLb(5))).toBeCloseTo(5, 10)
  })
})

describe('toMm / fromMm dispatch', () => {
  it('toMm converts from each unit', () => {
    expect(toMm(300, 'mm')).toBe(300)
    expect(toMm(30, 'cm')).toBe(300)
    expect(toMm(1, 'in')).toBe(25.4)
  })

  it('fromMm is the inverse of toMm per unit', () => {
    for (const unit of ['mm', 'cm', 'in'] as const) {
      expect(toMm(fromMm(300, unit), unit)).toBeCloseTo(300, 10)
    }
  })
})
