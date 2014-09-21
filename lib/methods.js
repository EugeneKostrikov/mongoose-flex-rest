var Parser = require('./parsers');
var Query = require('./query');
var parse = new Parser();

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
    query = new Query(globals, model, query.find, query.select, query.populate, query.sort, query.skip, query.limit, query.acl);
    var args = [customArgs];
    args.unshift(null);
    args.unshift(query);
    middleware.run('all', model, args, function(err){
      if (err) return callback(err);
      middleware.run('read', model, args, function(err){
        if (err) return callback(err);
        if (!query.valid.read){
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
    if (arguments.length > 1){
      if (und.isFunction(query)){
        callback = query;
        customArgs = {};
      }
    }

    if (!callback) throw new Error('Callback required');
    var args = [customArgs];
    var model = this;
    query = new Query(globals, model, query.find, query.select, query.populate, query.sort, query.skip, query.limit, query.acl);

    if (query.limit > globals.readLimit) {
      callback(new Error('Too much items requested'));
    }

    args.unshift(null);
    args.unshift(query);
    middleware.run('all', model, args, function(err){
      if (err) return callback(err);
      middleware.run('read', model, args, function(err){
        if (err) return callback(err);

        //FIXME seems that this validation is not covered with tests at all
        if (!query.valid.select){
          query.select = acl.getAllowed(query.acl, model);
        }
        if (!query.valid.read){
          return callback(new Error('Access denied: read'));
        }
        if (!query.valid.populate){
          return callback(new Error('Access denied: populate'));
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
    var model = this;

    async.map(data, function(item, nextItem){
      var args = [customArgs];
      accessLevel = accessLevel || {};
      accessLevel.create = accessLevel.create || 0;


      args.unshift(item); //Changing something
      args.unshift({acl: accessLevel}); //Null query

      middleware.run('all', model, args, function(err){
        if (err) return nextItem(err);
        middleware.run('create', model, args, function(err){
          if (err) return nextItem(err);
          if (!acl.validateCreate(accessLevel, model)){
            return nextItem(new Error('Access denied: create'));
          }
          var doc = new model(item);

          doc.validate(function(err){
            nextItem(err, doc);
          });
        });
      });
    }, function(err, validated){
      if (err) return callback(err);
      async.map(validated, function(doc, next){
        doc.save(function(err, saved){
          next(err, saved);
        });
      }, function(err, mapped){
        if (err) return callback(err);
        callback(null, mapped);
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
    var model = this;
    query = new Query(globals, model, query.find, query.select, query.populate, query.sort, query.skip, query.limit, query.acl);


    //TODO handle case of very large result set. Process in chunks.
    var args = [customArgs];
    args.unshift(command); //Changing something
    args.unshift(query); //Query

    middleware.run('all', model, args, function(err){
      if (err) return callback(err);
      middleware.run('update', model, args, function(err){
        if (err) return callback(err);
        if (!query.valid.read){
          return callback(new Error('Access denied: read'));
        }
        if (!acl.validateUpdate(command, query.acl, model)){
          return callback(new Error('Access denied: update'));
        }
        model.find(query.find, query.select, function(err, docs){
          if (err) return callback(err);
          var validation = [];
          und.each(docs, function(document){
            parse.update(document, command);
            validation.push(function(callback){
              document.validate(function(err){
                if (err) return callback(err);
                callback(null, document);
              });
            });
          });
          async.parallel(validation, function(err, valid){
            if (err) return callback(err);
            async.map(valid, function(doc, next){
              doc.save(function(err, saved){
                next(err, saved);
              });
            }, function(err, mapped){
              callback(err, mapped);
            });
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
    query = new Query(globals, model, query.find, query.select, query.populate, query.sort, query.skip, query.limit, query.acl);

    var args = [customArgs];
    args.unshift(null); //Nothing to change
    args.unshift(query); //Query
    middleware.run('all', model, args, function(err){
      if (err) return callback(err);
      middleware.run('delete', model, args, function(err){
        if (err) return callback(err);
        if (!query.valid.read){
          return callback(new Error('Access denied: read'));
        }
        if (!query.valid.delete){
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
