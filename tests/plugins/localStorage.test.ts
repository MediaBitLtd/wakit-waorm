// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import plugin from '../../plugins/localStorage'
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
})
