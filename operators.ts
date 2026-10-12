import type { WaormValueOperator } from './index'

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
