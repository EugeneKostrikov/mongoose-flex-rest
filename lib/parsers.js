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
          parent[k] = item;
        }
      }
      if (und.isObject(item) && !und.isArray(item) && !/_\$/.test(key)){
        parent[key] = {};
        parent[key] = run(parent[key], item);
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

  /**
   * Recursive function to atomically update document. Supports most mongodb
   * update queries in /^_\$.+/ commands format.
   * Operates on document. Returns undefined.
   * @param document - document to iterate over or field to run command against
   * @param command - command to execute or fieldset to iterate over
   */

//TODO make _id and __v configurable
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
    //TODO make _id and __v deletes configurable
    values._id ? delete values._id : null;
    und.isNumber(values.__v) ? delete values.__v : null;
    document.set(values);
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

function $increment(doc, vals, context){
  var temp;
  und.each(vals, function(val, key){
    if (und.isObject(val)){
      //$inc-rementing value of nested doc
      //TODO handle array of documents
      var nextContext; //never modify context directly
      context ? nextContext = context + '.' + key : nextContext = key;
      $increment(doc, val, nextContext);
    }else{
      //End value found
      var path; //never modify context directly
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
        //TODO refactor:
        //Have no idea why doc.push does not work with arrays
        //The docs say this is casted to $pushAll. Needs more investigation
        und.each(val, function(item){
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
        doc[key].pull(val);
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
        und.each(val, function(item){
          doc[key].addToSet(item);
        });
      }
    }else{
      $addToSet(doc[key], val);
    }
  });

}



function deprecatedUpdate(document, command){
    und.each(command, function(item, path){
      //key - command or nested doc key
      //item - command params or nested doc field(s)
      // _$ prefix or plain-text field name

      //handle case of native mongodb syntax
      var keys = Object.keys(item);
      if (/^_\$.+/.test(path)){
        //this is command, run it
        doUpdates(document, path, item, keys);
      }else{
      if (keys.length > 1){

          //This is object with nested property iterate further
          if (und.isArray(document[path])){
            //Next step is array. Define what item to process.
            //Note trailing _ in _$where_ This is not what mongodb provides.
            var query = command[path]._$where_;
            var nextDoc;
            if (query._$index){
              //select document to update by provided index.
              //This is for compatibility with arrays.
              //If you update array of nested objects you should prefer to query by _id
              nextDoc = document[path][query._$index];
            }else if(query._id){
              //This is preferable query. It makes sure that you update object that you mean to update.
              for (var i = document[path].length - 1; i >= 0; i--){
                //Some black magic required to compare ObjectIds
                if (document[path][i]._doc._id.toString() === query._id){
                  nextDoc = document[path][i];
                  break;
                }
              }
            }else{
              //TODO query array by contents, not simple index
              throw new Error('This is not supported yet');
            }
            //We do not want to iterate this guy once again.
            delete command[path]._$where_;
            exports.update(nextDoc, command[path]);
          }else{
            exports.update(document[path], command[path]);
          }
      }else{
        //Congrats! We have a candidate for command
        if (/^_\$.+/.test(keys[0])){
          //Yep, this is a command
          doUpdates(document, path, item, keys);
        }else{
          //No, this was just an object - iterate further
          if (!und.isObject(document[path])){
            //May be we want to set just one top-level path?
            throw new Error('The document has no such key. Check what you query.');
          }
          exports.update(document[path], command[path])
        }
      }
    }
  });
}


function doUpdatesDeprecated(document, cmd){
  var data;
  //What type of field we are going to update?
  if (und.isArray(document[path])){
    if (keys[0] == '_$push'){
      //PUSH - for arrays only
      data = item[keys[0]];
      document[path].push(data);
    }else if(keys[0] == '_$pull'){
      //$pullAll equivalent
      //To remove embedded doc pass {_id: ObjectId} to data
      data = item[keys[0]];
      document[path].pull(data);
    }else if(keys[0] == '_$addToSet'){
      //Works properly only for arrays containing primitive types.
      //If inserted object has _id this works as simple push.
      //Such behaviour can be fixed by setting {_id: false} to the array in Schema definition
      //See this question for additional info http://stackoverflow.com/questions/21576282/mongodb-addtoset-on-a-list-of-embedded-document
      data = item[keys[0]];
      document[path].addToSet(data);
    }else{
      throw new Error('command is not supported');
    }
  }else{
    //As it is not an array we have only two options left
    //$set on embedded-doc/primitive-value and $inc on primitive value
    if (keys[0] == '_$inc'){
      //$inc - for numbers only.
      //It's not authentic $inc that mongodb provides as
      //atomicity is reached on application level, not database.
      //Expects integer. Either positive or negative.
      data = item[keys[0]];
      document[path] = document[path] + data;
    }else if(keys[0] === '_$set'){
      //SET works only for primitive types?
      //And what about embedded objects?
      if (und.isObject(document[path])){
        data = item[keys[0]];
        //issue $set on embedded! object
        document[path].set(path, data);
      }else{
        //issue $set on document itself
        document.set(keys, item);
        console.log(document);
      }
    }else{
      throw new Error('command is not supported');
    }
  }
}

