var accessControl = require('../lib/acl');
var should = require('should');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var schema = new Schema({
  path: {type: String, acl:{read: 0, update: 2}},
  embedded:{
    path: {type: String, acl:{read: 0, update: 1}},
    array: [{type: String, acl:{read: 1, update: 1}}]
  },
  array: [{type: String, acl:{read: 0, update: 1}}],
  arrayOfDocs: [{
    path: {type: String, acl:{read: 1, update: 3}},
    array: {type: String, acl:{read: 0, update: 0}}
  }],
  partially_defined: {type: String, acl: {read: 1}},
  aclIsNotDefinedObject: {type: Schema.Types.Mixed},
  aclIsNotDefinedArray: [{type: String}],
  aclIsNotDefined: {type: String},
  child: {type: Schema.Types.ObjectId, ref: 'acl_child'} //TODO what to do with acl of this ref?
});

var child = new Schema({
  path: {type: String, acl: {read: 0, update: 0}},
  author: {type: String, acl: {read: 1, update: 1}},
  comment: {type: String, acl: {read: 2, update: 2}}
});
var model = mongoose.model('acl_model', schema);
var childModel = mongoose.model('acl_child', child);
accessControl.createRules(child, {create: 0, delete: 0, read: 0, update: 0});
accessControl.createRules(schema, {create: 1, delete: 1, read: 0, update: 2});

var acl = {
  read: 0,
  create: 0,
  update: 0,
  delete: 0
};


describe('Access control', function(){
  describe('consumption', function(){
    it('should properly validate read query', function(){
      //consumes rewritten query after query parser
      var q = {
        array: {
          $in: ['something'] //0
        },
        path: new RegExp('something', 'ig'), //0
        embedded:{
          path: 'another' //0
        },
        arrayOfDocs:{
          $elemMatch:{
            path: 'value' //1
          }
        }
      };
      acl.read = 0;
      (accessControl.validateRead(q, acl, model)).should.not.be.ok;
      acl.read = 1;
      (accessControl.validateRead(q, acl, model)).should.be.ok;
    });
    it('should pass 0-allowed queries', function(done){
      acl.read = 0;
      var q = {
        embedded: {
          path: 'something' //0
        },
        arrayOfDocs:{
          $elemMatch:{
            array: 'something' //0
          }
        }
      };
      (accessControl.validateRead(q, acl, model)).should.be.ok;
      done();
    });
    it('should work with $or/$and query', function(done){
      acl.read = 0;
      var q = {
        embedded: {
          path: 'something'
        },
        $or: [{
          path: {
            $exists: false
          }
        },{
          path: 'something'
        }],
        $and: [{
          path: {
            $exists: false
          }
        },{
          path: 'something'
        }]
      };
      (accessControl.validateRead(q,acl, model)).should.be.ok;
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
      acl.update = 0;
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
      (test.indexOf('path')).should.not.equal(-1);
      (test.indexOf('embedded.path')).should.not.equal(-1);
      (test.indexOf('arrayOfDocs.array')).should.not.equal(-1);
      (test.indexOf('array')).should.not.equal(-1);
      //has keys with no acl defined and defaulted to 0
      (test.indexOf('aclIsNotDefined')).should.not.equal(-1);
      (test.indexOf('aclIsNotDefinedObject')).should.not.equal(-1);
      (test.indexOf('aclIsNotDefinedArray')).should.not.equal(-1);
      (test.length).should.equal(8);
      acl.read = 1;
      select = accessControl.getAllowed(acl, model);
      test = select.split(' ');
      //Should have additional keys with acl.read === 1
      (test.indexOf('embedded.array')).should.not.equal(-1);
      (test.indexOf('arrayOfDocs.path')).should.not.equal(-1);
      (test.length).should.equal(11);
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
    it('should validate EVERY path in arrays of nested docs', function(done){
      acl.update = 0;
      acl.read = 1;
      var cmd = {
        _$push:{
          arrayOfDocs: [{
            path: 'something',
            array: ['i', 'am', 'not', 'empty']
            //Nesting here another collection of documents is not a great idea
          }]
        }
      };
      (accessControl.validateUpdate(cmd, acl, model)).should.not.be.ok;
      acl.update = 3;
      (accessControl.validateUpdate(cmd, acl, model)).should.be.ok;
      done();
    });
    it('should be able to $set nested array', function(done){
      var cmd = {
        _$set: {
          arrayOfDocs: [{
            _id: new mongoose.Types.ObjectId().toString(),
            path: 'something',
            array: ['another']
          }]
        }
      };
      acl.update = 0;
      (accessControl.validateUpdate(cmd, acl, model)).should.not.be.ok;
      acl.update = 3;
      (accessControl.validateUpdate(cmd, acl, model)).should.be.ok;
      done();
    });
    describe('population', function(){
      it('should validate explicitly defined populated paths', function(done){
        var populate = {
          path: 'child',
          select: 'path author comment'
        };
        acl.read = 1;
        accessControl.validatePop(populate, acl, model).should.not.be.ok;
        acl.read = 2;
        accessControl.validatePop(populate, acl, model).should.be.ok;
        done();
      });
      it('should ignore excluded paths', function(done){
        var populate = {
          path: 'child',
          select: 'path -comment'
        };
        acl.read = 0;
        accessControl.validatePop(populate, acl, model).should.be.ok;
        done();
      });
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
      (map.paths.$0.read.indexOf('path')).should.not.equal(-1);
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
    it('should fail to apply defaults if acl is defined partially', function(done){
      var map = accessControl.createRules(schema, {read: 1});
      (map.paths.$1.read.indexOf('partially_defined')).should.not.equal(-1);
      (map.paths.$1.update.indexOf('partially_defined')).should.equal(-1);
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