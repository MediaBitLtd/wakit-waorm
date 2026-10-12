import 'fake-indexeddb/auto'
import { describe, it, expect, vi, afterEach } from 'vitest'
import plugin from '../../plugins/indexedDB'
import { clearEventListeners, onDatabaseBlocked, onDatabaseVersionChange } from '../../events'
import type { WaormDatabaseConfig } from '../../index'
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

    it('includes works on index with custom path', async () => {
      const conn = await plugin.setup(makeConfig(uniqueName()))
      await seed(conn)

      expect(names(await conn.where('users', 'mail', 'b@', { operator: 'includes' }))).toEqual(['Bob'])
    })
  })

  describe('version change', () => {
    afterEach(() => clearEventListeners())

    it('dispatches blocked and waits for other connections to close', async () => {
      const name = uniqueName()
      const blocked = vi.fn()
      onDatabaseBlocked(blocked)

      const raw = await new Promise<IDBDatabase>(resolve => {
        const request = indexedDB.open(name, 1)
        request.onsuccess = () => resolve(request.result)
      })

      const pending = plugin.setup({ ...makeConfig<IDBDatabase>(name), version: 2 })
      await vi.waitFor(() => expect(blocked).toHaveBeenCalledWith({ name, oldVersion: 1, newVersion: 2 }))

      raw.close()
      expect((await pending).getEngine()?.version).toBe(2)
    })

    it('dispatches version change and closes old connection', async () => {
      const name = uniqueName()
      const versionChange = vi.fn()
      onDatabaseVersionChange(versionChange)

      const first = await plugin.setup(makeConfig(name))
      await seed(first)

      const second = await plugin.setup({ ...makeConfig<IDBDatabase>(name), version: 2 })

      expect(versionChange).toHaveBeenCalledWith({ name, oldVersion: 1, newVersion: 2 })
      await expect(first.get('users', 'u1')).rejects.toThrow()
      expect(await second.get('users', 'u1')).toMatchObject({ name: 'Alice' })
    })
  })

  describe('schema sync', () => {
    const upgrade = async (name: string, config: WaormDatabaseConfig<IDBDatabase>) => {
      const first = await plugin.setup(makeConfig(name))
      await seed(first)

      return (await plugin.setup({ ...config, name, version: 2 })).getEngine()!
    }

    const users = (idb: IDBDatabase) => idb.transaction('users', 'readonly').objectStore('users')

    it('removes indexes not in config', async () => {
      const idb = await upgrade(uniqueName(), {
        name: '',
        stores: [{ name: 'users', indexes: [{ name: 'name' }] }],
      })

      expect([...users(idb).indexNames]).toEqual(['name'])
    })

    it('recreates indexes whose definition changed', async () => {
      const idb = await upgrade(uniqueName(), {
        name: '',
        stores: [{ name: 'users', indexes: [{ name: 'name', unique: true }, { name: 'email' }, { name: 'mail', path: 'name' }] }],
      })

      expect(users(idb).index('name').unique).toBe(true)
      expect(users(idb).index('mail').keyPath).toBe('name')
    })

    it('creates and recreates multiEntry indexes', async () => {
      const idb = await upgrade(uniqueName(), {
        name: '',
        stores: [{ name: 'users', indexes: [{ name: 'roles' }] }],
      })

      expect(users(idb).index('roles').multiEntry).toBe(false)

      const name = uniqueName()
      const first = await plugin.setup(makeConfig(name))
      expect(users(first.getEngine()!).index('roles').multiEntry).toBe(true)
    })

    it('keeps data in existing stores', async () => {
      const name = uniqueName()
      await upgrade(name, { name: '', stores: [{ name: 'users', indexes: [{ name: 'name' }] }] })
      const conn = await plugin.setup({ ...makeConfig<IDBDatabase>(name), version: 3 })

      expect(names(await conn.all('users'))).toEqual(['Alice', 'Bob', 'Charlie', 'Alicia'])
      expect(await conn.where('users', 'email', 'c@t.com')).toMatchObject({ id: 'u3' })
    })

    it('keeps unknown stores by default', async () => {
      const idb = await upgrade(uniqueName(), { name: '', stores: [{ name: 'posts', indexes: [] }] })

      expect([...idb.objectStoreNames].sort()).toEqual(['posts', 'users'])
    })

    it('drops unknown stores with dropUnknownStores', async () => {
      const idb = await upgrade(uniqueName(), { name: '', dropUnknownStores: true, stores: [{ name: 'posts', indexes: [] }] })

      expect([...idb.objectStoreNames]).toEqual(['posts'])
    })
  })
})
