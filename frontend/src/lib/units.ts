/**
 * Unit conversion helpers.
 *
 * The backend and CartonCloud store dimensions in **mm** and weight in **kg**
 * (see DECISIONS.md / spec §CARTONCLOUD). These helpers convert the operator's
 * chosen capture units to/from that canonical storage unit. They return
 * full-precision numbers; rounding for display is the caller's concern.
 */

/** Exact conversion factors. */
const MM_PER_CM = 10
const MM_PER_INCH = 25.4
const KG_PER_LB = 0.45359237

export function mmToCm(mm: number): number {
  return mm / MM_PER_CM
}

export function cmToMm(cm: number): number {
  return cm * MM_PER_CM
}

export function mmToInch(mm: number): number {
  return mm / MM_PER_INCH
}

export function inchToMm(inch: number): number {
  return inch * MM_PER_INCH
}

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB
}

/** Length capture units offered in the UI. Storage is always mm. */
export type LengthUnit = 'mm' | 'cm' | 'in'

/** Convert a length value in `unit` to canonical mm. */
export function toMm(value: number, unit: LengthUnit): number {
  switch (unit) {
    case 'mm':
      return value
    case 'cm':
      return cmToMm(value)
    case 'in':
      return inchToMm(value)
  }
}

/** Convert a canonical mm value to `unit` for display/editing. */
export function fromMm(mm: number, unit: LengthUnit): number {
  switch (unit) {
    case 'mm':
      return mm
    case 'cm':
      return mmToCm(mm)
    case 'in':
      return mmToInch(mm)
  }
}
