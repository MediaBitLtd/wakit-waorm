import type { WaormSearchOptions, WaormValueOperator } from './index'

const VALUE_OPERATORS: string[] = ['is_null', 'is_not_null', 'empty', 'not_empty'] satisfies WaormValueOperator[]

export const isValueOperator = (operator: string | undefined): operator is WaormValueOperator => VALUE_OPERATORS.includes(operator as string)

const isEmpty = (value: unknown): boolean => {
  if (value === null || value === undefined || value === '') {
    return true
  }

  if (Array.isArray(value)) {
    return value.length === 0
  }

  if (Object.getPrototypeOf(value) === Object.prototype) {
    return Object.keys(value as object).length === 0
  }

  return false
}

export const matchesValue = (value: unknown, operator: WaormValueOperator): boolean => {
  switch (operator) {
    case 'is_null': return value === null || value === undefined
    case 'is_not_null': return value !== null && value !== undefined
    case 'empty': return isEmpty(value)
    case 'not_empty': return ! isEmpty(value)
  }
}

// Dates are stored as ISO strings, compare them as such
const toComparable = (value: unknown): unknown => value instanceof Date ? value.toISOString() : value

export const betweenBounds = (search: unknown): [unknown, unknown] => {
  if (! Array.isArray(search) || search.length !== 2) {
    throw new Error('between operator expects [min, max] as search')
  }

  return [toComparable(search[0]), toComparable(search[1])]
}

// Returns the first value (or array element) inside the bounds, undefined when none
export const matchBetween = (value: unknown, bounds: [unknown, unknown], options?: WaormSearchOptions): unknown => {
  const [min, max] = bounds as [any, any]
  const values = Array.isArray(value) ? value : [value]

  return values.map(toComparable).find((v: any) => {
    // Mirror indexedDB key ordering: mixed types never match
    if (v === null || v === undefined || typeof v !== typeof min || typeof v !== typeof max) {
      return false
    }

    const aboveMin = options?.lowerOpen ? v > min : v >= min
    const belowMax = options?.upperOpen ? v < max : v <= max

    return aboveMin && belowMax
  })
}

export const compareValues = (a: any, b: any): number => a < b ? -1 : a > b ? 1 : 0
