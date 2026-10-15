import { describe, it, expect, beforeEach } from 'vitest'
import type { Resource, WaormDatabaseConfig, WaormDatabaseConnection } from '../../index'
import { DELETIONS_STORE, withDeletionsStore } from '../../deletions'

export const makeConfig = <T>(name: string, trackDeletions = false): WaormDatabaseConfig<T> => withDeletionsStore({
  name,
  version: 1,
  trackDeletions,
  stores: [
    { name: 'users', indexes: [{ name: 'name' }, { name: 'email' }, { name: 'mail', path: 'email' }, { name: 'roles', multiEntry: true }] },
  ],
})

export const seed = async <T>(conn: WaormDatabaseConnection<T>) => {
  await conn.set('users', 'u1', { id: 'u1', name: 'Alice', email: 'a@t.com' } as Resource)
  await conn.set('users', 'u2', { id: 'u2', name: 'Bob', email: 'b@t.com' } as Resource)
  await conn.set('users', 'u3', { id: 'u3', name: 'Charlie', email: 'c@t.com' } as Resource)
  await conn.set('users', 'u4', { id: 'u4', name: 'Alicia', email: 'd@t.com' } as Resource)
}

export const names = (result: Resource[] | Resource | undefined) => (result as { name: string }[]).map(r => r.name)

export const runPluginSuite = <T>(connect: () => Promise<WaormDatabaseConnection<T>>) => {
  let conn: WaormDatabaseConnection<T>

  beforeEach(async () => {
    conn = await connect()
    await seed(conn)
  })

  describe('get / set / delete', () => {
    it('returns stored resource', async () => {
      expect(await conn.get('users', 'u1')).toEqual({ id: 'u1', name: 'Alice', email: 'a@t.com' })
    })

    it('returns undefined for missing key', async () => {
      expect(await conn.get('users', 'nope')).toBeUndefined()
    })

    it('set returns the data', async () => {
      const data = { id: 'u5', name: 'Eve' } as Resource
      expect(await conn.set('users', 'u5', data)).toEqual(data)
    })

    it('set overwrites and reindexes', async () => {
      await conn.set('users', 'u1', { id: 'u1', name: 'Alice2', email: 'a@t.com' } as Resource)

      expect(await conn.get('users', 'u1')).toMatchObject({ name: 'Alice2' })
      expect(await conn.where('users', 'name', 'Alice')).toBeUndefined()
      expect(await conn.where('users', 'name', 'Alice2')).toMatchObject({ id: 'u1' })
    })

    it('delete removes resource and its index entries', async () => {
      expect(await conn.delete('users', 'u2')).toBe(true)

      expect(await conn.get('users', 'u2')).toBeUndefined()
      expect(await conn.where('users', 'name', 'Bob')).toBeUndefined()
      expect(names(await conn.all('users'))).toEqual(['Alice', 'Charlie', 'Alicia'])
    })
  })

  describe('all', () => {
    it('returns every resource ordered by key', async () => {
      expect(names(await conn.all('users'))).toEqual(['Alice', 'Bob', 'Charlie', 'Alicia'])
    })

    it('desc reverses key order', async () => {
      expect(names(await conn.all('users', undefined, { direction: 'desc' }))).toEqual(['Alicia', 'Charlie', 'Bob', 'Alice'])
    })

    it('orders by index value', async () => {
      expect(names(await conn.all('users', 'name'))).toEqual(['Alice', 'Alicia', 'Bob', 'Charlie'])
    })

    it('desc reverses index order', async () => {
      expect(names(await conn.all('users', 'name', { direction: 'desc' }))).toEqual(['Charlie', 'Bob', 'Alicia', 'Alice'])
    })

    it('respects limit and offset', async () => {
      expect(names(await conn.all('users', undefined, { limit: 2 }))).toEqual(['Alice', 'Bob'])
      expect(names(await conn.all('users', undefined, { limit: 2, offset: 1 }))).toEqual(['Bob', 'Charlie'])
      expect(names(await conn.all('users', undefined, { offset: 10 }))).toEqual([])
    })

    it('returns empty array for empty store', async () => {
      for (const id of ['u1', 'u2', 'u3', 'u4']) {
        await conn.delete('users', id)
      }

      expect(await conn.all('users')).toEqual([])
    })
  })

  describe('where', () => {
    it('equals returns single resource', async () => {
      expect(await conn.where('users', 'name', 'Bob')).toMatchObject({ id: 'u2' })
    })

    it('equals returns undefined when no match', async () => {
      expect(await conn.where('users', 'name', 'Zed')).toBeUndefined()
    })

    it('equals works on index with custom path', async () => {
      expect(await conn.where('users', 'mail', 'b@t.com')).toMatchObject({ id: 'u2' })
    })

    it('equals_many returns exact matches', async () => {
      await conn.set('users', 'u5', { id: 'u5', name: 'Bob', email: 'e@t.com' } as Resource)

      const result = await conn.where('users', 'name', 'Bob', { operator: 'equals_many' }) as Resource[]
      expect(result.map(r => r.id).sort()).toEqual(['u2', 'u5'])
    })

    it('not_equals excludes match', async () => {
      expect(names(await conn.where('users', 'name', 'Bob', { operator: 'not_equals' }))).toEqual(['Alice', 'Alicia', 'Charlie'])
    })

    it('includes matches substring', async () => {
      expect(names(await conn.where('users', 'name', 'Ali', { operator: 'includes' }))).toEqual(['Alice', 'Alicia'])
    })

    it('not_includes excludes substring', async () => {
      expect(names(await conn.where('users', 'name', 'Ali', { operator: 'not_includes' }))).toEqual(['Bob', 'Charlie'])
    })

    it('desc reverses order', async () => {
      expect(names(await conn.where('users', 'name', 'Ali', { operator: 'includes', direction: 'desc' }))).toEqual(['Alicia', 'Alice'])
    })

    it('respects limit', async () => {
      expect(names(await conn.where('users', 'email', 't.com', { operator: 'includes', limit: 2 }))).toEqual(['Alice', 'Bob'])
    })

    it('respects offset', async () => {
      expect(names(await conn.where('users', 'name', 'Ali', { operator: 'includes', offset: 1 }))).toEqual(['Alicia'])
    })
  })

  describe('value operators', () => {
    const ids = (result: Resource[] | Resource | undefined) => (result as Resource[]).map(r => r.id)

    beforeEach(async () => {
      await conn.set('users', 'u5', { id: 'u5', name: 'Eve', email: null } as unknown as Resource)
      await conn.set('users', 'u6', { id: 'u6', name: 'Frank', roles: {} } as unknown as Resource)
      await conn.set('users', 'u7', { id: 'u7', name: 'Gina', email: '' } as Resource)
      await conn.set('users', 'u8', { id: 'u8', name: 'Hank', email: 'h@t.com', roles: [] } as Resource)
      await conn.set('users', 'u9', { id: 'u9', name: 'Ivy', email: 'i@t.com', roles: ['admin'] } as Resource)
    })

    it('is_null matches null and missing', async () => {
      expect(ids(await conn.where('users', 'email', '', { operator: 'is_null' }))).toEqual(['u5', 'u6'])
    })

    it('is_not_null keeps empty string', async () => {
      expect(ids(await conn.where('users', 'email', '', { operator: 'is_not_null' }))).toEqual(['u1', 'u2', 'u3', 'u4', 'u7', 'u8', 'u9'])
    })

    it('empty matches null, missing and empty string', async () => {
      expect(ids(await conn.where('users', 'email', '', { operator: 'empty' }))).toEqual(['u5', 'u6', 'u7'])
      expect(ids(await conn.where('users', 'email', '', { operator: 'not_empty' }))).toEqual(['u1', 'u2', 'u3', 'u4', 'u8', 'u9'])
    })

    it('empty matches empty arrays and objects', async () => {
      expect(ids(await conn.where('users', 'roles', '', { operator: 'empty' }))).toEqual(['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'])
      expect(ids(await conn.where('users', 'roles', '', { operator: 'not_empty' }))).toEqual(['u9'])
    })

    it('uses index path', async () => {
      expect(ids(await conn.where('users', 'mail', '', { operator: 'is_null' }))).toEqual(['u5', 'u6'])
    })

    it('applies direction, offset and limit to matches', async () => {
      expect(ids(await conn.where('users', 'email', '', { operator: 'empty', direction: 'desc' }))).toEqual(['u7', 'u6', 'u5'])
      expect(ids(await conn.where('users', 'email', '', { operator: 'empty', offset: 1 }))).toEqual(['u6', 'u7'])
      expect(ids(await conn.where('users', 'email', '', { operator: 'empty', offset: 1, limit: 1 }))).toEqual(['u6'])
    })
  })

  describe('tracked writes', () => {
    const tombstone = (key: string) => ({ store: 'users', key, deleted_at: '2026-01-01T00:00:00.000Z', data: { id: key } })

    it('deleteTracked removes resource and writes tombstone', async () => {
      expect(await conn.deleteTracked('users', 'u2', tombstone('u2'))).toBe(true)

      expect(await conn.get('users', 'u2')).toBeUndefined()
      expect(await conn.where('users', 'name', 'Bob')).toBeUndefined()
      expect(await conn.get(DELETIONS_STORE, 'users:u2')).toEqual(tombstone('u2'))
    })

    it('tombstones are indexed by store', async () => {
      await conn.deleteTracked('users', 'u1', tombstone('u1'))
      await conn.deleteTracked('users', 'u2', tombstone('u2'))

      const result = await conn.where(DELETIONS_STORE, 'store', 'users', { operator: 'equals_many' }) as unknown as { key: string }[]
      expect(result.map(r => r.key).sort()).toEqual(['u1', 'u2'])
    })

    it('setTracked writes resource and removes tombstone', async () => {
      await conn.deleteTracked('users', 'u2', tombstone('u2'))
      const data = { id: 'u2', name: 'Bob', email: 'b@t.com' } as Resource

      expect(await conn.setTracked('users', 'u2', data)).toEqual(data)
      expect(await conn.get('users', 'u2')).toEqual(data)
      expect(await conn.get(DELETIONS_STORE, 'users:u2')).toBeUndefined()
      expect(await conn.all(DELETIONS_STORE)).toEqual([])
    })
  })

  describe('multiEntry index', () => {
    const ids = (result: Resource[] | Resource | undefined) => (result as Resource[]).map(r => r.id).sort()

    beforeEach(async () => {
      await conn.set('users', 'u1', { id: 'u1', name: 'Alice', email: 'a@t.com', roles: ['admin', 'editor'] } as Resource)
      await conn.set('users', 'u2', { id: 'u2', name: 'Bob', email: 'b@t.com', roles: ['editor'] } as Resource)
    })

    it('equals matches any array element', async () => {
      expect(await conn.where('users', 'roles', 'admin')).toMatchObject({ id: 'u1' })
    })

    it('equals_many returns every resource containing the element', async () => {
      expect(ids(await conn.where('users', 'roles', 'editor', { operator: 'equals_many' }))).toEqual(['u1', 'u2'])
      expect(ids(await conn.where('users', 'roles', 'admin', { operator: 'equals_many' }))).toEqual(['u1'])
    })

    it('set reindexes removed elements', async () => {
      await conn.set('users', 'u1', { id: 'u1', name: 'Alice', email: 'a@t.com', roles: ['admin'] } as Resource)

      expect(ids(await conn.where('users', 'roles', 'editor', { operator: 'equals_many' }))).toEqual(['u2'])
    })

    it('delete removes every element entry', async () => {
      await conn.delete('users', 'u1')

      expect(await conn.where('users', 'roles', 'admin')).toBeUndefined()
      expect(ids(await conn.where('users', 'roles', 'editor', { operator: 'equals_many' }))).toEqual(['u2'])
    })
  })
}
