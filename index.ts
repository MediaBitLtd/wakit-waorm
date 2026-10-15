import { initDB } from './database'
import { collect } from './collector'
import { deletions, clearDeletion, DELETIONS_STORE } from './deletions'
import Model, { generateNewId, generateNewSlug, isDirty, isNew, isInstance } from './model'

export type WaormValueOperator = 'is_null' | 'is_not_null' | 'empty' | 'not_empty'

export type WaormCursorOperator = 'equals' | 'equals_many' | 'includes' | 'not_equals' | 'not_includes' | WaormValueOperator

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
  preloadRelations?: WaormRelationshipBag | undefined;
  nestedRelations?: { [k: string]: string[] } | undefined;

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
  // Delete the record and write its tombstone together
  deleteTracked: (store: string, key: WaormKey, tombstone: WaormDeletion) => Promise<boolean>;
  // Write the record and remove its tombstone together
  setTracked: (store: string, key: WaormKey, data: Resource) => Promise<Resource>;
}

export interface WaormDeletion<T = unknown> {
  store: string;
  key: WaormKey;
  deleted_at: string;
  data: T;
}

export interface WaormDeleteOptions {
  track?: boolean;
}

export interface WaormQueryCollector<T = typeof Model> {
  delete: (options?: WaormDeleteOptions) => Promise<boolean>;
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
  trackDeletions?: boolean;
  stores: WaormStore[];
}

export interface WaormRelationship {
  related: typeof Model;
  relationship:  'one' | 'many' | 'belongs' | 'belongsMany';
  foreignKey: string;
}

export interface WaormCursorOptions {
  direction?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface WaormSearchOptions extends WaormCursorOptions {
  operator?: WaormCursorOperator;
}

export interface WaormStore {
  name: string;
  indexes: WaormStoreIndex[];
}

export interface WaormStoreIndex {
  name: string;
  path?: string;
  unique?: boolean;
  multiEntry?: boolean;
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
  deletions,
  clearDeletion,
  DELETIONS_STORE,
  generateNewId,
  generateNewSlug,
  isDirty,
  isNew,
  isInstance,
}
