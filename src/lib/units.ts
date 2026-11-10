// Lengths are stored in millimetres. People see and type them in their chosen unit; pixels use the
// sheet's pixels-per-inch.
export type Units = 'mm' | 'in' | 'px' | 'pc'

export const UNIT_LABEL: Record<Units, string> = { mm: 'mm', in: 'in', px: 'px', pc: 'pica' }
export const UNIT_NAME: Record<Units, string> = { mm: 'milímetros', in: 'pulgadas', px: 'píxeles', pc: 'picas' }

export function mmPerUnit(units: Units, dpi: number): number {
  switch (units) {
    case 'mm': return 1
    case 'in': return 25.4
    case 'pc': return 25.4 / 6
    case 'px': return 25.4 / Math.max(1, dpi)
  }
}

export const toUnits = (mm: number, units: Units, dpi: number) => mm / mmPerUnit(units, dpi)
export const fromUnits = (value: number, units: Units, dpi: number) => value * mmPerUnit(units, dpi)

// Decimal places that suit each unit: whole pixels, tenths of a millimetre, hundredths of an inch.
export function decimals(units: Units, small = false): number {
  switch (units) {
    case 'px': return small ? 1 : 0
    case 'mm': return small ? 2 : 1
    case 'in': return small ? 3 : 2
    case 'pc': return small ? 2 : 1
  }
}

export function stepFor(units: Units, small = false): number {
  return 10 ** -decimals(units, small)
}

// A length as text, such as "12.5 mm". Trailing zeros are dropped so values stay short.
export function formatLength(mm: number, units: Units, dpi: number, small = false): string {
  const value = toUnits(mm, units, dpi)
  return `${trimZeros(value.toFixed(decimals(units, small)))} ${UNIT_LABEL[units]}`
}

// Like formatLength, but a tiny non-zero length reads "under 0.01 mm" instead of "0 mm".
export function formatSmall(mm: number, units: Units, dpi: number): string {
  const digits = decimals(units, true)
  if (mm > 0 && Number(toUnits(mm, units, dpi).toFixed(digits)) === 0) return `menos de ${10 ** -digits} ${UNIT_LABEL[units]}`
  return formatLength(mm, units, dpi, true)
}

export function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}

// Long lengths such as total cut length read better in metres or feet.
export function formatLong(mm: number, units: Units): string {
  if (units === 'in' || units === 'pc') {
    const inches = mm / 25.4
    return inches >= 120 ? `${(inches / 12).toFixed(1)} ft` : `${inches.toFixed(1)} in`
  }
  return mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${mm.toFixed(0)} mm`
}

// Pixel size of a PNG at the sheet's pixels-per-inch.
export function pixelSize(widthMm: number, heightMm: number, dpi: number): [number, number] {
  return [Math.max(1, Math.round((widthMm / 25.4) * dpi)), Math.max(1, Math.round((heightMm / 25.4) * dpi))]
}
