var acl = require('../lib/acl');
var should = require('should');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var schema = new Schema({
  path: {type: String, acl:{read: 1, write: 2}},
  embedded:{
    path: {type: String, acl:{read: 0, write: 1}},
    array: [{type: String, acl:{read: 1, write: 1}}]
  },
  array: [{type: String, acl:{create: 1, read: 2, update: 3, delete: 4}}],
  arrayOfDocs: [{
    path: {type: String, acl:{create: 3, read: 1, update: 3, delete:3}},
    array: {type: String, acl:{read: 0, write: 0}}
  }],
  aclIsNotDefinedObject: {},
  aclIsNotDefinedArray: [{type: String}],
  aclIsNotDefined: {type: String}
});
var model = mongoose.model('acl_model', schema);
acl.createRules(schema, {create: 1, delete: 1});

var user = {
  acl: {
    read: 1,
    create: 2,
    update: 2,
    delete: 2
  }
};


describe('Access control', function(){
  describe('consumption', function(){
    it('should properly validate read query', function(){
      //consumes rewritten query after query parser
      var q = {
        array: {
          $in: ['something']
        },
        path: new RegExp('something', 'ig'),
        embedded:{
          path: 'another'
        },
        arrayOfDocs:{
          $elemMatch:{
            path: 'value'
          }
        }
      };
      (acl.validateRead(q, user, model)).should.not.be.ok;
      user.acl.read = 10;
      (acl.validateRead(q, user, model)).should.be.ok;
    });
    it('should properly validate update query', function(){
      var cmd = {
        $set: {
          path: 'new value'
        },
        $push: {
          array: 'something'
        },
        $addToSet: {
          embedded: {
            array: 'something'
          }
        },
        $pull: {
          arrayOfDocs: {
            _$where_:{
              path: ''
            },
            _$do_: {
              array: 'item to pull'
            }
          }
        }
      };
      (acl.validateUpdate(cmd, user, model)).should.not.be.ok;
      user.acl.update = 10;
      (acl.validateUpdate(cmd, user, model)).should.be.ok;
    });
    it('should properly validate selected values', function(){
      //consumes options.select value + populate.select values
      //May be implement via middleware? pre/post init.

    });
  });
  describe('indexing', function(){
    it('should generate proper map', function(done){
      var map = acl.createRules(schema, {create: 1, delete: 1});
      (map.$1.read).should.be.an.Array;
      (map.$1.read.indexOf('path')).should.not.equal(-1);
      (map.$1.read.indexOf('embedded.array')).should.not.equal(-1);
      done();
    });
  });
  describe('performance', function(){
    it('complex read parsing', function(){
      var start = Date.now();
      for(var i = 1000; i > 0; i--){
        var q = {
          array: {
            $in: ['something']
          },
          path: new RegExp('something', 'ig'),
          embedded:{
            path: 'another'
          },
          arrayOfDocs:{
            $elemMatch:{
              path: 'value'
            }
          }
        };
        acl.validateRead(q, user, model);
      }
      var end = Date.now();
      console.log('complex read acl parser: ', 1000 / (end - start), 'ops per second');

    });
    it('complex update command parsing', function(){
      var start = Date.now();
      for(var i = 1000; i > 0; i--){
        var cmd = {
          $set: {
            path: 'new value'
          },
          $push: {
            array: 'something'
          },
          $addToSet: {
            embedded: {
              array: 'something'
            }
          },
          $pull: {
            arrayOfDocs: {
              _$where_:{
                path: ''
              },
              _$do_: {
                array: 'item to pull'
              }
            }
          }
        };
        acl.validateUpdate(cmd, user, model);
      }

      var end = Date.now();
      console.log('complex update acl parser: ', 1000 / (end - start), 'ops per second');

    });
  });
});