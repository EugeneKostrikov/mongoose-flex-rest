//Do we need a mess of _'s? I believe we do not :)
var und = require('underscore');
/**
 * Operates on an empty object. Returns rewritten query.
 * @param query
 * @returns {*}
 */
exports.query = function(query) {
  if (und.isString(query)){
    query = JSON.parse(query);
  }
  function run(parent, nested){
    und.each(nested, function(item, key){
      var k;
      if (/^_\$/.test(key)){
        if (/^_\$d/.test(key)){
          k = key.replace(/_\$d/, '$');
          parent[k] = new Date(item);
        }else if (key === '_$regex'){
          parent['$regex'] = new RegExp(item.val, item.options);
        }else{
          k = key.replace(/_/, '');
          if (und.isObject(item) && !und.isArray(item)){
            parent[k] = {};
            parent[k] = run(parent[k], item);
          }else{
            parent[k] = item;
          }
        }
      }
      if (und.isObject(item) && !und.isArray(item) && !/_\$/.test(key)){
        parent[key] = {};
        parent[key] = run(parent[key], item);
      }else if(und.isArray(item) && /\$(or|and|not|nor)/.test(k)){
        parent[k] = [];
        und.each(item, function(subQuery){
          parent[k].push(run({}, subQuery));
        });
      }else{
        if (!/_\$/.test(key)){
          parent[key] = item;
        }
      }
    });
    return parent;
  }

  return run({}, query);
};

exports.populate = function(populate){
  if (und.isUndefined(populate)) return [];
  var result = [];
  if (und.isString(populate)){
    result.push({
      path: populate,
      select: ''
    });
  }else if (und.isArray(populate)){
    result = populate;
  }else if (und.isObject(populate)){
    result.push(populate);
  }
  return result;
};

  /**
   * Recursive function to atomically update document. Supports most mongodb
   * update queries in /^_\$.+/ commands format.
   * Operates on document. Returns undefined.
   * @param document - document to iterate over or field to run command against
   * @param command - command to execute or fieldset to iterate over
   */

exports.update = function(document, command){
  if (!und.isObject(command)) throw new Error('Command should be an object');
  //decide when to update - loop through all keys until encounter command
  und.each(command, function(value, key){
    if (/^_\$.+/.test(key)){
      //run command
      doUpdates(document, command);
    }else{
      //dig one level deeper
      exports.update(document[key], command[key]);
    }
  });
};

function doUpdates(document, cmd){
  //Define what type of command should be executed
  var key = Object.keys(cmd)[0];
  var values = cmd[key];
  if (key === '_$set'){
    $set(document, values);
  }else if(key === '_$inc'){
    //This is not native $inc!
    //values = {what: how} or {what: nested: how}
    //If 'how' isObject - continue lookup
    $increment(document, values, '');
  }else if(key === '_$push'){
    //Transforms _$push object to mongoose's doc.push() method
    $push(document, values);
  }else if (key === '_$pull'){
    //Transforms _$pull object to mongoose's doc.pull() method
    $pull(document, values);
  }else if(key === '_$addToSet'){
    //Avoid using this method on sets of documents
    //it works only if ALL fields are specified (including _id and __v, etc.)
    $addToSet(document, values);
  }
}

function $set(doc, vals){
  //Do not modify _id and versionKey
  vals._id ? delete vals._id : null;
  var versionKey = doc.__proto__.schema.options.versionKey;
  und.isNumber(vals[versionKey]) ? delete vals[versionKey] : null;
  //Where lookup works only when applied separately from plain updates.
  if (/_\$where_/g.test(JSON.stringify(vals))){
    und.each(vals, function(item, key){
      if (und.isObject(item) && Object.keys(item)[0] === '_$where_'){
        var toChange = und.findWhere(doc[key], item._$where_);
        toChange.set(item._$do_);
      }else{
        doc.set({key: item});
      }
    });
  }else{
    doc.set(vals);
  }

  function iterate(cmd, context){

  }
}

function $increment(doc, vals, context){
  var temp, path;
  und.each(vals, function(val, key){
    if (und.isObject(val)){
      var immediateKeys = Object.keys(val);
      if (immediateKeys.indexOf('_$do_') !== -1){
        //handle case of array
        if (immediateKeys.indexOf('_$index_') !== -1){
          //While handy sometimes modifying by index is bad practice
          if (!context){
            path = key;
            temp = doc.get(path);
            temp = temp[val._$index_];
            doc[path].set(val._$index_, temp + val._$do_);
          }else{
            throw new Error('This is not supported yet');
          }
        }else if(immediateKeys.indexOf('_$where_') !== -1){
          path = context ? context + '.' + key : key;
          var docToUpdate = und.findWhere(doc[path], val._$where_);
          und.forEach(val._$do_, function(item, path){
            temp = docToUpdate.get(path);
            docToUpdate.set(path, temp + item);
          });
        }else{
          throw new Error('Unknown command');
        }
      }else{
        //it's just a nested doc
        //var nextContext; //never modify context directly
        $increment(doc, val, context ? context + '.' + key : key);
      }
    }else{
      //End value found
      //never modify context directly
      context ? path = context + '.' + key : path = key;
      temp = doc.get(path);
      doc.set(path, temp + val);
    }
  });
}

function $push(doc, vals){
  und.each(vals, function(val, key){
    if (und.isArray(doc[key])){ //check type defined in schema
      //Handle case of deep nesting
      if (und.isObject(val) && Object.keys(val).indexOf('_$where_') != -1){
        //Note use of und.findWhere. It returns FIRST match.
        $push(und.findWhere(doc[key], val._$where_), val._$do_);
      }else{
        //Have no idea why doc.push does not work with arrays
        //The docs say this is casted to $pushAll. Needs more investigation
        val.forEach(function(item){
          doc[key].push(item);
        });
      }
    }else{
      $push(doc[key], val);
    }
  });
}

function $pull(doc, vals){
  und.each(vals, function(val, key){
    if (und.isArray(doc[key])){ //check type defined in schema
      //Handle case of deep nesting
      if (und.isObject(val) && Object.keys(val).indexOf('_$where_') != -1){
        //Note use of und.findWhere. It returns FIRST match.
        if(val._$do_){
          $pull(und.findWhere(doc[key], val._$where_), val._$do_);
        }else{
          doc[key].pull(und.findWhere(doc[key], val._$where_));
        }
      }else{
        val.forEach(function(item){
          doc[key].pull(item);
        });
      }
    }else{
      $pull(doc[key], val);
    }
  });
}

function $addToSet(doc, vals){
  und.each(vals, function(val, key){
    if (und.isArray(doc[key])){ //check type defined in schema
      //Handle case of embedded arrays of documents
      if (und.isObject(val) && Object.keys(val).indexOf('_$where_') != -1){
        //Note use of und.findWhere. It returns FIRST match.
        $addToSet(und.findWhere(doc[key], val._$where_), val._$do_);
      }else{
        val.forEach(function(item){
          doc[key].addToSet(item);
        });
      }
    }else{
      $addToSet(doc[key], val);
    }
  });

}