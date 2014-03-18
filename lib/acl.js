var und = require('underscore');

exports.createRules = function(Schema, globals){
  //all access controls are defined in Schema
  var tree = Schema.tree;
  var acl = {}; //Index object that will be used later to validate access
  createMap(tree, acl, '');
  //make this a function
  function createMap(tree, acl, context){
    tree = und.omit(und.isArray(tree) ? tree[0] : tree, ['_id', '__v', 'id']);
    und.each(tree, function(property, path){
      //property - schema path config.
      if (und.isObject(property.acl)){
        //properties.acl - 4 values - create/read/update/delete.
        und.each(property.acl, function(value, key){
          //key - operation, e.g. read/create/update/delete, value - access limit
          if (key === 'write'){
            if (!und.isObject(acl['$' + value])) acl['$' + value] = {};
            ['create', 'update', 'delete'].forEach(function(key){
              if (!und.isArray(acl['$' + value][key])) acl['$' + value][key] = [];
              acl['$' + value][key].push(context ? context + '.' + path : path);
            });
          }else{
            if (!und.isObject(acl['$' + value])) acl['$' + value] = {};
            if (!und.isArray(acl['$' + value][key])) acl['$' + value][key] = [];
            acl['$' + value][key].push(context ? context + '.' + path : path);
          }
        });
      }else if(und.isArray(property)){
        if (und.isObject(property[0].acl)){
          //properties.acl - 4 values - create/read/update/delete.
          und.each(property[0].acl, function(value, key){
            //key - operation, e.g. read/create/update/delete, value - access limit
            if (key === 'write'){
              if (!und.isObject(acl['$' + value])) acl['$' + value] = {};
              ['create', 'update', 'delete'].forEach(function(key){
                if (!und.isArray(acl['$' + value][key])) acl['$' + value][key] = [];
                acl['$' + value][key].push(context ? context + '.' + path : path);
              });
            }else{
              if (!und.isObject(acl['$' + value])) acl['$' + value] = {};
              if (!und.isArray(acl['$' + value][key])) acl['$' + value][key] = [];
              acl['$' + value][key].push(context ? context + '.' + path : path);
            }
          });
        }else{
          createMap(tree[path], acl, context ? context + '.' + path : path);
        }
      }else{
        //iterate further
        //check if it just has no acl defined
        //if ()
        createMap(tree[path], acl, context ? context + '.' + path : path);
      }
    });
  }
  Schema.acl = {
    paths: acl,
    create: globals.create,
    delete: globals.delete
  };
  return acl;
};

//TODO extend this to validate against schema definition
exports.validateCreate = function(acl, model){
  var level = acl.create || 0;
  return level >= model.schema.acl.create;
};

exports.validateDelete = function(acl, model){
  var level = acl.delete || 0;
  return level >= model.schema.acl.delete;
};

/**
 *
 * @param query - query to validate
 * @param acl - access rights hash
 * @param model - model to validate against
 */
exports.validateRead = function(query, acl, model){
  if (!model.schema.acl) throw new Error('Model has no acl'); //No acl specified for this model.
  var modelAcl = model.schema.acl;
  var uacl = acl.read || 0;
  var paths = [];
  parseQuery(paths, query, '');
  var allow = true;
  paths.forEach(function(path){
    if (!validate('read', modelAcl, uacl, path)){
      allow = false;
    }
  });
  return allow;
  //query
};

exports.validateUpdate = function(cmd, acl, model){
  if (!model.schema.acl) throw new Error('Model has no acl'); //Model has no acl defined
  var paths = [];
  var level = acl.update || 0;
  und.each(cmd, function(part){
    parseQuery(paths, part, '');
  });
  var allow = true;
  paths.forEach(function(path){
    if (!validate('update', model.schema.acl, level, path)){
      allow = false;
    }
  });
  return allow;
};

function parseQuery(arr, query, context, pathToSkip){
  var isolateQuery = clone(query);
  if (pathToSkip){
    isolateQuery = isolateQuery[pathToSkip];
  }
  if (isolateQuery._id) delete isolateQuery._id; //allow read _id for everyone.
  und.each(isolateQuery, function(nested, path){
    if (und.isObject(nested) && !und.isRegExp(nested)){
      var iterate = true, skip;
      Object.keys(nested).forEach(function(key){
        if (/(^|^_)\$.+/.test(key)){
          //handle $elemMatch
          if (key === '$elemMatch'){
            skip = '$elemMatch';
          }else if(key === '_$do_'){
            skip = '_$do_';
            iterate = true;
          }else{
            iterate = false;
          }
        }
      });
      if (iterate){
        parseQuery(arr, isolateQuery[path], context ? context + '.' + path : path, skip);
      }else{
        arr.push(context ? context + '.' + path : path);
      }
    }else{
      arr.push(context ? context + '.' + path : path);
    }
  });
}
function validate(action, model, user, path){
  try{
    if (model.paths['$' + user][action].indexOf(path) != -1){
      return true;
    }else{
      if (user > 0){
        return validate(model, user - 1, path);
      }else{
        return false;
      }
    }
  }catch(e){
    return Object.keys(model.paths).length - 1 < user;
  }
}

//helpers
function clone(obj){
  //Do not use it for dates.
  if (null == obj || "object" != typeof obj) return obj;
  var copy = obj.constructor();
  for (var attr in obj) {
    if (obj.hasOwnProperty(attr)) copy[attr] = obj[attr];
  }
  return copy;
}
