import type { Resource, WaormConnectionPlugin, WaormDatabaseConfig, WaormDatabaseConnection, WaormCursorOptions, WaormSearchOptions } from '../../index'

type Store = Map<string, Resource>
type IndexMap = Map<string, string[]> // indexValue -> keys[]
type StoreIndexes = Map<string, IndexMap> // indexName -> IndexMap

interface MemoryEngine {
  stores: Map<string, Store>
  indexes: Map<string, StoreIndexes> // storeName -> StoreIndexes
}

const updateIndexes = (engine: MemoryEngine, config: WaormDatabaseConfig<MemoryEngine>, storeName: string, key: string, data: Resource) => {
  const storeConfig = config.stores.find(s => s.name === storeName)
  if (! storeConfig) {
    return
  }

  const storeIndexes = engine.indexes.get(storeName)!

  storeConfig.indexes.forEach(index => {
    const indexMap = storeIndexes.get(index.name)!
    const fieldPath = index.path || index.name

    // Remove old key from all index values
    for (const [, keys] of indexMap) {
      const idx = keys.indexOf(key)
      if (idx !== -1) {
        keys.splice(idx, 1)
      }
    }

    // Add new index value
    const value = (data as any)[fieldPath]?.toString()
    if (value !== undefined && value !== null) {
      if (! indexMap.has(value)) {
        indexMap.set(value, [])
      }
      indexMap.get(value)!.push(key)
    }
  })
}

const removeFromIndexes = (engine: MemoryEngine, config: WaormDatabaseConfig<MemoryEngine>, storeName: string, key: string) => {
  const storeIndexes = engine.indexes.get(storeName)
  if (! storeIndexes) {
    return
  }

  for (const [, indexMap] of storeIndexes) {
    for (const [, keys] of indexMap) {
      const idx = keys.indexOf(key)
      if (idx !== -1) {
        keys.splice(idx, 1)
      }
    }
  }
}

const applyPagination = (items: Resource[], options?: WaormCursorOptions): Resource[] => {
  const offset = options?.offset || 0
  const limit = options?.limit
  const direction = options?.direction || 'asc'

  if (direction !== 'asc') {
    items = [...items].reverse()
  }

  items = items.slice(offset)
  if (limit) {
    items = items.slice(0, limit)
  }

  return items
}

const createDB = (config: WaormDatabaseConfig<MemoryEngine>): WaormDatabaseConnection<MemoryEngine> => {
  const engine: MemoryEngine = { stores: new Map(), indexes: new Map() }

  config.stores.forEach(store => {
    engine.stores.set(store.name, new Map())
    const storeIndexes: StoreIndexes = new Map()
    store.indexes.forEach(index => storeIndexes.set(index.name, new Map()))
    engine.indexes.set(store.name, storeIndexes)
  })

  return {
    name: config.name,
    config,
    getEngine: () => engine,
    get: async (store, key) => {
      return engine.stores.get(store)?.get(key.toString())
    },
    set: async (store, key, data) => {
      engine.stores.get(store)!.set(key.toString(), data)
      updateIndexes(engine, config, store, key.toString(), data)
      return data
    },
    delete: async (store, key) => {
      removeFromIndexes(engine, config, store, key.toString())
      return engine.stores.get(store)?.delete(key.toString()) || false
    },
    where: async (store, index, search, options?: WaormSearchOptions) => {
      const operator = options?.operator || 'equals'
      const storeIndexes = engine.indexes.get(store)
      const indexMap = storeIndexes?.get(index)
      if (! indexMap) {
        return operator === 'equals' ? undefined : []
      }

      const storeData = engine.stores.get(store)!

      switch (operator) {
        case 'equals': {
          const keys = indexMap.get(search.toString())
          if (! keys || keys.length === 0) {
            return undefined
          }
          return storeData.get(keys[0]!)
        }
        case 'equals_many': {
          const items: Resource[] = []
          for (const [k, keys] of indexMap) {
            if (k.toLowerCase() === search.toString().toLowerCase()) {
              for (const key of keys) {
                const r = storeData.get(key)
                if (r) {
                  items.push(r)
                }
              }
            }
          }
          return applyPagination(items, options)
        }
        case 'includes': {
          const items: Resource[] = []
          for (const [k, keys] of indexMap) {
            if (k.toLowerCase().includes(search.toString().toLowerCase())) {
              for (const key of keys) {
                const r = storeData.get(key)
                if (r) {
                  items.push(r)
                }
              }
            }
          }
          return applyPagination(items, options)
        }
        case 'not_equals': {
          const items: Resource[] = []
          for (const [k, keys] of indexMap) {
            if (k.toLowerCase() !== search.toString().toLowerCase()) {
              for (const key of keys) {
                const r = storeData.get(key)
                if (r) {
                  items.push(r)
                }
              }
            }
          }
          return applyPagination(items, options)
        }
        case 'not_includes': {
          const items: Resource[] = []
          for (const [k, keys] of indexMap) {
            if (! k.toLowerCase().includes(search.toString().toLowerCase())) {
              for (const key of keys) {
                const r = storeData.get(key)
                if (r) {
                  items.push(r)
                }
              }
            }
          }
          return applyPagination(items, options)
        }
      }
    },
    all: async (store, index, options) => {
      const storeData = engine.stores.get(store)!

      if (index) {
        const indexMap = engine.indexes.get(store)?.get(index)
        if (! indexMap) {
          return []
        }

        const items: Resource[] = []
        const sortedKeys = [...indexMap.keys()].sort()

        for (const k of sortedKeys) {
          const keys = indexMap.get(k)!
          for (const key of keys) {
            const r = storeData.get(key)
            if (r) {
              items.push(r)
            }
          }
        }

        return applyPagination(items, options)
      }

      const items = [...storeData.values()]
      return applyPagination(items, options)
    },
  }
}

const memoryPlugin: WaormConnectionPlugin<MemoryEngine> = {
  setup: async (config) => createDB(config),
}

export default memoryPlugin
