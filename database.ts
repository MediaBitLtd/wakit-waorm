import type { WaormDatabaseConfig, WaormDatabaseConnection } from './index'
import indexedDB from './plugins/indexedDB'
import { setDBConnection } from './model'
import { DB_INIT_ERROR, dispatch } from './events'
import { withDeletionsStore } from './deletions'

const databases: {[k: string]: WaormDatabaseConnection<any>} = {}

export const clearDatabases = () => {
  for (const k in databases) {
    delete databases[k]
  }
}

export const initDB = async <T = IDBDatabase> (config: WaormDatabaseConfig<T>) => {
  if (databases[config.name]) {
    return databases[config.name] as WaormDatabaseConnection<T>
  }

  const pluginConfig = withDeletionsStore(config)

  try {
    databases[config.name] = config.plugin
      ? await config.plugin.setup(pluginConfig)
      : await indexedDB.setup(pluginConfig as WaormDatabaseConfig<any>)
  } catch (err) {
    dispatch(DB_INIT_ERROR, err)
    throw err
  }

  if (config.default !== false) {
    setDBConnection(databases[config.name] as WaormDatabaseConnection<T>)
  }

  return databases[config.name] as WaormDatabaseConnection<T>
}
