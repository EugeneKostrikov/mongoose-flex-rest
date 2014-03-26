var und = require('underscore');

exports.createRules = function(Schema, globals){
  //FIXME apply defaults to array
  //all access controls are defined in Schema
  var tree = Schema.tree;
  var allPaths = []; //Array with all possible paths for the doc. Used to validate select.
  var acl = {}; //Index object that will be used later to validate access
  createMap(tree, acl, '');
  //make this a function
  function createMap(tree, acl, context){
    tree = und.omit(und.isArray(tree) ? tree[0] : tree, ['_id', '__v', 'id']); //Ignore common fields
    und.each(tree, function(property, path){
      //property - schema path config.
      if (und.isObject(property.acl)){ //plain object with defined acl
        allPaths.push(context ? context + '.' + path : path); //Store paths to array
        //properties.acl - 4 values - create/read/update/delete.
        und.each(property.acl, function(value, key){
          //key - operation, e.g. read/create/update/delete, value - access limit
          if (key === 'write'){ //define all writing levels with single command
            //TODO deprecate this
            iterateKeys(value, path);
          }else{
            define(value, path, key);
          }
        });
      }else if(und.isArray(property)){ //array or embedded document
        if (und.isObject(property[0].acl)){ //well, just an array
          //properties.acl - 4 values - create/read/update/delete.
          //FIXME this ingores defaults. Check if acl has all keys and apply default val otherwise
          und.each(property[0].acl, function(value, key){
            allPaths.push(context ? context + '.' + path : path); //Store paths to array
            //key - operation, e.g. read/create/update/delete, value - access limit
            if (key === 'write'){
              iterateKeys(value, path);
            }else{
              define(value, path, key);
            }
          });
        }else if (und.isArray(property) && und.isFunction(property[0].type)){ //No acl defined
          //handle case of array with no acl defined
          applyDefaults(path);
        }else{
          createMap(tree[path], acl, context ? context + '.' + path : path);
        }
      }else{
        if (und.isFunction(property.type)){ //Found type definition - this is final node
          applyDefaults(path);
        }else{
          createMap(tree[path], acl, context ? context + '.' + path : path);
        }
      }
    });
    //Helpers
    function iterateKeys(value, path){
      ['create', 'update', 'delete'].forEach(function(key){
        define(value, path, key);
      });
    }
    function define(value, path, key){
      if (!und.isObject(acl['$' + value])) acl['$' + value] = {};
      if (!und.isArray(acl['$' + value][key])) acl['$' + value][key] = [];
      acl['$' + value][key].push(context ? context + '.' + path : path);
    }
    function applyDefaults(path){
      ['create', 'read', 'update', 'delete'].forEach(function(key){
        var target = globals[key] || 0;
        if (!und.isObject(acl['$' + target])) acl['$' + target] = {};
        if (!und.isArray(acl['$' + target][key])) acl['$' + target][key] = [];
        acl['$' + target][key].push(context ? context + '.' + path : path);
      });
    }
  }
  //FIXME ouch... Bad idea to modify something directly
  Schema.acl = { //Directly modify schema
    paths: acl,
    create: globals.create,
    delete: globals.delete,
    all: allPaths
  };
  return Schema.acl;
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

exports.validateSelect = function(str, acl, model){
  var paths = str.split(' ');
  var ok = true;
  paths.forEach(function(path){
    if (!validate('read', model.schema.acl, acl.read || 0, path)){
      ok = false;
    }
  });
  return ok;
};
exports.getAllowed = function(acl, model){
  var read = acl.read || 0;
  var allowed = [];
  for (var i = read; i >= 0; i --){ //Iterate from level user has access to down to 0
    model.schema.acl.paths['$'+i].read.forEach(function(path){
      allowed.push(path);
    });
  }
  return allowed.join(' ');
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
  //setDefaults(query, 'read', uacl);
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
  if (isolateQuery._id) delete isolateQuery._id; //allows read _id for everyone.
  und.each(isolateQuery, function(nested, path){
    if (und.isObject(nested) && !und.isRegExp(nested) && !und.isArray(nested)){
      var iterate = true, skip;
      Object.keys(nested).forEach(function(key){
        if (/(^|^_)\$.+/.test(key)){ //FIXME What the hack this branch does?
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
        addToArray();
      }
    }else if (und.isArray(nested)){
      nested.forEach(function(nest, index){
        if (und.isObject(nest)){
          parseQuery(arr, isolateQuery[path][index], context ? context + '.' + path : path);
        }
      });
    }else{
      addToArray();
    }

    function addToArray(){
      if (arr.indexOf(context ? context + '.' + path : path) === -1){
        arr.push(context ? context + '.' + path : path);
      }
    }
  });
}

function validate(action, model, user, path){
  try{
    if (model.paths['$' + user][action].indexOf(path) != -1){
      return true;
    }else{
      if (user > 0){
        return validate(action, model, user - 1, path);
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