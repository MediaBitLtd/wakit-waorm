<h1 align="center">Waorm.js</h1>
<h3 align="center">Your ORM for JavaScript</h3>

---

Waorm (Web Applications Object-Relational Mapping) is a great way to expand your web applications to work with databases and models.

If you are building Progressive Web Applications (mobile like applications using web) it's a great way to store data and keep your application working even offline.

It's a great addition for applications built using **capacitor.js** (Ionic for example)

## How

Waorm utilizes the IndexedDB by default, creating a simple interface for create models.

`await user().find('email', 'user@example.com')`

Simple calls like these abstract the complex code needed to utilize a complex system like IndexedDB. Makes your code more readable and easier to use. In addition, it provides features like aggregation, inclusive searches, etc.

You can even create and use other database plugins, if you want it to interface with other techologies.

Waorm includes IndexedDB and LocalStorage, though it's certainly recommended to use IndexedDB due to the performance and no "storage limitation".

## Usage

##### Models

Creating a model is easy! It is done by classes to make it easier to manipulate but it's super simple, just follow the example bellow:

```javascript
import { Model } from '@wakit/waorm'

export default class User extends Model {
  storeName(): string {
    return 'users'
  }
}

export const user = () => (new User)
```

We also support typescript so here's an example of a more complex model with relationships, all typed

```typescript
import { Model } from '@wakit/waorm'
import type { Resource, WaormRelationshipBag } from '@wakit/waorm'

import Todo from '~/models/todo'

export interface UserResource extends Resource {
  name: string;
  email: string;
}

export default class User extends Model<UserResource> {
  public name?: string;
  public email?: string;

  relationships(): WaormRelationshipBag {
    return {
      todos: {
        related: Todo,
        relationship: 'many',
        foreignKey: 'user_id',
      },
    }
  }

  storeName(): string {
    return 'users'
  }
}

export const user = () => (new User)
```

##### Many-to-many (`belongsMany`)

Store the related keys as an array on the owning record and index it with `multiEntry: true`, so each element is indexed on its own:

```typescript
await initDB({
  name: 'Blog',
  version: 1,
  stores: [
    { name: 'posts', indexes: [{ name: 'tag_ids', multiEntry: true }] },
    { name: 'tags', indexes: [] },
  ],
})

class Post extends Model {
  public tag_ids?: string[]

  relationships(): WaormRelationshipBag {
    return {
      tags: { related: Tag, relationship: 'belongsMany', foreignKey: 'tag_ids' },
    }
  }

  storeName(): string {
    return 'posts'
  }
}

class Tag extends Model {
  relationships(): WaormRelationshipBag {
    return {
      // Reverse lookup is a regular `many` over the multiEntry index
      posts: { related: Post, relationship: 'many', foreignKey: 'tag_ids' },
    }
  }

  storeName(): string {
    return 'tags'
  }
}

const post = await new Post().with('tags').get('p1') // post.tags loaded in tag_ids order
const tag = await new Tag().with('posts').get('t1')  // every post containing t1

await post.attach('tags', 't2')          // or attach('tags', ['t2', 't3'])
await post.detach('tags', 't1')          // or detach('tags', ['t1', 't2'])
await post.sync('tags', ['t1', 't3'])    // replace all keys
```

`attach`, `detach` and `sync` dedupe the keys, save the model (including any unsaved changes) and reload the relation if it was loaded with `with()`. They only work on `belongsMany` relationships. Changing `multiEntry` on an existing indexedDB index requires a version bump.

##### Custom Key Fields

By default models use `id` as the primary key. Override `getKeyField()` to use a different field:

```typescript
class Post extends Model {
  public slug?: string

  storeName() { return 'posts' }
  getKeyField() { return 'slug' }
}
```

##### Field Filtering

Override `fields()` to control which fields are hydrated from data. By default, or when empty, all fields will be hydrated. When a list is supplied, fields not in the list are ignored:

```typescript
class User extends Model {
  public name?: string
  public email?: string

  storeName() { return 'users' }
  fields() { return ['id', 'name', 'email'] }
}
```

##### Dirty Tracking & State

Models track state after hydration:

```typescript
const user = await new User().get('u1')

user.isDirty()    // false — unchanged since hydrate
user.isClean()    // true
user.isNew()      // false — has a persisted key
user.isInstance()  // true — has been hydrated

user.name = 'New Name'
user.isDirty()    // true
```

Standalone functions `isDirty`, `isNew`, `isInstance` are also exported for use with plain resource objects.

##### Auto Key Generation

Calling `save()` on a model without a key auto-generates one:

```typescript
const user = new User().hydrate({ name: 'Alice', email: 'a@b.com' })
await user.save()
console.log(user.id) // 'generated_...'
```

##### Operators

`many(field, search, { operator })` searches the index named `field` (its `path` decides which property is checked). `many()` defaults to `includes`; `find(field, search)` always uses `equals`.

| Operator       | Matches                                                  | Cost                 |
|----------------|----------------------------------------------------------|----------------------|
| `equals`       | value equal to `search`, first match only                | index lookup         |
| `equals_many`  | every record whose value equals `search`                 | full index scan      |
| `not_equals`   | every record whose value differs from `search`           | full index scan      |
| `includes`     | value contains `search` (substring)                      | full index scan      |
| `not_includes` | value doesn't contain `search`                           | full index scan      |
| `is_null`      | `null` or missing                                        | full store scan      |
| `is_not_null`  | anything but `null` / missing (`''`, `0`, `false`, `[]` included) | full store scan |
| `empty`        | `null`, missing, `''`, `[]` or `{}`                      | full store scan      |
| `not_empty`    | anything but empty (`0` and `false` included)            | full store scan      |

- **Index lookup:** jumps straight to the matching entry.
- **Full index scan:** walks every entry in the index. Records without an indexable value (`null`, missing, `[]` on a multiEntry index) aren't in the index, so `not_equals` / `not_includes` never return them; use `is_null` / `empty` for those. Results are ordered by the indexed value.
- **Full store scan:** reads every record in the store, ordered by key. `search` is ignored.
- Comparisons are case-sensitive on indexedDB and case-insensitive on localStorage (except `equals`, exact on both).
- On a multiEntry index, each array element is matched on its own.

```typescript
await new User().many('name', 'ali')                                     // includes
await new User().many('role', 'admin', { operator: 'equals_many' })
await new User().many('deleted_at', null, { operator: 'is_null' })
await new Post().many('tag_ids', null, { operator: 'empty' })            // posts without tags
```

##### Collecting Results

Use `collect()` to wrap queries with helpers:

```typescript
import { collect } from '@wakit/waorm'

const c = collect(new User().all())
await c.count()               // number of results
await c.items()               // Model instances
await c.itemsAsResource()     // plain resource objects
await c.each(async u => { })  // iterate
await c.delete()              // delete all matched
```

#### Database

In order to use your models, you need to set up the database. When initializing, by default, it sets the connection
of all models to that database connection, so you don't need to keep track of your database connection. You can, of course,
use a specific database connection for a specific model.

Here's an example how to setup the database>

```javascript
initDB({
  name: 'MyDatabase',
  // Increment the version every time you do a change on the schema
  version: 1,
  stores: [
    {
      name: 'todos',
      indexes: [
        { name: 'user_id' },
      ],
    },
    {
      name: 'users',
      indexes: [
        { name: 'name' },
        { name: 'email', unique: true },
      ],
    },
  ],
})
```

##### Schema Changes

On IndexedDB, the schema is only synced when `version` increases. On localStorage, it is synced on every `initDB`.
When synced:

- Missing stores and indexes are created
- Indexes no longer in `stores` are removed, and indexes whose `path`, `unique` or `multiEntry` changed are recreated
- Stores no longer in `stores` are kept, unless `dropUnknownStores: true` is set — **this deletes their data**

#### Deletion Tracking

To tell a server about local deletes, enable `trackDeletions` on the database and on each model to track. Deleting a
tracked model writes a tombstone to the reserved `$waorm:deletions` store, in the same transaction as the delete:

```typescript
import { initDB, Model, collect, deletions, clearDeletion } from '@wakit/waorm'

await initDB({ name: 'MyDatabase', version: 2, trackDeletions: true, stores: [...] })

class Activity extends Model {
  storeName() { return 'activities' }
  trackDeletions() { return true }
}

await activity.delete()                    // removes the record, writes a tombstone
await activity.delete({ track: false })    // no tombstone, e.g. applying a delete from the server
await collect(query).delete()              // every item is tracked too

await deletions('activities')              // [{ store, key, deleted_at, data }], oldest first
await deletions()                          // every store
await clearDeletion('activities', key)     // once the server confirmed the delete
```

- `data` holds the record's attributes at delete time, for servers that need more than the key.
- Keys starting with `generated_` were never on the server, so no tombstone is written.
- Saving a record clears its pending tombstone.
- A tracked model throws if the database doesn't have `trackDeletions` enabled.
- `deletions()` and `clearDeletion()` use the default connection, pass a connection as the last argument for another one.
- On IndexedDB, enabling `trackDeletions` on an existing database needs a `version` bump to create the store.
- Custom plugins must implement `deleteTracked(store, key, tombstone)` and `setTracked(store, key, data)`.

#### Version Changes

When a newer `version` is opened (e.g. in another tab), existing connections dispatch a version change event and close
themselves, so the upgrade isn't blocked. The closed connection can't be used anymore, so reload the app. If another
connection still holds the database open, a blocked event is dispatched and `initDB` waits until it's released:

```typescript
import { onDatabaseBlocked, onDatabaseVersionChange } from '@wakit/waorm'

onDatabaseVersionChange(({ name, oldVersion, newVersion }) => location.reload())
onDatabaseBlocked(({ name, oldVersion, newVersion }) => alert('Please close other tabs'))
```

#### Error Handling

`initDB` throws on failure after dispatching an event. Wrap in try/catch or listen for errors:

```typescript
import { initDB, onDatabaseInitError, onModelOperationError } from '@wakit/waorm'

onDatabaseInitError((err) => console.error('DB init failed:', err))
onModelOperationError((err) => console.error('Model op failed:', err))

await initDB({ ... })
```

## Example

Here is an example setup for a simple Todo App

#### JavaScript
```javascript

import { initDB, Model } from '@wakit/waorm'

class Todo extends Model {
  relationships() {
    return {
      user: {
        related: User,
        relationship: 'belongs',
        foreignKey: 'user_id',
      }
    }
  }

  storeName() {
    return 'todos'
  }
}

class User extends Model {
  relationships() {
    return {
      todos: {
        related: Todo,
        relationship: 'many',
        foreignKey: 'user_id',
      },
    }
  }

  storeName() {
    return 'users'
  }
}

const todo = () => (new Todo)
const user = () => (new User)

await initDB({
  name: 'TodoApp',
  version: 1,
  stores: [
    {
      name: 'todos',
      indexes: [
        { name: 'due_by' },
        { name: 'user_id' },
      ],
    },
    {
      name: 'users',
      indexes: [
        { name: 'name' },
        { name: 'email', unique: true },
      ],
    },
  ],
})

///// Using within the application /////

// Get 10 users that name doesn't include 'joao'
console.log(await user().with('todo').many('name', 'joao', { operator: 'not_includes', limit: 10 }))

const myUser = await user().find('email', 'user@example.com')

await todo().hydrate({ name: 'Clean room', due_by: '2025-01-01', user_id: myUser.id }).save()
```
#### TypeScript
```typescript
import { initDB, Model } from '@wakit/waorm'
import type { Resource, WaormRelationshipBag } from '@wakit/waorm'

interface TodoResource extends Resource {
  due_by: string;
  user_id: UserResource['id'];
}

interface UserResource extends Resource {
  name: string;
  email: string;
}

class Todo extends Model<TodoResource> {
  public due_by?: string;

  relationships(): WaormRelationshipBag {
    return {
      user: {
        related: User,
        relationship: 'belongs',
        foreignKey: 'user_id',
      }
    }
  }

  storeName(): string {
    return 'todos'
  }
}

class User extends Model<UserResource> {
  public name?: string;
  public email?: string;

  relationships(): WaormRelationshipBag {
    return {
      todos: {
        related: Todo,
        relationship: 'many',
        foreignKey: 'user_id',
      },
    }
  }

  storeName(): string {
    return 'users'
  }
}

const todo = () => (new Todo)
const user = () => (new User)

await initDB({
  name: 'TodoApp',
  version: 1,
  stores: [
    {
      name: 'todos',
      indexes: [
        { name: 'due_by' },
        { name: 'user_id' },
      ],
    },
    {
      name: 'users',
      indexes: [
        { name: 'name' },
        { name: 'email', unique: true },
      ],
    },
  ],
})

///// Using within the application /////

// Get 10 users that name doesn't include 'joao'
console.log(await user().with('todo').many('name', 'joao', { operator: 'not_includes', limit: 10 }))

const myUser = await user().find('email', 'user@example.com')

await todo().hydrate({ name: 'Clean room', due_by: '2025-01-01', user_id: myUser.id }).save()
```
