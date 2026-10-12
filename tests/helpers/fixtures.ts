import Model from '../../model'
import type { WaormRelationshipBag } from '../../index'

export class UserModel extends Model {
  declare id?: string
  name?: string
  email?: string

  storeName() {
    return 'users' 
  }
  fields() {
    return ['id', 'name', 'email'] 
  }

  relationships(): WaormRelationshipBag {
    return {
      posts: { related: PostModel, relationship: 'many', foreignKey: 'user_id' },
    }
  }
}

export class PostModel extends Model {
  declare id?: string
  title?: string
  user_id?: string
  tag_ids?: string[]

  storeName() {
    return 'posts'
  }
  fields() {
    return ['id', 'title', 'user_id', 'tag_ids']
  }

  relationships(): WaormRelationshipBag {
    return {
      author: { related: UserModel, relationship: 'belongs', foreignKey: 'user_id' },
      tags: { related: TagModel, relationship: 'belongsMany', foreignKey: 'tag_ids' },
    }
  }
}

export class TagModel extends Model {
  declare id?: string
  name?: string

  storeName() {
    return 'tags'
  }
  fields() {
    return ['id', 'name']
  }

  relationships(): WaormRelationshipBag {
    return {
      posts: { related: PostModel, relationship: 'many', foreignKey: 'tag_ids' },
    }
  }
}

export class SlugModel extends Model {
  slug?: string
  name?: string

  storeName() {
    return 'slugs' 
  }
  fields() {
    return ['slug', 'name'] 
  }
  getKeyField() {
    return 'slug' 
  }
}
