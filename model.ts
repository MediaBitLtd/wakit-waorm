import type {
  ModelParamBag,
  Resource,
  WaormKey,
  WaormRelationship,
  WaormRelationshipBag,
  WaormDatabaseConnection,
  WaormCursorOptions,
  WaormSearchOptions,
} from './index'
import { dispatch, MODEL_OP_ERROR } from './events'

export const paramBagSymbol = Symbol('waorm:params')

interface ModelResource extends Resource {
  [paramBagSymbol]: ModelParamBag;
}

let connection: WaormDatabaseConnection<any>|undefined

export const setDBConnection = <T>(databaseConnection?: WaormDatabaseConnection<T>) => connection = databaseConnection

export const generateNewId = (): string => 'generated_' + (Math.random() + 1).toString(36).substring(2)

export const generateNewSlug = (): string => Math.floor((new Date).getTime() / 1000) + (Math.random() + 1).toString(36).substring(2) + (new Date).getFullYear()

export const isDirty = (resource: ModelResource) => {
  if (resource[paramBagSymbol] && resource[paramBagSymbol].original) {
    return JSON.stringify(resource) !== resource[paramBagSymbol].original
  }

  return true
}

export const isNew = (resource: ModelResource) => {
  return ! resource[paramBagSymbol] || !! resource[paramBagSymbol].new
}

export const isInstance = (resource: ModelResource) => {
  return !! resource[paramBagSymbol]?.instance
}

export default abstract class Model <R = ModelResource, E = any> {
  public id?: ModelResource['id'] = undefined
  public [paramBagSymbol]?: ModelParamBag<E> = undefined

  public static PER_PAGE = 15

  // Definitions
  abstract storeName(): string

  relationships(): WaormRelationshipBag {
    return {}
  }

  fields(): string[] | undefined {
    return undefined
  }

  getKeyField(): string {
    return 'id'
  }

  getKey(): WaormKey | undefined {
    // @ts-ignore
    return this[this.getKeyField()]
  }

  connection(): WaormDatabaseConnection<any>|undefined {
    return connection
  }

  // Getters
  isDirty(): boolean {
    const original = this[paramBagSymbol]?.original

    if (! original) {
      return true
    }

    return JSON.stringify(this.attributes()) !== original
  }

  isClean(): boolean {
    return ! this.isDirty()
  }

  isNew(): boolean {
    return isNew(this.resource())
  }

  isInstance(): boolean {
    return isInstance(this.resource())
  }

  // Mutators
  generateKey(): WaormKey {
    const key = generateNewId()

    // @ts-ignore
    this[this.getKeyField()] = key

    return key
  }

  with(relationship: string): this {
    const relation: WaormRelationship | undefined = this.relationships()[relationship]

    if (! relation) {
      throw new Error(`No relationship setup for this model with the key: ${relationship}`)
    }


    this[paramBagSymbol] = this.prepareBag()

    if (! this[paramBagSymbol].preloadRelations) {
      this[paramBagSymbol].preloadRelations = {}
    }

    this[paramBagSymbol].preloadRelations[relationship] = relation

    return this
  }

  hydrate<T = R>(data: T): this {
    const fields = this.fields()
    const preloadedRelationships = this[paramBagSymbol]?.preloadRelations

    for (const k in data) {
      if (! fields || fields.includes(k)) {
        // @ts-ignore
        this[k] = data[k]
      }
    }

    this[paramBagSymbol] = this.prepareBag(data)

    // @ts-ignore
    delete this['$waorm:params']

    this[paramBagSymbol].new = this.hasNewKey()
    this[paramBagSymbol].instance = true
    this[paramBagSymbol].original = JSON.stringify(this.attributes())
    this[paramBagSymbol].preloadRelations = preloadedRelationships

    return this
  }

  // Persistable data: fields() only (when defined), without loaded relationships
  attributes<T = R>(): T {
    const fields = this.fields()
    const relationships = this.relationships()
    const data = JSON.parse(JSON.stringify(this))

    for (const k in data) {
      if ((fields && ! fields.includes(k)) || Object.hasOwn(relationships, k)) {
        delete data[k]
      }
    }

    return data as T
  }

  resource<T = R>(): T {
    const data = JSON.parse(JSON.stringify(this))

    data[paramBagSymbol] = this[paramBagSymbol]

    return data as T
  }

  newInstance(): this {
    // @ts-ignore
    return new this.constructor()
  }

  // IO
  async get(key: Resource['id']): Promise<this | undefined> {
    try {
      const data = await this.connection()?.get(this.storeName(), this.parseKey(key))

      if (! data) {
        return undefined
      }

      this.hydrate(data)

      return await this.loadRelationships()
    } catch (err) {
      dispatch(MODEL_OP_ERROR, err)
      throw err
    }
  }

  async save(): Promise<this> {
    let key = this.getKey()

    if (! key) {
      key = this.generateKey()
    }

    const lastUpdated = new Date().toISOString()
    const data = this.resourceToSave<Resource & { '$waorm:params': ModelParamBag }>()

    data['$waorm:params'].lastUpdated = lastUpdated

    try {
      await this.connection()?.set(this.storeName(), this.parseKey(key), data)
    } catch (err) {
      dispatch(MODEL_OP_ERROR, err)
      throw err
    }

    this[paramBagSymbol] = this.prepareBag()
    this[paramBagSymbol].lastUpdated = lastUpdated
    this[paramBagSymbol].new = this.hasNewKey()
    this[paramBagSymbol].original = JSON.stringify(this.attributes())

    return this
  }

  async delete(): Promise<boolean> {
    const key = this.getKey()

    if (! key) {
      throw new Error('Model has no key to store. Make sure your key is hydrated')
    }

    try {
      return await this.connection()?.delete(this.storeName(), this.parseKey(key)) || false
    } catch (err) {
      dispatch(MODEL_OP_ERROR, err)
      throw err
    }
  }

  async find(field: string, search: any): Promise<this|undefined> {
    try {
      const data = await this.connection()?.where(this.storeName(), field, search)
      if (! data) {
        return
      }

      this.hydrate(data)

      return await this.loadRelationships()
    } catch (err) {
      dispatch(MODEL_OP_ERROR, err)
      throw err
    }
  }

  async many(field: string, search: any, options?: WaormSearchOptions): Promise<this[]> {
    if (! options) {
      options = {}
    }

    options.operator = options.operator || 'includes'
    options.offset = options.offset || 0
    options.limit = options.limit || Model.PER_PAGE

    try {
      const items: this[] = []
      const resources = await this.connection()?.where(this.storeName(), field, search, options) as R[]

      for (const k in resources) {
        if (resources[k]) {
          const model = this.newInstance().hydrate(resources[k])
          // @ts-ignore // we will always have it preloaded
          model[paramBagSymbol].preloadRelations = this[paramBagSymbol]?.preloadRelations
          items.push(await model.loadRelationships())
        }
      }

      return items
    } catch (err) {
      dispatch(MODEL_OP_ERROR, err)
      throw err
    }
  }

  async all(index?: string, options?: WaormCursorOptions): Promise<this[]> {
    if (! options) {
      options = {}
    }

    options.offset = options.offset || 0
    options.limit = options.limit || Model.PER_PAGE
    options.direction = options.direction || 'asc'

    try {
      const items: this[] = []
      const resources = await this.connection()?.all(this.storeName(), index, options) as R[]

      for (const k in resources) {
        if (resources[k]) {
          const model = this.newInstance().hydrate(resources[k])
          // @ts-ignore // we will always have it preloaded
          model[paramBagSymbol].preloadRelations = this[paramBagSymbol]?.preloadRelations
          items.push(await model.loadRelationships())
        }
      }

      return items
    } catch (err) {
      dispatch(MODEL_OP_ERROR, err)
      throw err
    }
  }

  // Protected

  protected prepareBag(data?: any): ModelParamBag {
    return this[paramBagSymbol] || {
      lastUpdated: data?.['$waorm:params']?.lastUpdated || data?.[paramBagSymbol]?.lastUpdated,
      lastSynced: data?.['$waorm:params']?.lastSynced || data?.[paramBagSymbol]?.lastSynced,
      syncErrors: data?.['$waorm:params']?.syncErrors || data?.[paramBagSymbol]?.syncErrors || [],
    }
  }

  protected hasNewKey(): boolean {
    const key = this.getKey()

    return ! key || key.toString().startsWith('generated')
  }

  protected resourceToSave<T = R>(): T {
    const data: any = this.attributes()

    data['$waorm:params'] = {
      lastUpdated: this[paramBagSymbol]?.lastUpdated,
      lastSynced: this[paramBagSymbol]?.lastSynced,
      syncErrors: this[paramBagSymbol]?.syncErrors || [],
    } as ModelParamBag

    return data as T
  }

  protected async loadRelationships(): Promise<this> {
    for (const relationship in this[paramBagSymbol]?.preloadRelations) {
      if (this[paramBagSymbol]?.preloadRelations[relationship]) {
        const relation: WaormRelationship | undefined = this[paramBagSymbol].preloadRelations[relationship]

        if (! relation) {
          continue
        }

        // @ts-ignore
        const model = (new relation.related)

        switch (relation.relationship) {
          case 'belongs':
            // @ts-ignore
            this[relationship] = await model.get(this.parseKey(this[relation.foreignKey]))
            break
          case 'one':
            // @ts-ignore
            this[relationship] = await model.find(relation.foreignKey, this.parseKey(this.getKey()))
            break
          case 'many':
            // @ts-ignore
            this[relationship] = await model.many(relation.foreignKey, this.parseKey(this.getKey()), { limit: 10_000, operator: 'equals_many' })
            break
        }
      }
    }

    return this
  }

  protected parseKey(key: Resource['id']|undefined): number|string {
    if (! key) {
      return ''
    }

    if (key.toString().trim() === '') {
      return key.toString().trim()
    }

    // @ts-ignore
    if (isNaN(key)) {
      return key.toString()
    }

    return parseInt(key.toString())
  }
}
