var und = require('underscore');

function virtualType(){} //placeholder function for virtual paths
exports.createRules = function(Schema, globals){
  //all access controls are defined in Schema
  var tree = Schema.tree;
  und.each(Schema.virtuals, function(pathOptions){
    var splitPath = pathOptions.path.split('.');
    iterate(tree, splitPath);
    function iterate(subTree, pathArray){
      var current = splitPath.shift();
      if (!subTree[current]) subTree[current] = {};
      if (pathArray.length !== 0) return iterate(subTree[current], pathArray);
      subTree[current].type = virtualType;
    }
  });
  var allPaths = []; //Array with all possible paths for the doc. Used to validate select.
  var acl = {}; //Index object that will be used later to validate access
  createMap(tree, acl, '');
  function createMap(tree, acl, context){
    tree = und.omit(und.isArray(tree) ? tree[0] : tree, ['_id', '__v', 'id']); //Ignore common fields
    und.each(tree, function(property, path){
      //property - schema path config.
      if (und.isObject(property.acl)){ //plain path with defined acl
        allPaths.push(context ? context + '.' + path : path); //Store paths to array
        //properties.acl - 4 values - create/read/update/delete.
        und.each(property.acl, function(value, key){
          //key - operation, e.g. read/update, value - access limit
          if (key === 'write') key = 'update'; //For backward compatibility
          define(value, path, key);
        });
      }else if(und.isArray(property)){ //array or embedded document
        if (und.isObject(property[0].acl)){ //plain array
          //properties.acl - 4 values - create/read/update/delete.
          //Path should have either completely defined acl or no acl at all to apply defaults
          und.each(property[0].acl, function(value, key){
            allPaths.push(context ? context + '.' + path : path); //Store paths to array
            //key - operation, e.g. read/update, value - access limit
            if (key === 'write') key = 'update'; //For backward compatibility
            define(value, path, key);
          });
        }else if (und.isArray(property) && und.isFunction(property[0].type)){ //Plain array but no acl is defined
          //handle case of array with no acl defined
          allPaths.push(context ? context + '.' + path : path);
          applyDefaults(path);
        }else{
          //Array of documents
          //First create acl map for nested paths
          createMap(tree[path], acl, context ? context + '.' + path : path);
          //Then evaluate primary path acl
          evaluatePrimaryPath(acl, context ? context + '.' + path : path);
        }
      }else{
        if (und.isFunction(property.type)){ //Found type definition - this is final node
          allPaths.push(context ? context + '.' + path : path);
          applyDefaults(path);
        }else{
          createMap(tree[path], acl, context ? context + '.' + path : path);
        }
      }
    });
    //Helpers
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
    function evaluatePrimaryPath(acl, path){
      allPaths.push(path);
      var nested = {
        read: [],
        create: [],
        update: [],
        delete: []
      };
      und.each(acl, function(level, levelKey){
        und.each(level, function(array, type){
          und.each(array, function(key){
            if (key.indexOf(path) === 0){
              nested[type].push(levelKey.replace('$',''));
            }
          });
        });
      });
      var readMax = findMin(nested.read);
      var updateMax = findMin(nested.update);
      define(readMax, path, 'read');
      define(updateMax, path, 'update');
      function findMin(array){
        return Math.max.apply(Math, array);
      }
    }
  }
  Schema.acl = { //Directly modifies schema
    paths: acl,
    create: globals.create, //Defines access on document level
    delete: globals.delete,
    all: allPaths
  };
  return Schema.acl;
};

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

exports.validatePop = function(popObj, acl, model){
  //get child model by ref
  var ref = model.schema.tree[popObj.path].ref || model.schema.tree[popObj.path][0].ref;
  var populatedSchema = model.prototype.model(ref);
  if (!popObj.select) popObj.select = exports.getAllowed(acl, populatedSchema);
  return exports.validateSelect(popObj.select, acl, populatedSchema);
};

exports.validateSelect = function(str, acl, model){
  var ok = true;
  var paths = [];
  if (str.length === 0 ){
    paths = model.schema.acl.all;
  }else{
    paths = str.split(' ');
  }
  paths.forEach(function(path){
    if (!/^-/.test(path)){ //ignore excluded paths
      path = path.replace(/^\+/, ''); //validate included paths
      if (!validate('read', model.schema.acl, acl.read || 0, path)){
        ok = false;
      }
    }
  });
  return ok;
};
exports.getAllowed = function(acl, model){
  var read = acl.read || 0;
  var allowed = [];
  for (var i = read; i >= 0; i --){ //Iterate from level user has access to down to 0
    if (model.schema.acl.paths['$' + i]){
      if (model.schema.acl.paths['$' + i].read){
        model.schema.acl.paths['$' + i].read.forEach(function(path){
          allowed.push(path);
        });
      }
    }
  }
  return allowed.join(' ');
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
      var fullPath = context ? context + '.' + path : path;
      //_ $ and . are reserved, see http://stackoverflow.com/questions/9759972/what-characters-are-not-allowed-in-mongodb-field-names
      var bucksFree = fullPath.replace(/\$[a-z]+\./ig, '');
      if (arr.indexOf(bucksFree) === -1){
        arr.push(bucksFree);
      }
    }
  });
}

function validate(action, model, user, path){
  if (user < 0) return false;
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
    return validate(action, model, user - 1, path);
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