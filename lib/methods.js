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
   * @param args - custom arguments for middleware
   * @param callback - required!
   */
  function head(query, args, callback){
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
    args = args || [];
    args.unshift(query);
    middleware.run('all', model, args, function(err){
      if (err) return callback(err);
      middleware.run('read', model, args, function(err){
        if (err) return callback(err);
        if (!acl.validateRead(query, query.acl, this)){
          return callback(new Error('Access denied'));
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
   * @param args - custom arguments for middleware
   * @param callback - required
   */
  function read(query, args, callback){
    //Here a new Query object should be created and store context of current request.
    if (arguments.length > 1){
      if (und.isFunction(query)){
        callback = query;
        args = [];
      }
    }

    if (!callback) throw new Error('Callback required');
    args = args || [];
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
          return callback(new Error('Access denied'));
        }
        if (query.populate.length > 0){
          var populateValidationError = null;
          query.populate.forEach(function(pop){
            if (!acl.validatePop(pop, query.acl, model)){
              return populateValidationError = new Error('Access denied');
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
   * @param options - not used at the moment
   * @param callback - if function returns saved document
   * @returns {model} - mongoose document. Returned when no callback passed
   */
  function create(data, options, callback){
    if (arguments.length > 1){
      if (und.isFunction(options)){
        callback = options;
        options = {};
      }
    }

    options.acl = options.acl || {create: 0};

    var model = this;
    if (!acl.validateCreate(options.acl, model)){
      return callback(new Error('Access denied'));
    }
    var doc = new model(data);

    if (und.isFunction(callback)) return doc.save(callback);
    return doc;
  }

  /**
   * A method to update document. If stated
   * @param query - id of the document to update
   * @param command - data to be updated
   * @param options
   * @param callback - required
   */
    //TODO handle __v control errors?
  function update(query, command, options, callback){
    if (arguments.length > 1){
      if (und.isFunction(options)){
        callback = options;
        options = {};
      }
    }
    if (!und.isFunction(callback)) throw new Error('Callback required');
    options = options || {};
    options.select = options.select || ''; //Fields to return
    options.rewrite = options.rewrite || false;
    options.acl = options.acl || {read: 0, update: 0};
    var model = this;
    var q = parse.query(query);
    if (!acl.validateRead(q, options.acl, model)){
      return callback(new Error('Access denied'));
    }
    //options.select = Object.keys(data).join(' ');
    //TODO handle case of very large result set. Process in chunks.
    model.find(q, options.select, function(err, docs){
      if (err) return callback(err);
      var tasks = [];
      und.each(docs, function(document){
        // I assume that _$cmd keys will have last item in children chain
        // _$where key is not passed to update routine
        parse.update(document, command);
        if (!acl.validateUpdate(command, options.acl, model)){
          return callback(new Error('Access denied'));
        }
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
  }

  function del(id, uacl, callback){
    var model = this;
    if (!callback) throw new Error('Callback required');
    uacl = uacl || {delete : 0};
    if (!acl.validateDelete(uacl, model)){
      return callback(new Error('Access denied'));
    }
    model.findById(id, function(err, doc){
      if (err) return callback(err);
      doc.remove(function(err){
        callback(err);
      });
    });
  }
};

