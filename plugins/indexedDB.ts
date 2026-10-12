import type {
  Resource,
  WaormConnectionPlugin,
  WaormDatabaseConfig,
  WaormDatabaseConnection,
} from '../index'
import { DB_BLOCKED, DB_VERSION_CHANGE, dispatch } from '../events'
import { isValueOperator, matchesValue } from '../operators'

interface CursorRequestEventTarget extends EventTarget{
  result: IDBCursorWithValue
}

interface CursorRequestEvent extends Event {
  target: CursorRequestEventTarget;
}

const handleRequest = async <T = any>(request: IDBRequest, callback?: (e: CursorRequestEvent) => boolean) => new Promise<T>(async (resolve, reject) => {
  let resolved = false
  let attempts = 0

  request.onerror = () => {
    resolved = false
    reject(request.error)
  }

  request.onsuccess = e => {
    if (callback && ! callback(e as CursorRequestEvent)) {
      return
    }
    resolved = true
    resolve(request.result as T)
  }

  // Waiting for a second max
  while(! resolved && attempts++ < 100) {
    await (() => new Promise<void>((resolveWait) => {
      setTimeout(() => resolveWait(), 10)
    }))()
  }

  if (! resolved) {
    throw new Error('Database request timed out')
  }
})

const syncSchema = (database: IDBDatabase, transaction: IDBTransaction, config: WaormDatabaseConfig<IDBDatabase>) => {
  if (config.dropUnknownStores) {
    Array.from(database.objectStoreNames)
      .filter(name => ! config.stores.some(store => store.name === name))
      .forEach(name => database.deleteObjectStore(name))
  }

  config.stores.forEach(store => {
    const dbStore = database.objectStoreNames.contains(store.name)
      ? transaction.objectStore(store.name)
      : database.createObjectStore(store.name)

    Array.from(dbStore.indexNames)
      .filter(name => ! store.indexes.some(index => index.name === name))
      .forEach(name => dbStore.deleteIndex(name))

    store.indexes.forEach(({ name, path, unique = false, multiEntry = false }) => {
      const keyPath = path || name

      if (dbStore.indexNames.contains(name)) {
        const existing = dbStore.index(name)

        if (existing.keyPath === keyPath && existing.unique === unique && existing.multiEntry === multiEntry) {
          return
        }

        dbStore.deleteIndex(name)
      }

      dbStore.createIndex(name, keyPath, { unique, multiEntry })
    })
  })
}

const createDatabaseConnection = (config: WaormDatabaseConfig<IDBDatabase>, idb: IDBDatabase): WaormDatabaseConnection<IDBDatabase> => {
  // Let newer versions (e.g. another tab) upgrade instead of being blocked by this connection
  idb.onversionchange = e => {
    dispatch(DB_VERSION_CHANGE, { name: idb.name, oldVersion: e.oldVersion, newVersion: e.newVersion })
    idb.close()
  }

  return {
    name: idb.name,
    config,
    getEngine: () => idb,
    get: async (store, key) => {
      return await handleRequest<Resource|undefined>(idb
        .transaction(store, 'readonly')
        .objectStore(store)
        .get(key))
    },
    set: async (store, key, data) => {
      await handleRequest<Resource|undefined>(idb
        .transaction(store, 'readwrite')
        .objectStore(store)
        .put(data, key))

      return data
    },
    delete: async (store, key) => {
      try {
        await handleRequest<Resource|undefined>(idb
          .transaction(store, 'readwrite')
          .objectStore(store)
          .delete(key))
      } catch (err) {
        return false
      }

      return true
    },
    where: async (store, index, search, options) => {
      const limit = options?.limit
      const offset = options?.offset || 0
      const operator = options?.operator || 'equals'
      const direction = options?.direction || 'asc'
      const items: Resource[] = []

      let idbDirection: IDBCursorDirection = 'next'
      let range: IDBKeyRange | undefined
      let hasAdvanced = false

      switch (direction) {
        case 'asc': idbDirection = 'next'; break
        case 'desc': idbDirection = 'prev'; break
      }

      if (isValueOperator(operator)) {
        const objectStore = idb.transaction(store, 'readonly').objectStore(store)
        const path = objectStore.index(index).keyPath as string
        let skipped = 0

        // Scan the store, the index never holds null / empty values
        await handleRequest<IDBCursorWithValue>(objectStore.openCursor(undefined, idbDirection), e => {
          const cursor = e.target.result

          if (! cursor || (limit && items.length >= limit)) {
            return true
          }

          if (matchesValue(cursor.value?.[path], operator)) {
            if (skipped < offset) {
              skipped++
            } else {
              items.push(cursor.value)
            }
          }

          cursor.continue()
          return false
        })

        return items
      }

      switch (operator) {
        case 'equals': range = IDBKeyRange.only(search); break
      }

      await handleRequest<IDBCursorWithValue>(idb
        .transaction(store, 'readonly')
        .objectStore(store)
        .index(index)
        .openCursor(range, idbDirection),
      e => {
          const cursor = e.target.result

          if (cursor) {
            if (! hasAdvanced) {
              hasAdvanced = true

              if (offset) {
                cursor.advance(offset)
                return false
              }
            }

            if (limit && items.length >= limit) {
              // stop iterating
              return true
            }

            // Index key resolves the index path (cursor.value[index] breaks when path differs from name)
            const indexedValue = cursor.key.toString()

            switch (operator) {
              case 'equals':
                items.push(cursor.value)
                break
              case 'equals_many':
                if (indexedValue === search?.toString()) {
                  items.push(cursor.value)
                }
                break
              case 'not_equals':
                if (indexedValue !== search?.toString()) {
                  items.push(cursor.value)
                }
                break
              case 'includes':
                if (indexedValue.includes(search?.toString())) {
                  items.push(cursor.value)
                }
                break
              case 'not_includes':
                if (! indexedValue.includes(search?.toString())) {
                  items.push(cursor.value)
                }
                break
            }

            cursor.continue()
            return false
          }

          // we are done looping :)
          return true
        })

      if (operator === 'equals') {
        return items[0]
      }

      return items
    },
    all: async (store, index, options) => {
      const limit = options?.limit
      const offset = options?.offset || 0
      const direction = options?.direction || 'asc'
      const items: Resource[] = []
      const idbDirection: IDBCursorDirection = direction === 'asc' ? 'next' : 'prev'

      let hasAdvanced = false

      const transaction = index
        ? idb.transaction(store, 'readonly')
          .objectStore(store)
          .index(index)
        : idb.transaction(store, 'readonly')
          .objectStore(store)

      await handleRequest<IDBCursorWithValue>(
        transaction.openCursor(undefined, idbDirection),
        e => {
          const cursor = e.target.result

          if (cursor) {
            if (! hasAdvanced) {
              hasAdvanced = true

              if (offset) {
                cursor.advance(offset)
                return false
              }
            }

            if (limit && items.length >= limit) {
              // stop iterating
              return true
            }

            items.push(cursor.value)

            cursor.continue()
            return false
          }

          // we are done looping :)
          return true
        })

      return items
    }
  }
}

const plugin: WaormConnectionPlugin<IDBDatabase> = {
  setup: async (config) => {
    const openRequest = indexedDB.open(config.name, config.version)

    // Request stays pending until other connections close
    openRequest.onblocked = e => {
      dispatch(DB_BLOCKED, { name: config.name, oldVersion: e.oldVersion, newVersion: e.newVersion })
    }

    openRequest.onupgradeneeded = () => syncSchema(openRequest.result, openRequest.transaction!, config)

    const idb = await handleRequest<IDBDatabase>(openRequest)

    return createDatabaseConnection(config, idb)
  }
}

export default plugin
