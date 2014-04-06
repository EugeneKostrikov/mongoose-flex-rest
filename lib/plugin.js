
var mongoose = require('mongoose');
var _ = require('underscore');
var async = require('async');
var parse = require('./parsers');
var acl = require('./acl');

//E.g. doc has user's ID and this id should match for query to be satisfied
var plugin = function(Schema, globals){
  globals = globals || {};
  globals.exclude = globals.exclude || [];
  globals.acl = globals.acl || {create: 1, delete: 1}; //Restrict by default
  acl.createRules(Schema, {create: globals.acl.create, delete: globals.acl.delete});

  /**
   * Almost the same as read method but returns only aggregated info
   * @param query
   * @param options
   * @param callback - required!
   */
  function head(query, options, callback){
    if (arguments.length > 1){
      if (_.isFunction(options)){
        callback = options;
        options = {};
      }
    }
    if (!callback) throw new Error('Head method requires a callback');

    options = options || {};
    options.skip = options.skip || 0;
    options.limit = options.limit || 25;
    options.acl = options.acl || {read: 0};
    query = parse.query(query);
    if (!acl.validateRead(query, options.acl, this)){
      return callback(new Error('Access denied'));
    }

    var response = {};
    this.count(query, function(err, count){
      if (err) return callback(err);
      response.count = count;
      if (options.limit != 0){
        response.pages = Math.ceil(count / options.limit) || 1;
        response.current = Math.ceil(options.skip / options.limit) + 1;
      }else{
        response.pages = 1;
        response.current = 1;
      }
      callback(null, response);
    });
  }

  /**
   * Queries the db with provided options
   * @param query - query to pass to the db
   * @param options - select and populate options
   * @param callback - if provided F returns executed query
   * @returns {q} - mongoose query object. Returned when no callback passed.
   */
  function read(query, options, callback){
    if (arguments.length > 1){
      if (_.isFunction(options)){
        callback = options;
        options = {};
      }
    }
    options = options || {};
    options.sort = options.sort || '_id';
    options.select = options.select || null;
    options.acl = options.acl || {read: 0};

    if(_.isArray(options.populate)){
      // populate several paths
      var result = [];
      options.populate.forEach(function(obj){
        result.push(JSON.parse(obj));
      });
      options.populate = result;
    }else{
      //either one path needs to be populated or populate is not specified
      try{
        //populate one path with options
        options.populate = JSON.parse(options.populate);
      }catch(e){
        var p = options.populate;
        options.populate = [];
        options.populate.push({
          path: p || '',
          select: ''
        });
      }
    }
    options.skip = options.skip || 0;
    options.limit = options.limit || 25;
    var model = this;

    //if (!options.acl) return callback(new Error({status: 403, message: 'Access denied'}));
    if (options.limit > 500) {
      callback(new Error({status: 400, message: 'Too much items requested'}));
    }

    //if (!acl(model, query, options)) return callback(new Error({status: 403, message: 'Access denied'}));
    query = parse.query(query);
    if (!acl.validateRead(query, options.acl, model)){
      return callback(new Error('Access denied'));
    }
    //console.log('actual query is: ', JSON.stringify(query));
    var q = model.find(query);
    q.sort(options.sort);
    q.skip(options.skip);
    q.limit(options.limit);
    q.select(options.select);
    q.populate(options.populate);
    q.lean(); //because of https://groups.google.com/forum/#!topic/mongoose-orm/u2_DzDydcnA/discussion

    if (_.isFunction(callback)) return q.exec(callback);
    return q;
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
      if (_.isFunction(options)){
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

    if (_.isFunction(callback)) return doc.save(callback);
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
      if (_.isFunction(options)){
        callback = options;
        options = {};
      }
    }
    if (!_.isFunction(callback)) throw new Error('Callback required');
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
      _.each(docs, function(document){
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

  if (globals.exclude.indexOf('head') === -1){
    Schema.statics['rest_head'] = head;
  }
  if (globals.exclude.indexOf('create') === -1){
    Schema.statics['rest_create'] = create;
  }
  if (globals.exclude.indexOf('read') === -1){
    Schema.statics['rest_read'] = read;
  }
  if (globals.exclude.indexOf('update') === -1){
    Schema.statics['rest_update'] = update;
  }
  if (globals.exclude.indexOf('delete') === -1){
    Schema.statics['rest_delete'] = del;
  }
};

module.exports = plugin;