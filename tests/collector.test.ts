import { describe, it, expect, beforeEach, vi } from 'vitest'
import { initDB } from '../database'
import { clearDatabases } from '../database'
import { setDBConnection } from '../model'
import { collect } from '../collector'
import { deletions } from '../deletions'
import { ActivityModel, UserModel } from './helpers/fixtures'
import memoryPlugin from './helpers/memoryPlugin'

beforeEach(async () => {
  clearDatabases()
  setDBConnection()
  await initDB({
    name: 'collector-test-' + Math.random(),
    version: 1,
    plugin: memoryPlugin,
    stores: [{ name: 'users', indexes: [{ name: 'email' }, { name: 'name' }] }],
  })

  await new UserModel().hydrate({ id: 'u1', name: 'Alice', email: 'a@t.com' }).save()
  await new UserModel().hydrate({ id: 'u2', name: 'Bob', email: 'b@t.com' }).save()
  await new UserModel().hydrate({ id: 'u3', name: 'Charlie', email: 'c@t.com' }).save()
})

describe('collector', () => {
  it('items returns all models', async () => {
    const items = await collect(new UserModel().all()).items()
    expect(items.length).toBe(3)
  })

  it('count returns correct length', async () => {
    const count = await collect(new UserModel().all()).count()
    expect(count).toBe(3)
  })

  it('each calls callback for every item', async () => {
    const cb = vi.fn()
    await collect(new UserModel().all()).each(cb)
    expect(cb).toHaveBeenCalledTimes(3)
  })

  it('delete removes all items', async () => {
    const result = await collect(new UserModel().all()).delete()
    expect(result).toBe(true)

    const remaining = await new UserModel().all()
    expect(remaining.length).toBe(0)
  })

  describe('deletion tracking', () => {
    beforeEach(async () => {
      clearDatabases()
      setDBConnection()
      await initDB({
        name: 'collector-tracked-' + Math.random(),
        plugin: memoryPlugin,
        trackDeletions: true,
        stores: [{ name: 'activities', indexes: [{ name: 'title' }] }],
      })

      await new ActivityModel().hydrate({ id: 'a1', title: 'Run' }).save()
      await new ActivityModel().hydrate({ id: 'a2', title: 'Swim' }).save()
    })

    it('delete tracks every item', async () => {
      await collect(new ActivityModel().all()).delete()

      expect((await deletions('activities')).map(d => d.key).sort()).toEqual(['a1', 'a2'])
    })

    it('delete forwards track: false', async () => {
      await collect(new ActivityModel().all()).delete({ track: false })

      expect(await new ActivityModel().all()).toEqual([])
      expect(await deletions('activities')).toEqual([])
    })
  })

  it('itemsAsResource returns plain objects', async () => {
    const resources = await collect(new UserModel().all()).itemsAsResource<any>()
    expect(resources.length).toBe(3)
    expect(resources[0]).toHaveProperty('name')
    // Should not be a Model instance
    expect(resources[0]).not.toBeInstanceOf(UserModel)
  })
})
