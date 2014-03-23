Flexible REST plugin.
=====================

## WARNING The plugin is undergoing major development so you should not rely on it in production environment.

Aren't you tired of writing REST endpoints for **every** model you work with?

This guy allows you to query mongodb from browser and enjoy all the stuff that mongoose
provides such as middleware, validation, whatever else. Moreover it comes with very powerful
access control layer

```js
var query = {
  title: {
    _$regex: {
      val: 'tweet',
      options: 'igm'
    }
  },
  rating: {
    _$gte: 10,
    _$lte: 15
  },
  tags: {
    _$all: ['mongodb', 'query', 'angular']
  }
};

var cmd = {
  $push: {
    tags: ['awesome']
  }
};

$http.put('/api/endpoint', ....);
```

will push 'awesome' tag to every document that matches query conditions.

### Ok, but why do you need underscores before commands??
This plugin a part of system designed to work with AngularJS app.
That's the answer for _s: https://groups.google.com/forum/#!msg/angular/ufHUVuIC3Xw/wACBMgOcWwgJ

~~Client code that leverages the plugin is available here:~~

_Well... Not really available yet. I will publish this as soon as i prove that it works_

## Install:
    npm install mongoose-flex-rest

> See this gist for the sample Schema definition //TODO create gist

### Read:
  First of all, remember that query syntax corresponds mongodb's one.
  There are only two edge cases when you should write something other that mongodb's query
  They are:
  1. $regex
  2. All operations on `Date`

  **$regex**
  Your JSON _$regex query is converted to `new RegExp()` object.
  The syntax for _$regex is

```js
  var query = {
    title: { //The field you want to apply regex to
      _$regex: { //This says parser to convert query to RegExp object
        val: 'pattern', //This is passed as the first argument to RegExp constructor
        options: 'ig' //Standard JS RegExp modifiers i/g/m
      }
    }
  }
```

  **dates**
  When you compose your query you should prefix Mongo's query keyword with 'd'
  to let the parser know that the value provided should be casted to `Date` object.
  ```js
    var query = {
      created: {
        _$dgt: '05-05-2014',
        _$dlte: '10-05-2014'
      }
    };
  ```

  Note, at the moment this does not work with:
  1. Array of dates

### Write:
  Write commands are a bit more complex.

  When you work with plain documents they completely reflect Mongo's operators, e.g.
  ```js
    var cmd = {
      _$set: {
        title: 'changed'
      }
    };
  ```
  In case of nested documents you should unwrap 'top.nested' to JS object, e.g.
  ```js
    var cmd = {
      _$set: {
        author: {
          fname: 'change'
        }
      }
    };
  ```
  And the most complex case is updating an embedded document. Here you should
  provide additional info within '_$where_' and '_$do_' properties.
  ```js
    var cmd = {
      _$addToSet:{
        comments: {
          _$where_:{
            _id : ObjectId
          },
          _$do_:{
            likes: ['username']
          }
        }
      }
    }
  ```

  The following commands are well tested at the moment:
  **$set** - works with any level of nesting as well as arrays of documents
  **$inc** - works _only_ with plain and nested objects
  **$push** - works with any level of nesting as well as arrays of documents. Performs $pushAll command
  **$pull** - works with any level of nesting as well as arrays of documents. Performs $pullAll command
  **$addToSet** - works with any level of nesting as well as arrays of documents.

## API:

## License: MIT

