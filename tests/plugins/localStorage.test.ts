// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import plugin from '../../plugins/localStorage'
import type { Resource, WaormDatabaseConfig } from '../../index'
import { makeConfig, names, runPluginSuite, seed } from '../helpers/pluginSuite'

describe('localStorage plugin', () => {
  beforeEach(() => localStorage.clear())

  describe('connection', () => runPluginSuite(() => plugin.setup(makeConfig('ls-test'))))

  describe('storage', () => {
    it('setup creates index table per store', async () => {
      await plugin.setup(makeConfig('ls-test'))

      const table = JSON.parse(localStorage.getItem('WAORM:__ls-test_users')!)
      expect(table.__keys).toEqual([])
      expect(table.mail).toMatchObject({ key: 'email', table: '__ls-test_users_mail' })
    })

    it('data survives a new setup', async () => {
      await seed(await plugin.setup(makeConfig('ls-test')))
      const conn = await plugin.setup(makeConfig('ls-test'))

      expect(names(await conn.all('users'))).toEqual(['Alice', 'Bob', 'Charlie', 'Alicia'])
    })

    it('equals_many and includes are case insensitive', async () => {
      const conn = await plugin.setup(makeConfig('ls-test'))
      await seed(conn)

      expect(names(await conn.where('users', 'name', 'bob', { operator: 'equals_many' }))).toEqual(['Bob'])
      expect(names(await conn.where('users', 'name', 'ali', { operator: 'includes' }))).toEqual(['Alice', 'Alicia'])
    })

    it('throws on unknown store', async () => {
      const conn = await plugin.setup(makeConfig('ls-test'))

      await expect(conn.set('nope', 'k', {})).rejects.toThrow('Invalid store')
      await expect(conn.delete('nope', 'k')).rejects.toThrow('Invalid store')
    })
  })

  describe('schema sync', () => {
    const resync = async (config: WaormDatabaseConfig<WindowLocalStorage>) => {
      await seed(await plugin.setup(makeConfig('ls-test')))

      return plugin.setup({ ...config, name: 'ls-test' })
    }

    it('removes indexes not in config', async () => {
      await resync({ name: '', stores: [{ name: 'users', indexes: [{ name: 'name' }] }] })

      const table = JSON.parse(localStorage.getItem('WAORM:__ls-test_users')!)
      expect(Object.keys(table).sort()).toEqual(['__keys', 'name'])
      expect(localStorage.getItem('WAORM:__ls-test_users_email')).toBeNull()
      expect(localStorage.getItem('WAORM:__ls-test_users_mail')).toBeNull()
    })

    it('fills new index from existing data', async () => {
      const conn = await resync({ name: '', stores: [{ name: 'users', indexes: [{ name: 'name' }, { name: 'id' }] }] })

      expect(await conn.where('users', 'id', 'u3')).toMatchObject({ name: 'Charlie' })
    })

    it('rebuilds index whose path changed', async () => {
      const conn = await resync({ name: '', stores: [{ name: 'users', indexes: [{ name: 'mail', path: 'name' }] }] })

      expect(await conn.where('users', 'mail', 'Bob')).toMatchObject({ id: 'u2' })
      expect(await conn.where('users', 'mail', 'b@t.com')).toBeUndefined()
    })

    it('rebuilds index whose multiEntry changed', async () => {
      const conn = await plugin.setup(makeConfig('ls-test'))
      await conn.set('users', 'u1', { id: 'u1', name: 'Alice', roles: ['admin', 'editor'] } as Resource)

      const flat = await plugin.setup({ name: 'ls-test', stores: [{ name: 'users', indexes: [{ name: 'roles' }] }] })
      expect(await flat.where('users', 'roles', 'admin')).toBeUndefined()
      expect(await flat.where('users', 'roles', 'admin,editor')).toMatchObject({ id: 'u1' })

      const multi = await plugin.setup({ name: 'ls-test', stores: [{ name: 'users', indexes: [{ name: 'roles', multiEntry: true }] }] })
      expect(await multi.where('users', 'roles', 'editor')).toMatchObject({ id: 'u1' })
    })

    it('keeps unknown stores by default', async () => {
      await resync({ name: '', stores: [{ name: 'posts', indexes: [] }] })

      const back = await plugin.setup(makeConfig('ls-test'))
      expect(names(await back.all('users'))).toEqual(['Alice', 'Bob', 'Charlie', 'Alicia'])
    })

    it('drops unknown stores with dropUnknownStores', async () => {
      await resync({ name: '', dropUnknownStores: true, stores: [{ name: 'posts', indexes: [] }] })

      const leftovers = Object.keys(localStorage).filter(key => key.includes('_users'))
      expect(leftovers).toEqual([])
    })

    it('drops stores unknown from an earlier setup', async () => {
      await resync({ name: '', stores: [{ name: 'posts', indexes: [] }] })
      await plugin.setup({ name: 'ls-test', dropUnknownStores: true, stores: [{ name: 'posts', indexes: [] }] })

      expect(Object.keys(localStorage).filter(key => key.includes('_users'))).toEqual([])
    })
  })
})
