var accessControl = require('../lib/acl');
var should = require('should');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var schema = new Schema({
  path: {type: String, acl:{read: 0, write: 2}},
  embedded:{
    path: {type: String, acl:{read: 0, write: 1}},
    array: [{type: String, acl:{read: 1, write: 1}}]
  },
  array: [{type: String, acl:{update: 3, delete: 4}}],
  arrayOfDocs: [{
    path: {type: String, acl:{create: 3, read: 1, update: 3, delete:3}},
    array: {type: String, acl:{read: 0, write: 0}}
  }],
  aclIsNotDefinedObject: {type: Schema.Types.Mixed},
  aclIsNotDefinedArray: [{type: String}],
  aclIsNotDefined: {type: String}
});
var model = mongoose.model('acl_model', schema);
accessControl.createRules(schema, {create: 1, delete: 1});

var acl = {
  read: 1,
  create: 2,
  update: 2,
  delete: 2
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
      (accessControl.validateRead(q, acl, model)).should.not.be.ok;
      acl.read = 10;
      (accessControl.validateRead(q, acl, model)).should.be.ok;
    });
    it('should pass 0-allowed queries', function(done){
      var q = {
        embedded: {
          path: 'something'
        },
        arrayOfDocs:{
          _$elemMatch:{
            array: 'something'
          }
        }
      };
      (accessControl.validateRead(q, acl, model)).should.be.ok;
      done();
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
      (accessControl.validateUpdate(cmd, acl, model)).should.not.be.ok;
      acl.update = 10;
      (accessControl.validateUpdate(cmd, acl, model)).should.be.ok;
    });
    it('should properly validate selected values', function(){
      //consumes options.select value + populate.select values
      //May be implement via middleware? pre/post init.
      var select = 'path embedded.path embedded.array';
      acl.read = 0;
      (accessControl.validateSelect(select, acl, model)).should.not.be.ok;
      acl.read = 1;
      (accessControl.validateSelect(select, acl, model)).should.be.ok;
    });
    it('should return allowed path', function(done){
      acl.read = 0;
      var select = accessControl.getAllowed(acl, model);
      var test = select.split(' ');
      //has keys with explicitly defined 0 on read
      (test[0]).should.equal('path');
      (test[1]).should.equal('embedded.path');
      (test[2]).should.equal('arrayOfDocs.array');
      //has keys with no acl defined and defaulted to 0
      (test.indexOf('aclIsNotDefined')).should.not.equal(-1);
      (test.indexOf('aclIsNotDefinedObject')).should.not.equal(-1);
      (test.indexOf('aclIsNotDefinedArray')).should.not.equal(-1);
      (test.length).should.equal(6);
      acl.read = 1;
      select = accessControl.getAllowed(acl, model);
      test = select.split(' ');
      //Should have additional keys with acl.read === 1
      (test.indexOf('embedded.array')).should.not.equal(-1);
      (test.indexOf('arrayOfDocs.path')).should.not.equal(-1);
      (test.length).should.equal(8);
      done();
    });
    it('should not change initial query', function(done){
      var objectId = mongoose.Types.ObjectId();
      var q = {
        _id: objectId,
        embedded:{
          path: 'value'
        },
        arrayOfDocs: [{
          path: 'value',
          _id: objectId
        }],
        array:{
          $in: 'something'
        }
      };
      accessControl.validateRead(q, acl, model);
      (q._id).should.equal(objectId);
      (q.embedded.path).should.equal('value');
      (q.arrayOfDocs[0].path).should.equal('value');
      (q.arrayOfDocs[0]._id).should.equal(objectId);
      (q.array.$in).should.equal('something');
      done();
    });
    it('should work with ObjectIds', function(done){
      var q = {
        _id: mongoose.Types.ObjectId()
      };
      (accessControl.validateRead(q, acl, model)).should.be.ok;
      done();
    });
  });
  describe('indexing', function(){
    it('should generate proper map', function(done){
      var map = accessControl.createRules(schema, {create: 1, delete: 1});
      (map.paths.$1.read).should.be.an.Array;
      (map.paths.$0.read.indexOf('path')).should.not.equal(-1);
      (map.paths.$1.read.indexOf('embedded.array')).should.not.equal(-1);
      done();
    });
    it('should apply defaults', function(done){
      var map = accessControl.createRules(schema, {create: 1, delete: 1, update: 1, read: 1});
      (map.paths.$1.read.indexOf('aclIsNotDefined')).should.not.equal(-1);
      (map.paths.$1.read.indexOf('aclIsNotDefinedObject')).should.not.equal(-1);
      (map.paths.$1.read.indexOf('aclIsNotDefinedArray')).should.not.equal(-1);
      done();
    });
    it('if no acl specified neither in schema nor in plugin config acl is 0', function(done){
      var map = accessControl.createRules(schema, {create: 1, delete: 1});
      should.not.exist(map.paths.$undefined);
      (map.paths.$0.read.indexOf('aclIsNotDefined')).should.not.equal(-1);
      (map.paths.$0.read.indexOf('aclIsNotDefinedObject')).should.not.equal(-1);
      (map.paths.$0.read.indexOf('aclIsNotDefinedArray')).should.not.equal(-1);
      done();
    });
    it('should generate string with all possible paths', function(done){
      var map = accessControl.createRules(schema, {create: 1, delete: 1});
      (map.all).should.be.an.Array;
      (map.all.indexOf('path')).should.not.equal(-1);
      (map.all.indexOf('embedded.path')).should.not.equal(-1);
      (map.all.indexOf('arrayOfDocs.path')).should.not.equal(-1);
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
        accessControl.validateRead(q, acl, model);
      }
      var end = Date.now();
      console.log('complex read acl parser: ', (1000 / (end - start)) * 1000, 'ops per second\n');

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
        accessControl.validateUpdate(cmd, acl, model);
      }

      var end = Date.now();
      console.log('complex update acl parser: ', (1000 / (end - start)) * 1000, 'ops per second\n');

    });
  });
});