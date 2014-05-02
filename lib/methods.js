var parse = require('./parsers');
var acl = require('./acl');
var und = require('underscore');
var async = require('async');

module.exports = function(globals, middleware){
  return {
    head: head,
    read: read,
    create: create,
    update: update,
    del: del
  };

  /**
   * Almost the same as read method but returns only aggregated info
   * @param query
   * @param customArgs {Object} - custom arguments for middleware
   * @param callback - required!
   */
  function head(query, customArgs, callback){
    if (arguments.length > 1){
      if (und.isFunction(query)){
        callback = query;
        query = {};
      }
    }
    if (!callback) throw new Error('Head method requires a callback');
    var model = this;
    query = query || {};
    query.find = query.find || {};
    query.find = parse.query(query.find);
    query.skip = query.skip || 0;
    query.limit = und.isUndefined(query.limit) ? 25 : query.limit;
    query.acl = query.acl || {read: 0};
    var args = [customArgs];
    args.unshift(null);
    args.unshift(query);
    middleware.run('all', model, args, function(err){
      if (err) return callback(err);
      middleware.run('read', model, args, function(err){
        if (err) return callback(err);
        if (!acl.validateRead(query, query.acl, this)){
          return callback(new Error('Access denied: head'));
        }

        var response = {};
        model.count(query.find, function(err, count){
          if (err) return callback(err);
          response.count = count;
          if (query.limit != 0){
            response.pages = Math.ceil(count / query.limit) || 1;
            response.current = Math.ceil(query.skip / query.limit) + 1;
          }else{
            response.pages = 1;
            response.current = 1;
          }
          callback(null, response);
        });
      });
    });
  }

  /**
   * Queries the db with provided options
   * @param query - query to pass to the db
   * @param customArgs {Object} - custom arguments for middleware
   * @param callback - required
   */
  function read(query, customArgs, callback){
    //Here a new Query object should be created and store context of current request.
    if (arguments.length > 1){
      if (und.isFunction(query)){
        callback = query;
        customArgs = {};
      }
    }

    if (!callback) throw new Error('Callback required');
    var args = [customArgs];
    var model = this;
    query = query || {};
    query.find = query.find || {};
    query.sort = query.sort || '_id';
    query.acl = query.acl || {read: 0};
    query.select = query.select || acl.getAllowed(query.acl, model);

    query.populate = parse.populate(query.populate);
    query.skip = query.skip || 0;
    query.limit = und.isUndefined(query.limit) ? 25 : query.limit;

    if (query.limit > globals.readLimit) {
      callback(new Error('Too much items requested'));
    }

    query.find = parse.query(query.find);
    args.unshift(null);
    args.unshift(query);
    middleware.run('all', model, args, function(err){
      if (err) return callback(err);
      middleware.run('read', model, args, function(err){
        if (err) return callback(err);

      if (!acl.validateSelect(query.select, query.acl, model)){
        query.select = acl.getAllowed(query.acl, model);
        //return callback(new Error('Access denied'));
      }
        if (!acl.validateRead(query.find, query.acl, model)){
          return callback(new Error('Access denied: read'));
        }
        if (query.populate.length > 0){
          var populateValidationError = null;
          query.populate.forEach(function(pop){
            if (!acl.validatePop(pop, query.acl, model)){
              return populateValidationError = new Error('Access denied: populate');
            }
          });
          if (populateValidationError) return callback(populateValidationError);
        }
        var q = model.find(query.find);
        q.sort(query.sort);
        q.skip(query.skip);
        q.limit(query.limit);
        q.select(query.select);
        q.populate(query.populate);
        q.lean().exec(callback);
      });
    });
  }

  /**
   * A method to create document
   * @param data - data to store to the db
   * @param accessLevel - users level to validate query against
   * @param customArgs {Object} - custom arguments to middleware.
   * @param callback - if function returns saved document
   * @returns {model} - mongoose document. Returned when no callback passed
   */
  function create(data, accessLevel, customArgs, callback){
    if (arguments.length > 1){
      if (und.isFunction(accessLevel)){
        callback = accessLevel;
        accessLevel = {};
      }
    }

    if (!callback) throw new Error('Callback required');
    var args = [customArgs];
    accessLevel = accessLevel || {};
    accessLevel.create = accessLevel.create || 0;
    var model = this;

    args.unshift(data); //Changing something
    args.unshift(null); //Null query

    middleware.run('all', model, args, function(err){
      if (err) return callback(err);
      middleware.run('create', model, args, function(err){
        if (err) return callback(err);
        if (!acl.validateCreate(accessLevel, model)){
          return callback(new Error('Access denied: create'));
        }
        var doc = new model(data);

        doc.save(callback);
      });
    });
  }

  /**
   * A method to update document. If stated
   * @param query - id of the document to update
   * @param command - data to be updated
   * @param customArgs {Object} - custom arguments for middleware. always: [query, command (not parsed)]
   * @param callback - required
   */
    //TODO handle __v control errors?
  function update(query, command, customArgs, callback){
    if (arguments.length > 1){
      if (und.isFunction(query)){
        callback = query;
        customArgs = {};
      }
    }
    if (!und.isFunction(callback)) throw new Error('Callback required');
    query = query || {};
    query.find = query.find || {};
    query.select = query.select || '';
    query.rewrite = query.rewrite || false;
    query.acl = query.acl || {read: 0, update: 0};
    var model = this;
    query.find = parse.query(query.find);
    if (!acl.validateRead(query.find, query.acl, model)){
      return callback(new Error('Access denied: read'));
    }
    //TODO handle case of very large result set. Process in chunks.
    var args = [customArgs];
    args.unshift(command); //Changing something
    args.unshift(query); //Query

    middleware.run('all', model, args, function(err){
      if (err) return callback(err);
      middleware.run('update', model, args, function(err){
        if (err) return callback(err);
      model.find(query.find, query.select, function(err, docs){
        if (err) return callback(err);
        var tasks = [];
        und.each(docs, function(document){

          if (!acl.validateUpdate(command, query.acl, model)){
            return callback(new Error('Access denied: update'));
          }
          parse.update(document, command);
          tasks.push(function(callback){
            document.save(function(err, updated){
              callback(err, updated);
            });
          });
        });
        async.parallel(tasks, function(err, results){
          if (query._id){
            callback(err, results[0]);
          }else{
            callback(err, results, results.length);
          }
        });
      });
      });
    });
  }

  function del(query, customArgs, callback){
    var model = this;
    if (und.isFunction(customArgs)){
      callback = customArgs;
      customArgs = {};
    }
    if (!callback) throw new Error('Callback required');
    query.acl = query.acl || {};
    query.acl.delete = query.acl.delete || 0;
    query.acl.read = query.acl.read || 0;

    query.find = parse.query(query.find);

    var args = [customArgs];
    args.unshift(null); //Nothing to change
    args.unshift(query); //Query
    middleware.run('all', model, args, function(err){
      if (err) return callback(err);
      middleware.run('delete', model, args, function(err){
        if (err) return callback(err);
        if (!acl.validateRead(query.find, query.acl.read, model)){
          return callback(new Error('Access denied: read'));
        }
        if (!acl.validateDelete(query.acl, model)){
          return callback(new Error('Access denied: delete'));
        }

        model.find(query.find, function(err, docs){
          if (err) return callback(err);
          async.each(docs, function(doc, next){
            doc.remove(function(err){
              next(err);
            });
          }, function(err){
            callback(err);
          });
        });
      });
    });
  }
};

