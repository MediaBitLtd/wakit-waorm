import { describe, it, expect, beforeEach } from 'vitest'
import { initDB } from '../database'
import { clearDatabases } from '../database'
import { setDBConnection } from '../model'
import { UserModel, PostModel, SlugModel } from './helpers/fixtures'
import memoryPlugin from './helpers/memoryPlugin'

const dbConfig = {
  name: 'model-test',
  version: 1,
  plugin: memoryPlugin,
  stores: [
    { name: 'users', indexes: [{ name: 'email' }, { name: 'name' }] },
    { name: 'posts', indexes: [{ name: 'title' }, { name: 'user_id' }] },
    { name: 'slugs', indexes: [{ name: 'name' }] },
  ],
}

beforeEach(async () => {
  clearDatabases()
  setDBConnection()
  await initDB({ ...dbConfig, name: 'model-test-' + Math.random() })
})

describe('hydrate & state tracking', () => {
  it('populates fields and marks as instance', () => {
    const user = new UserModel().hydrate({ id: '1', name: 'Alice', email: 'alice@test.com' })
    expect(user.id).toBe('1')
    expect(user.name).toBe('Alice')
    expect(user.email).toBe('alice@test.com')
    expect(user.isInstance()).toBe(true)
  })

  it('isNew is false when key exists and not generated', () => {
    const user = new UserModel().hydrate({ id: '1', name: 'Alice' })
    expect(user.isNew()).toBe(false)
  })

  it('isNew is true when no key', () => {
    const user = new UserModel().hydrate({ name: 'Alice' })
    expect(user.isNew()).toBe(true)
  })

  it('isNew is true when key starts with generated', () => {
    const user = new UserModel().hydrate({ id: 'generated_abc', name: 'Alice' })
    expect(user.isNew()).toBe(true)
  })

  it('isClean after hydrate, isDirty after mutation', () => {
    const user = new UserModel().hydrate({ id: '1', name: 'Alice' })
    expect(user.isClean()).toBe(true)
    expect(user.isDirty()).toBe(false)

    user.name = 'Bob'
    expect(user.isDirty()).toBe(true)
    expect(user.isClean()).toBe(false)
  })

  it('filters fields when fields() is defined', () => {
    const user = new UserModel().hydrate({ id: '1', name: 'Alice', extra: 'ignored' } as any)
    expect((user as any).extra).toBeUndefined()
  })

  it('newInstance returns fresh non-instance model', () => {
    const user = new UserModel().hydrate({ id: '1', name: 'Alice' })
    const fresh = user.newInstance()
    expect(fresh).toBeInstanceOf(UserModel)
    expect(fresh.isInstance()).toBe(false)
    expect(fresh.id).toBeUndefined()
  })
})

describe('save', () => {
  it('saves new record with auto-generated key', async () => {
    const user = new UserModel().hydrate({ name: 'Alice', email: 'alice@test.com' })
    await user.save()
    expect(user.id).toBeDefined()
    expect(user.id!.toString().startsWith('generated_')).toBe(true)
  })

  it('saves and retrieves record', async () => {
    const user = new UserModel().hydrate({ id: 'u1', name: 'Alice', email: 'alice@test.com' })
    await user.save()

    const found = await new UserModel().get('u1')
    expect(found).toBeDefined()
    expect(found!.name).toBe('Alice')
    expect(found!.email).toBe('alice@test.com')
  })

  it('updates existing record', async () => {
    const user = new UserModel().hydrate({ id: 'u1', name: 'Alice', email: 'alice@test.com' })
    await user.save()

    user.name = 'Bob'
    await user.save()

    const found = await new UserModel().get('u1')
    expect(found!.name).toBe('Bob')
  })
})

describe('get', () => {
  it('returns hydrated model for existing key', async () => {
    await new UserModel().hydrate({ id: 'u1', name: 'Alice', email: 'a@b.com' }).save()

    const user = await new UserModel().get('u1')
    expect(user).toBeDefined()
    expect(user!.name).toBe('Alice')
    expect(user!.isInstance()).toBe(true)
    expect(user!.isNew()).toBe(false)
  })

  it('returns undefined for missing key', async () => {
    const user = await new UserModel().get('nonexistent')
    expect(user).toBeUndefined()
  })
})

describe('delete', () => {
  it('removes record from store', async () => {
    await new UserModel().hydrate({ id: 'u1', name: 'Alice', email: 'a@b.com' }).save()

    const user = await new UserModel().get('u1')
    const result = await user!.delete()
    expect(result).toBe(true)

    const gone = await new UserModel().get('u1')
    expect(gone).toBeUndefined()
  })

  it('throws when model has no key', async () => {
    const user = new UserModel()
    await expect(user.delete()).rejects.toThrow('Model has no key')
  })
})

describe('find', () => {
  it('finds single record by indexed field', async () => {
    await new UserModel().hydrate({ id: 'u1', name: 'Alice', email: 'alice@test.com' }).save()
    await new UserModel().hydrate({ id: 'u2', name: 'Bob', email: 'bob@test.com' }).save()

    const found = await new UserModel().find('email', 'alice@test.com')
    expect(found).toBeDefined()
    expect(found!.name).toBe('Alice')
  })

  it('returns undefined when not found', async () => {
    const found = await new UserModel().find('email', 'nobody@test.com')
    expect(found).toBeUndefined()
  })
})

describe('many', () => {
  beforeEach(async () => {
    await new UserModel().hydrate({ id: 'u1', name: 'Alice', email: 'alice@test.com' }).save()
    await new UserModel().hydrate({ id: 'u2', name: 'Bob', email: 'bob@test.com' }).save()
    await new UserModel().hydrate({ id: 'u3', name: 'Charlie', email: 'charlie@test.com' }).save()
    await new UserModel().hydrate({ id: 'u4', name: 'Alicia', email: 'alicia@test.com' }).save()
  })

  it('defaults to includes operator', async () => {
    const results = await new UserModel().many('name', 'Ali')
    expect(results.length).toBe(2)
    expect(results.map(u => u.name).sort()).toEqual(['Alice', 'Alicia'])
  })

  it('equals_many operator matches exact', async () => {
    const results = await new UserModel().many('name', 'Alice', { operator: 'equals_many' })
    expect(results.length).toBe(1)
    expect(results[0]!.name).toBe('Alice')
  })

  it('not_equals operator excludes match', async () => {
    const results = await new UserModel().many('name', 'Alice', { operator: 'not_equals' })
    expect(results.every(u => u.name !== 'Alice')).toBe(true)
    expect(results.length).toBe(3)
  })

  it('not_includes operator excludes partial match', async () => {
    const results = await new UserModel().many('name', 'Ali', { operator: 'not_includes' })
    expect(results.every(u => ! u.name!.includes('Ali'))).toBe(true)
  })

  it('respects limit', async () => {
    const results = await new UserModel().many('email', 'test.com', { operator: 'includes', limit: 2 })
    expect(results.length).toBe(2)
  })

  it('respects offset', async () => {
    const all = await new UserModel().many('email', 'test.com', { operator: 'includes', limit: 100 })
    const offset = await new UserModel().many('email', 'test.com', { operator: 'includes', limit: 100, offset: 2 })
    expect(offset.length).toBe(all.length - 2)
  })

  it('results are hydrated model instances', async () => {
    const results = await new UserModel().many('name', 'Alice', { operator: 'equals_many' })
    expect(results[0]).toBeInstanceOf(UserModel)
    expect(results[0]!.isInstance()).toBe(true)
  })
})

describe('all', () => {
  beforeEach(async () => {
    await new UserModel().hydrate({ id: 'u1', name: 'Alice', email: 'a@t.com' }).save()
    await new UserModel().hydrate({ id: 'u2', name: 'Bob', email: 'b@t.com' }).save()
    await new UserModel().hydrate({ id: 'u3', name: 'Charlie', email: 'c@t.com' }).save()
  })

  it('returns all records', async () => {
    const results = await new UserModel().all()
    expect(results.length).toBe(3)
  })

  it('respects limit and offset', async () => {
    const results = await new UserModel().all(undefined, { limit: 2 })
    expect(results.length).toBe(2)

    const offset = await new UserModel().all(undefined, { limit: 2, offset: 2 })
    expect(offset.length).toBe(1)
  })

  it('results are hydrated model instances', async () => {
    const results = await new UserModel().all()
    expect(results[0]).toBeInstanceOf(UserModel)
    expect(results[0]!.isInstance()).toBe(true)
    expect(results[0]!.isNew()).toBe(false)
  })
})

describe('relationships', () => {
  beforeEach(async () => {
    await new UserModel().hydrate({ id: 'u1', name: 'Alice', email: 'a@t.com' }).save()
    await new PostModel().hydrate({ id: 'p1', title: 'Post 1', user_id: 'u1' }).save()
    await new PostModel().hydrate({ id: 'p2', title: 'Post 2', user_id: 'u1' }).save()
  })

  it('loads belongs relationship', async () => {
    const post = await new PostModel().with('author').get('p1')
    expect(post).toBeDefined()
    expect((post as any).author).toBeDefined()
    expect((post as any).author.name).toBe('Alice')
  })

  it('loads many relationship', async () => {
    const user = await new UserModel().with('posts').get('u1')
    expect(user).toBeDefined()
    expect((user as any).posts).toBeDefined()
    expect((user as any).posts.length).toBe(2)
  })

  it('throws for unknown relationship', () => {
    expect(() => new UserModel().with('nonexistent')).toThrow('No relationship setup')
  })
})

describe('custom key field', () => {
  it('uses slug as key', async () => {
    const model = new SlugModel().hydrate({ slug: 'my-slug', name: 'Test' })
    expect(model.getKey()).toBe('my-slug')
    await model.save()

    const found = await new SlugModel().get('my-slug')
    expect(found).toBeDefined()
    expect(found!.name).toBe('Test')
  })

  it('auto-generates key on custom field', async () => {
    const model = new SlugModel().hydrate({ name: 'No Slug' })
    await model.save()
    expect(model.slug).toBeDefined()
    expect(model.slug!.startsWith('generated_')).toBe(true)
  })
})

describe('parseKey', () => {
  it('parses numeric string to number', async () => {
    await new UserModel().hydrate({ id: '123', name: 'Test', email: 't@t.com' }).save()
    // parseKey('123') -> 123, but storage key is '123'
    // This tests that get works with numeric string keys
    const found = await new UserModel().get('123')
    expect(found).toBeDefined()
  })
})
