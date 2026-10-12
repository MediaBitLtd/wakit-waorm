import { initDB } from './database'
import { collect } from './collector'
import Model, { generateNewId, generateNewSlug, isDirty, isNew, isInstance } from './model'

export type WaormRelationshipBag = { [k: string]: WaormRelationship }

export type WaormKey = string | number | IDBValidKey;

export type WaormDate = string | Date;

export interface Resource {
  id?: WaormKey;
  created_at?: WaormDate | undefined;
}

export interface ModelParamBag<T = any> {
  new?: boolean;
  instance?: boolean;
  original?: any;
  markForDeletion?: boolean;
  preloadRelations?: WaormRelationshipBag | undefined;

  lastUpdated: WaormDate | undefined;
  lastSynced: WaormDate | undefined;
  syncErrors: T[];
}

export interface WaormConnectionPlugin<T> {
  setup: (config: WaormDatabaseConfig<T>) => Promise<WaormDatabaseConnection<T>>
}

export interface WaormDatabaseConnection<T> {
  name: WaormDatabaseConfig<T>['name'];
  config: WaormDatabaseConfig<T>;
  getEngine: () => T | undefined;
  get: (store: string, key: WaormKey) => Promise<Resource | undefined>;
  set: (store: string, key: WaormKey, data: Resource) => Promise<Resource>;
  all: (store: string, index?: string, options?: WaormCursorOptions) => Promise<Resource[]|Resource|undefined>;
  delete: (store: string, key: WaormKey) => Promise<boolean>;
  where: (store: string, index: string, search: string, options?: WaormSearchOptions) => Promise<Resource[]|Resource|undefined>;
}

export interface WaormQueryCollector<T = typeof Model> {
  delete: () => Promise<boolean>;
  each: (callback: (model: T) => Promise<any>) => Promise<void>;
  items: () => Promise<T[]>;
  itemsAsResource: <R>() => Promise<R[]>;
  count: () => Promise<number>;
}

export interface WaormDatabaseConfig<T> {
  name: string;
  plugin?: WaormConnectionPlugin<T>;
  version?: number;
  default?: boolean;
  dropUnknownStores?: boolean;
  stores: WaormStore[];
}

export interface WaormRelationship {
  related: typeof Model;
  relationship:  'one' | 'many' | 'belongs';
  foreignKey: string;
}

export interface WaormCursorOptions {
  direction?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface WaormSearchOptions extends WaormCursorOptions {
  operator?: 'equals' | 'equals_many' | 'includes' | 'not_equals' | 'not_includes';
}

export interface WaormStore {
  name: string;
  indexes: WaormStoreIndex[];
}

export interface WaormStoreIndex {
  name: string;
  path?: string;
  unique?: boolean;
}

export {
  onDatabaseInitError,
  onModelOperationError,
  offDatabaseInitError,
  offModelOperationError,
  onDatabaseBlocked,
  offDatabaseBlocked,
  onDatabaseVersionChange,
  offDatabaseVersionChange,
  clearEventListeners,
} from './events'

export {
  Model,
  initDB,
  collect,
  generateNewId,
  generateNewSlug,
  isDirty,
  isNew,
  isInstance,
}
