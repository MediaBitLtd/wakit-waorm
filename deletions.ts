import type { WaormDatabaseConfig, WaormDatabaseConnection, WaormDeletion, WaormKey } from './index'
import { assertTracking, getDBConnection, parseKey } from './model'

export const DELETIONS_STORE = '$waorm:deletions'

// Keys collide across stores, so tombstones are keyed by both
export const tombstoneKey = (store: string, key: WaormKey) => `${store}:${parseKey(key)}`

export const withDeletionsStore = <T>(config: WaormDatabaseConfig<T>): WaormDatabaseConfig<T> => {
  if (! config.trackDeletions || config.stores.some(store => store.name === DELETIONS_STORE)) {
    return config
  }

  return { ...config, stores: [...config.stores, { name: DELETIONS_STORE, indexes: [{ name: 'store' }] }] }
}

export const deletions = async <T = unknown>(store?: string, connection: WaormDatabaseConnection<any> | undefined = getDBConnection()): Promise<WaormDeletion<T>[]> => {
  const conn = assertTracking(connection)
  const items = (store
    ? await conn.where(DELETIONS_STORE, 'store', store, { operator: 'equals_many' })
    : await conn.all(DELETIONS_STORE)) as unknown as WaormDeletion<T>[] | undefined

  // localStorage matches equals_many case-insensitively
  return (items ?? [])
    .filter(item => ! store || item.store === store)
    .sort((a, b) => a.deleted_at.localeCompare(b.deleted_at))
}

export const clearDeletion = async (store: string, key: WaormKey, connection: WaormDatabaseConnection<any> | undefined = getDBConnection()): Promise<boolean> => {
  return assertTracking(connection).delete(DELETIONS_STORE, tombstoneKey(store, key))
}
