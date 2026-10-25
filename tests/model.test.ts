import { describe, it, expect, beforeEach } from 'vitest'
import { initDB } from '../database'
import { clearDatabases } from '../database'
import { paramBagSymbol, setDBConnection } from '../model'
import { clearDeletion, deletions } from '../deletions'
import { ActivityModel, UserModel, PostModel, SlugModel, TagModel } from './helpers/fixtures'
import memoryPlugin from './helpers/memoryPlugin'

const dbConfig = {
  name: 'model-test',
  version: 1,
  plugin: memoryPlugin,
  stores: [
    { name: 'users', indexes: [{ name: 'email' }, { name: 'name' }] },
    { name: 'posts', indexes: [{ name: 'title' }, { name: 'user_id' }, { name: 'tag_ids', multiEntry: true }] },
    { name: 'tags', indexes: [{ name: 'name' }] },
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

  it('only persists fields()', async () => {
    const user = new UserModel().hydrate({ id: 'u1', name: 'Alice' });
    (user as any).extra = 'ignored'
    await user.save()

    const stored = await user.connection()!.get('users', 'u1')
    expect(stored).not.toHaveProperty('extra')
  })

  it('marks model clean and not new after save', async () => {
    const user = new UserModel()
    user.id = 'u1'
    user.name = 'Alice'
    expect(user.isNew()).toBe(true)
    expect(user.isDirty()).toBe(true)

    await user.save()
    expect(user.isNew()).toBe(false)
    expect(user.isClean()).toBe(true)

    user.name = 'Bob'
    expect(user.isDirty()).toBe(true)
  })

  it('generated key stays new after save', async () => {
    const user = await new UserModel().hydrate({ name: 'Alice' }).save()
    expect(user.isNew()).toBe(true)
    expect(user.isClean()).toBe(true)
  })

  it('sets and persists lastUpdated when dirty', async () => {
    const user = new UserModel().hydrate({ id: 'u1', name: 'Alice' })
    user.name = 'Alicia'
    await user.save()

    const lastUpdated = user[paramBagSymbol]?.lastUpdated
    expect(lastUpdated).toBeDefined()

    const found = await new UserModel().get('u1')
    expect(found![paramBagSymbol]?.lastUpdated).toBe(lastUpdated)
  })

  it('sets lastUpdated on a model created without hydrate', async () => {
    const user = new UserModel()
    user.name = 'Alice'
    await user.save()

    expect(user[paramBagSymbol]?.lastUpdated).toBeDefined()
  })

  it('sets lastUpdated when the key is generated', async () => {
    const user = await new UserModel().hydrate({ name: 'Alice' }).save()

    expect(user[paramBagSymbol]?.lastUpdated).toBeDefined()
  })

  it('keeps lastUpdated when saving a clean model', async () => {
    const user = new UserModel().hydrate({ id: 'u1', name: 'Alice' })
    expect((await user.save())[paramBagSymbol]?.lastUpdated).toBeUndefined()

    user.name = 'Alicia'
    const lastUpdated = (await user.save())[paramBagSymbol]?.lastUpdated
    await new Promise(resolve => setTimeout(resolve, 2))
    await user.setSynced().save()

    expect(user[paramBagSymbol]?.lastUpdated).toBe(lastUpdated)
    expect((await new UserModel().get('u1'))![paramBagSymbol]?.lastUpdated).toBe(lastUpdated)
    expect(user.lastSynced()!.synced_at.toISOString() > lastUpdated!.toString()).toBe(true)
  })
})

describe('replace', () => {
  it('swaps a generated key for a new one', async () => {
    const user = await new UserModel().hydrate({ name: 'Alice', email: 'a@t.com' }).save()
    const generated = user.id!

    await user.replace({ id: 'u1', name: 'Alice' })

    expect(user.id).toBe('u1')
    expect(user.isNew()).toBe(false)
    expect(await new UserModel().get(generated)).toBeUndefined()
    expect((await new UserModel().get('u1'))!.name).toBe('Alice')
  })

  it('drops fields missing from the new data', async () => {
    const user = await new UserModel().hydrate({ id: 'u1', name: 'Alice', email: 'a@t.com' }).save()
    await user.replace({ id: 'u2', name: 'Bob' })

    expect(user.email).toBeUndefined()
    expect(await new UserModel().get('u2')).toMatchObject({ id: 'u2', name: 'Bob', email: undefined })
  })

  it('replaces in place when the key is unchanged', async () => {
    const user = await new UserModel().hydrate({ id: 'u1', name: 'Alice', email: 'a@t.com' }).save()
    await user.replace({ id: 'u1', name: 'Alicia' })

    const found = await new UserModel().get('u1')
    expect(found!.name).toBe('Alicia')
    expect(found!.email).toBeUndefined()
  })

  it('sets lastUpdated', async () => {
    const user = await new UserModel().hydrate({ id: 'u1', name: 'Alice' }).save()
    await user.replace({ id: 'u2', name: 'Alice' })

    expect(user[paramBagSymbol]?.lastUpdated).toBeDefined()
    expect(user.isClean()).toBe(true)
  })

  it('keeps the last sync', async () => {
    const user = await new UserModel().hydrate({ id: 'u1', name: 'Alice' }).setSynced(['failed']).save()
    const lastSynced = user.lastSynced()
    await user.replace({ id: 'u2', name: 'Alice' })

    expect(user.lastSynced()).toEqual(lastSynced)
    expect((await new UserModel().get('u2'))!.lastSynced()).toEqual(lastSynced)
  })

  it('reloads preloaded relationships', async () => {
    await new PostModel().hydrate({ id: 'p1', title: 'Post 1', user_id: 'u2' }).save()
    const user: any = await new UserModel().hydrate({ id: 'u1', name: 'Alice' }).save()
    await user.with('posts').replace({ id: 'u2', name: 'Alice' })

    expect(user.posts.map((post: PostModel) => post.id)).toEqual(['p1'])
  })

  it('throws when the model is not hydrated', async () => {
    await expect(new UserModel().replace({ id: 'u1' })).rejects.toThrow('Only a hydrated model can be replaced')
  })
})

describe('sync state', () => {
  it('lastSynced is undefined until synced', async () => {
    const user = await new UserModel().hydrate({ id: 'u1', name: 'Alice' }).save()

    expect(user.lastSynced()).toBeUndefined()
  })

  it('setSynced records the time with no errors', () => {
    const user = new UserModel().hydrate({ id: 'u1', name: 'Alice' }).setSynced()

    expect(user.lastSynced()).toEqual({ synced_at: expect.any(Date), errors: [] })
    expect(Date.now() - user.lastSynced()!.synced_at.getTime()).toBeLessThan(1000)
  })

  it('setSynced records errors, and a later setSynced clears them', () => {
    const user = new UserModel().hydrate({ id: 'u1', name: 'Alice' }).setSynced([{ field: 'email' }])

    expect(user.lastSynced<{ field: string }>()!.errors).toEqual([{ field: 'email' }])
    expect(user.setSynced().lastSynced()!.errors).toEqual([])
  })

  it('setSynced does not make the model dirty', () => {
    const user = new UserModel().hydrate({ id: 'u1', name: 'Alice' }).setSynced()

    expect(user.isClean()).toBe(true)
  })

  it('persists on save', async () => {
    const user = await new UserModel().hydrate({ id: 'u1', name: 'Alice' }).setSynced(['failed']).save()
    const found = await new UserModel().get('u1')

    expect(found!.lastSynced()).toEqual({ synced_at: user.lastSynced()!.synced_at, errors: ['failed'] })
    expect(await user.connection()!.get('users', 'u1')).not.toHaveProperty('lastSynced')
  })

  it('is loaded on a model prepared with with()', async () => {
    const user = new UserModel().hydrate({ id: 'u1', name: 'Alice' })
    user.name = 'Alicia'
    await user.setSynced(['failed']).save()
    const found = await new UserModel().with('posts').get('u1')

    expect(found!.lastSynced()).toEqual(user.lastSynced())
    expect(found![paramBagSymbol]?.lastUpdated).toBe(user[paramBagSymbol]?.lastUpdated)
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

  it('between operator matches range', async () => {
    const results = await new UserModel().many('name', ['Alice', 'Bob'], { operator: 'between' })
    expect(results.map(u => u.name)).toEqual(['Alice', 'Alicia', 'Bob'])
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

  it('loaded relationships do not make model dirty', async () => {
    const user = await new UserModel().with('posts').get('u1')
    expect(user!.isClean()).toBe(true)

    const post = await new PostModel().with('author').get('p1')
    expect(post!.isClean()).toBe(true)
  })

  it('save does not persist loaded relationships', async () => {
    const user = await new UserModel().with('posts').get('u1')
    await user!.save()

    const stored = await user!.connection()!.get('users', 'u1')
    expect(stored).not.toHaveProperty('posts')
  })

  it('throws for unknown relationship', () => {
    expect(() => new UserModel().with('nonexistent')).toThrow('No relationship setup')
  })
})

describe('belongsMany relationships', () => {
  const tagNames = (model: any) => model.tags.map((tag: TagModel) => tag.name)
  const stored = async (key: string) => await new PostModel().get(key)

  beforeEach(async () => {
    await new TagModel().hydrate({ id: 't1', name: 'js' }).save()
    await new TagModel().hydrate({ id: 't2', name: 'ts' }).save()
    await new TagModel().hydrate({ id: 't3', name: 'css' }).save()
    await new PostModel().hydrate({ id: 'p1', title: 'Post 1', tag_ids: ['t2', 't1'] }).save()
    await new PostModel().hydrate({ id: 'p2', title: 'Post 2', tag_ids: ['t1'] }).save()
  })

  it('loads related in key order', async () => {
    const post = await new PostModel().with('tags').get('p1')
    expect(tagNames(post)).toEqual(['ts', 'js'])
    expect(post!.isClean()).toBe(true)
  })

  it('skips missing related and handles no keys', async () => {
    await new PostModel().hydrate({ id: 'p3', title: 'Post 3', tag_ids: ['t1', 'nope'] }).save()
    await new PostModel().hydrate({ id: 'p4', title: 'Post 4' }).save()

    expect(tagNames(await new PostModel().with('tags').get('p3'))).toEqual(['js'])
    expect(tagNames(await new PostModel().with('tags').get('p4'))).toEqual([])
  })

  it('loads reverse lookup via many on multiEntry index', async () => {
    const t1 = await new TagModel().with('posts').get('t1')
    const t2 = await new TagModel().with('posts').get('t2')
    const t3 = await new TagModel().with('posts').get('t3')

    expect((t1 as any).posts.map((p: PostModel) => p.id).sort()).toEqual(['p1', 'p2'])
    expect((t2 as any).posts.map((p: PostModel) => p.id)).toEqual(['p1'])
    expect((t3 as any).posts).toEqual([])
  })

  it('attach appends, dedupes and persists', async () => {
    const post = await new PostModel().get('p2')
    await post!.attach('tags', 't2')
    await post!.attach('tags', ['t1', 't3', 't3'])

    expect(post!.tag_ids).toEqual(['t1', 't2', 't3'])
    expect((await stored('p2'))!.tag_ids).toEqual(['t1', 't2', 't3'])
    expect(post!.isClean()).toBe(true)
  })

  it('detach removes and updates reverse lookup', async () => {
    const post = await new PostModel().get('p1')
    await post!.detach('tags', 't1')

    expect((await stored('p1'))!.tag_ids).toEqual(['t2'])

    const t1 = await new TagModel().with('posts').get('t1')
    expect((t1 as any).posts.map((p: PostModel) => p.id)).toEqual(['p2'])
  })

  it('detach accepts many keys', async () => {
    const post = await new PostModel().get('p1')
    await post!.detach('tags', ['t1', 't2'])

    expect((await stored('p1'))!.tag_ids).toEqual([])
  })

  it('sync replaces keys', async () => {
    const post = await new PostModel().get('p1')
    await post!.sync('tags', ['t3', 't1', 't3'])

    expect((await stored('p1'))!.tag_ids).toEqual(['t3', 't1'])
  })

  it('reloads relation when preloaded', async () => {
    const post = await new PostModel().with('tags').get('p1')
    await post!.sync('tags', ['t3'])

    expect(tagNames(post)).toEqual(['css'])
  })

  it('does not mutate the hydrated source array', async () => {
    const tagIds = ['t1']
    const post = new PostModel().hydrate({ id: 'p5', title: 'Post 5', tag_ids: tagIds })
    await post.attach('tags', 't2')

    expect(tagIds).toEqual(['t1'])
  })

  it('finds posts without tags via empty operator', async () => {
    await new PostModel().hydrate({ id: 'p3', title: 'Post 3', tag_ids: [] }).save()
    await new PostModel().hydrate({ id: 'p4', title: 'Post 4' }).save()

    const untagged = await new PostModel().many('tag_ids', null, { operator: 'empty' })
    expect(untagged.map(p => p.id).sort()).toEqual(['p3', 'p4'])

    const tagged = await new PostModel().many('tag_ids', null, { operator: 'not_empty' })
    expect(tagged.map(p => p.id).sort()).toEqual(['p1', 'p2'])
  })

  it('throws for unknown or non belongsMany relationship', async () => {
    const post = await new PostModel().get('p1')

    await expect(post!.attach('nonexistent', 't1')).rejects.toThrow('No relationship setup')
    await expect(post!.attach('author', 't1')).rejects.toThrow('not a belongsMany')
  })
})

describe('nested relationships', () => {
  const ids = (models: any[]) => models.map(model => model.id).sort()
  const byId = (models: any[], id: string) => models.find(model => model.id === id)
  const tagNames = (post: any) => post.tags.map((tag: TagModel) => tag.name)

  beforeEach(async () => {
    await new UserModel().hydrate({ id: 'u1', name: 'Alice', email: 'a@t.com' }).save()
    await new UserModel().hydrate({ id: 'u2', name: 'Bob', email: 'b@t.com' }).save()
    await new TagModel().hydrate({ id: 't1', name: 'js' }).save()
    await new TagModel().hydrate({ id: 't2', name: 'ts' }).save()
    await new PostModel().hydrate({ id: 'p1', title: 'Post 1', user_id: 'u1', tag_ids: ['t2', 't1'] }).save()
    await new PostModel().hydrate({ id: 'p2', title: 'Post 2', user_id: 'u1', tag_ids: ['t1'] }).save()
    await new PostModel().hydrate({ id: 'p3', title: 'Post 3', user_id: 'u2' }).save()
  })

  it('loads many then belongsMany', async () => {
    const user: any = await new UserModel().with('posts.tags').get('u1')

    expect(ids(user.posts)).toEqual(['p1', 'p2'])
    expect(tagNames(byId(user.posts, 'p1'))).toEqual(['ts', 'js'])
    expect(tagNames(byId(user.posts, 'p2'))).toEqual(['js'])
  })

  it('loads belongs then many', async () => {
    const post: any = await new PostModel().with('author.posts').get('p1')

    expect(post.author.name).toBe('Alice')
    expect(ids(post.author.posts)).toEqual(['p1', 'p2'])
  })

  it('loads belongsMany then many', async () => {
    const post: any = await new PostModel().with('tags.posts').get('p1')

    expect(ids(post.tags[0].posts)).toEqual(['p1'])
    expect(ids(post.tags[1].posts)).toEqual(['p1', 'p2'])
  })

  it('loads three levels deep', async () => {
    const user: any = await new UserModel().with('posts.author.posts').get('u1')

    expect(byId(user.posts, 'p1').author.name).toBe('Alice')
    expect(ids(byId(user.posts, 'p1').author.posts)).toEqual(['p1', 'p2'])
  })

  it('loads nested paths for all and many', async () => {
    const users: any[] = await new UserModel().with('posts.tags').all()

    expect(tagNames(byId(byId(users, 'u1').posts, 'p1'))).toEqual(['ts', 'js'])
    expect(byId(byId(users, 'u2').posts, 'p3').tags).toEqual([])

    const posts: any[] = await new PostModel().with('author.posts').many('title', 'Post')

    expect(ids(byId(posts, 'p3').author.posts)).toEqual(['p3'])
  })

  it('merges chained paths without duplicates', async () => {
    const user: any = new UserModel().with('posts').with('posts.tags').with('posts.tags').with('posts.author')

    expect(user[paramBagSymbol].nestedRelations).toEqual({ posts: ['tags', 'author'] })

    await user.get('u1')
    expect(tagNames(byId(user.posts, 'p1'))).toEqual(['ts', 'js'])
    expect(byId(user.posts, 'p1').author.name).toBe('Alice')
  })

  it('throws at with() for an unknown nested relationship', () => {
    expect(() => new UserModel().with('posts.nope')).toThrow('No relationship setup')
    expect(() => new UserModel().with('posts.tags.nope')).toThrow('No relationship setup')
  })

  it('nested relationships are not persisted and keep the model clean', async () => {
    const user = await new UserModel().with('posts.tags').get('u1')
    expect(user!.isClean()).toBe(true)

    await user!.save()
    expect(await user!.connection()!.get('users', 'u1')).not.toHaveProperty('posts')
  })

  it('attach reloads nested relationships', async () => {
    const post: any = await new PostModel().with('tags.posts').get('p2')
    await post.attach('tags', 't2')

    expect(tagNames(post)).toEqual(['js', 'ts'])
    expect(ids(post.tags[1].posts)).toEqual(['p1', 'p2'])
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

describe('deletion tracking', () => {
  const trackedConfig = {
    ...dbConfig,
    trackDeletions: true,
    stores: [...dbConfig.stores, { name: 'activities', indexes: [{ name: 'title' }] }],
  }

  beforeEach(async () => {
    clearDatabases()
    setDBConnection()
    await initDB({ ...trackedConfig, name: 'model-tracked-' + Math.random() })
    await new ActivityModel().hydrate({ id: 'a1', title: 'Run' }).save()
    await new ActivityModel().hydrate({ id: 'a2', title: 'Swim' }).save()
  })

  it('delete writes a tombstone with the record data', async () => {
    const activity = await new ActivityModel().get('a1')
    expect(await activity!.delete()).toBe(true)

    expect(await new ActivityModel().get('a1')).toBeUndefined()
    expect(await deletions('activities')).toEqual([
      { store: 'activities', key: 'a1', deleted_at: expect.any(String), data: { id: 'a1', title: 'Run' } },
    ])
  })

  it('track: false skips the tombstone', async () => {
    await (await new ActivityModel().get('a1'))!.delete({ track: false })

    expect(await new ActivityModel().get('a1')).toBeUndefined()
    expect(await deletions('activities')).toEqual([])
  })

  it('generated keys skip the tombstone', async () => {
    const activity = await new ActivityModel().hydrate({ title: 'Local' }).save()
    await activity.delete()

    expect(await deletions()).toEqual([])
  })

  it('models without trackDeletions are untouched', async () => {
    await new UserModel().hydrate({ id: 'u1', name: 'Alice' }).save()
    await new UserModel().hydrate({ id: 'u1' }).delete()

    expect(await deletions()).toEqual([])
  })

  it('replace removes the old record without a tombstone', async () => {
    const activity = await new ActivityModel().get('a1')
    await activity!.replace({ id: 'a3', title: 'Run' })

    expect(await new ActivityModel().get('a1')).toBeUndefined()
    expect(await deletions()).toEqual([])
  })

  it('save clears a pending tombstone', async () => {
    await new ActivityModel().hydrate({ id: 'a1' }).delete()
    await new ActivityModel().hydrate({ id: 'a1', title: 'Run again' }).save()

    expect(await deletions()).toEqual([])
    expect((await new ActivityModel().get('a1'))!.title).toBe('Run again')
  })

  it('deletions filters by store and sorts by deleted_at', async () => {
    await new ActivityModel().hydrate({ id: 'a2' }).delete()
    await new Promise(resolve => setTimeout(resolve, 2))
    await new ActivityModel().hydrate({ id: 'a1' }).delete()

    expect((await deletions('activities')).map(d => d.key)).toEqual(['a2', 'a1'])
    expect(await deletions('users')).toEqual([])
  })

  it('clearDeletion removes the tombstone and normalizes the key', async () => {
    await new ActivityModel().hydrate({ id: 5, title: 'Numeric' }).save()
    await new ActivityModel().hydrate({ id: 5 }).delete()
    await new ActivityModel().hydrate({ id: 'a1' }).delete()

    expect(await clearDeletion('activities', '5')).toBe(true)
    expect((await deletions('activities')).map(d => d.key)).toEqual(['a1'])
  })

  it('accepts an explicit connection', async () => {
    const other = await initDB({ ...trackedConfig, name: 'model-tracked-other', default: false })
    await other.delete('activities', 'x1', { tombstone: { store: 'activities', key: 'x1', deleted_at: new Date().toISOString(), data: {} } })

    expect((await deletions('activities', other)).map(d => d.key)).toEqual(['x1'])
    expect(await deletions('activities')).toEqual([])
    await clearDeletion('activities', 'x1', other)
    expect(await deletions('activities', other)).toEqual([])
  })

  it('throws when the database does not track deletions', async () => {
    clearDatabases()
    setDBConnection()
    await initDB({ ...dbConfig, stores: trackedConfig.stores, name: 'model-untracked-' + Math.random() })

    await expect(new ActivityModel().hydrate({ id: 'a1' }).save()).rejects.toThrow('trackDeletions is not enabled')
    await expect(new ActivityModel().hydrate({ id: 'a1' }).delete()).rejects.toThrow('trackDeletions is not enabled')
    await expect(deletions()).rejects.toThrow('trackDeletions is not enabled')
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
