var und = require('underscore');
var events = require('events');
var util = require('util');

function Parser(){
  this.difficulty = {
    $regex: 0,
    logical: 0,
    comparison: 0
  }
}

module.exports = Parser;
/**
 * Operates on an empty object. Returns rewritten query.
 * @param query
 * @returns {*}
 */
Parser.prototype.query = function(query) {
  var self = this;
  if (und.isString(query)){
    query = JSON.parse(query);
  }
  function run(parent, nested){
    und.each(nested, function(item, key){
      if (key === '$dgte' || key === '$dlte' || key === '$dgt' || key === '$dlt'){
        parent[key.replace(/\$d/, '$')] = new Date(item);
      }else if (key === '$regex'){
        parent['$regex'] = new RegExp(item.val, item.options);
        self.difficulty.$regex++;
      }else{
        if (und.isObject(item) && !und.isArray(item)){
          parent[key] = {};
          parent[key] = run(parent[key], item);
        }else{
          parent[key] = item;
        }
      }
      if(und.isArray(item) && /\$(or|and|not|nor)/.test(key)){
        self.difficulty.logical += item.length;
        parent[key] = [];
        und.each(item, function(subQuery){
          parent[key].push(run({}, subQuery));
        });
      }else{
        //TODO: do something with this.
        if (/\$(gt|gte|lt|lte|in|ne|nin)/.test(key)) self.difficulty.comparison++;
      }
    });
    return parent;
  }

  return run({}, query);
};

Parser.prototype.populate = function(populate){
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

Parser.prototype.update = function(document, command){
  if (!und.isObject(command)) throw new Error('Command should be an object');
  //decide when to update - loop through all keys until encounter command
  und.each(command, function(value, key){
    if (/^\$.+/.test(key)){
      //run command
      doUpdates(document, command, key);
    }else{
      //dig one level deeper
      exports.update(document[key], command[key]);
    }
  });
};

function doUpdates(document, cmd, key){
  //Define what type of command should be executed
  var values = cmd[key];
  if (key === '$set'){
    $set(document, values);
  }else if(key === '$inc'){
    //This is not native $inc!
    //values = {what: how} or {what: nested: how}
    //If 'how' isObject - continue lookup
    $increment(document, values, '');
  }else if(key === '$push'){
    //Transforms _$push object to mongoose's doc.push() method
    $push(document, values);
  }else if (key === '$pull'){
    //Transforms _$pull object to mongoose's doc.pull() method
    $pull(document, values);
  }else if(key === '$addToSet'){
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

/**
 * Caveats:
 * 1. This line can cause issues if you add array path to schema, but stored document does not have such path.
 * To solve it simply force stored objects to have corresponding array (even empty).
 * @param doc
 * @param vals
 */

function $push(doc, vals){
  und.each(vals, function(val, key){
    //Caveat #1
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