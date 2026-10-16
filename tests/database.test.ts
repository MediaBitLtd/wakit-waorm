import { describe, it, expect, beforeEach } from 'vitest'
import { initDB } from '../database'
import { clearDatabases } from '../database'
import { setDBConnection } from '../model'
import memoryPlugin from './helpers/memoryPlugin'
import { DELETIONS_STORE } from '../deletions'

describe('initDB', () => {
  beforeEach(() => {
    clearDatabases()
    setDBConnection()
  })

  const makeConfig = (name: string) => ({
    name,
    version: 1,
    plugin: memoryPlugin,
    stores: [{ name: 'users', indexes: [{ name: 'email' }] }],
  })

  it('returns a connection', async () => {
    const conn = await initDB(makeConfig('test-db-1'))
    expect(conn).toBeDefined()
    expect(conn.name).toBe('test-db-1')
  })

  it('caches connection by name', async () => {
    const config = makeConfig('test-db-2')
    const conn1 = await initDB(config)
    const conn2 = await initDB(config)
    expect(conn1).toBe(conn2)
  })

  it('adds the deletions store when tracking deletions', async () => {
    const conn = await initDB({ ...makeConfig('db-tracked'), trackDeletions: true })

    expect(conn.config.stores.map(store => store.name)).toEqual(['users', DELETIONS_STORE])
    expect(conn.getEngine()!.stores.has(DELETIONS_STORE)).toBe(true)
  })

  it('does not add the deletions store by default', async () => {
    const conn = await initDB(makeConfig('db-untracked'))

    expect(conn.config.stores.map(store => store.name)).toEqual(['users'])
  })

  it('returns different connections for different names', async () => {
    const conn1 = await initDB(makeConfig('db-a'))
    const conn2 = await initDB(makeConfig('db-b'))
    expect(conn1).not.toBe(conn2)
  })
})
