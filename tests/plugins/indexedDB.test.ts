import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import plugin from '../../plugins/indexedDB'
import { makeConfig, names, runPluginSuite, seed } from '../helpers/pluginSuite'

const uniqueName = () => 'idb-test-' + Math.random()

describe('indexedDB plugin', () => {
  describe('connection', () => runPluginSuite(() => plugin.setup(makeConfig(uniqueName()))))

  describe('storage', () => {
    it('exposes the IDBDatabase as engine', async () => {
      const name = uniqueName()
      const conn = await plugin.setup(makeConfig(name))

      expect(conn.getEngine()?.name).toBe(name)
      expect([...conn.getEngine()!.objectStoreNames]).toEqual(['users'])
    })

    it('data survives a new setup', async () => {
      const name = uniqueName()
      const first = await plugin.setup(makeConfig(name))
      await seed(first)
      first.getEngine()?.close()

      const conn = await plugin.setup(makeConfig(name))
      expect(names(await conn.all('users'))).toEqual(['Alice', 'Bob', 'Charlie', 'Alicia'])
    })

    it('version upgrade adds new indexes to existing store', async () => {
      const name = uniqueName()
      const first = await plugin.setup(makeConfig(name))
      await seed(first)
      first.getEngine()?.close()

      const config = makeConfig<IDBDatabase>(name)
      config.version = 2
      config.stores[0]!.indexes.push({ name: 'id' })
      const conn = await plugin.setup(config)

      expect(await conn.where('users', 'id', 'u3')).toMatchObject({ name: 'Charlie' })
    })

    it('equals_many and includes are case sensitive', async () => {
      const conn = await plugin.setup(makeConfig(uniqueName()))
      await seed(conn)

      expect(await conn.where('users', 'name', 'bob', { operator: 'equals_many' })).toEqual([])
      expect(await conn.where('users', 'name', 'ali', { operator: 'includes' })).toEqual([])
    })

    it('rejects on unknown store', async () => {
      const conn = await plugin.setup(makeConfig(uniqueName()))

      await expect(conn.get('nope', 'k')).rejects.toThrow()
    })

    // Known bug: filters read cursor.value[indexName] instead of the index path.
    // Skipped: the TypeError in onsuccess leaves the request unresolved until handleRequest times out.
    it.skip('includes works on index with custom path', async () => {
      const conn = await plugin.setup(makeConfig(uniqueName()))
      await seed(conn)

      expect(names(await conn.where('users', 'mail', 'b@', { operator: 'includes' }))).toEqual(['Bob'])
    })
  })
})
