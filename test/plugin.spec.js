var plugin = require('../lib/plugin');
var should = require('should');
var async = require('async');

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var acl = {
  create: 0,
  read: 0,
  update: 1,
  delete: 1
};

describe('REST plugin', function(){
  var connection;
  before(function(done){
    connection = mongoose.connect('mongodb://localhost:27017/test', function(err){
      should.not.exist(err);
      done();
    });
  });
  describe('Plugin configs', function(){
    describe('Exclude methods', function(){
      var schema, control;
      before(function(){
        schema = new Schema({
          key: {type: String, acl: {read: 0, update: 0}},
          something: {type: String, acl: {read: 1, update: 1}},
          obj: {
            path: {type: String, acl: {read: 1, update: 1}}
          },
          arr: [{type: String, acl: {read: 1, update: 1}}]},
          {collection: 'test_instances'}
        );
        schema.plugin(plugin, {exclude: ['create', 'read']});
        control = new Schema({key: String}, {collection: 'test'});
        control.plugin(plugin, {});
      });
      it('should not have excluded methods', function(done){
        should.not.exist(schema.statics.rest_create);
        should.not.exist(schema.statics.rest_read);
        should.exist(schema.statics.rest_update);
        should.exist(schema.statics.rest_head);
        should.exist(schema.statics.rest_delete);
        done();
      });
      it('should not overwrite global settings', function(){
        should.exist(control.statics.rest_create);
      });
    });
  });
  describe('plugin methods', function(){
    var schema, model;
    before(function(done){
      schema = new Schema({
        str: {type: String, acl: {read: 0, update: 0}},
        date: {type: Date, acl: {read: 0, update: 0}},
        num: {type: Number, acl: {read: 0, update: 0}},
        arr: [{type: Number, acl: {read: 0, update: 0}}],
        arrayOfStrings: [{type: String, acl: {read: 0, update: 0}}],
        obj: {
          one: {type: String, acl: {read: 0, update: 0}}
        },
        embedded: [{
          title: {type: String, acl: {read: 0, update: 0}},
          array: [{type: Number, acl: {read: 0, update: 0}}],
          num: {type: Number, acl: {read:0, update: 0}}
        }],
        ref: {type: Schema.Types.ObjectId, ref: 'model', acl: {read: 0, update: 0}}
      }, {collection: 'test_instances'});
      schema.plugin(plugin, {acl: {create: 1, delete: 1}});
      model = connection.model('model', schema);
      done();
    });
    describe('create', function(){
      it('should be able to create documents', function(done){
        model.rest_create({str: 'string'}, {create: 1}, [], function(err, doc){
          should.not.exist(err);
          should.exist(doc);
          done();
        });
      });
      it('should set access level to zero when it is not specified', function(done){
        model.rest_create({str: 'string'}, null, [], function(err, doc){
          (err.message).should.equal('Access denied: create');
          should.not.exist(doc);
          done();
        });
      });
      it('should validate provided accessLevel', function(done){
        model.rest_create({str: 'string'}, {create: 0}, [], function(err, doc){
          (err.message).should.equal('Access denied: create');
          should.not.exist(doc);
          done();
        });
      });
    });
    describe('read', function(){
      before(function(done){
        loadSomeData(done);
      });
      it('should require to pass a callback', function(done){
        (function(){
          model.rest_read({});
        }).should.throw('Callback required');
        done();
      });
      it('should execute when provided with a callback', function(done){
        model.rest_read({acl: acl}, [], function(err, results){
          should.not.exist(err);
          should.exist(results);
          done();
        });
      });
      it('should work with simpliest query', function(done){
        var query= {};
        query.find = {
          str: 'one'
        };
        query.acl = acl;
        model.rest_read(query, [], function(err, docs){
          should.not.exist(err);
          docs.should.be.an.Array;
          (docs.length).should.equal(1);
          (docs[0].str).should.equal('one');
          done();
        });
      });
      it('should return _ids for nested documents', function(done){
        var query = {
          find: {
            str: 'one'
          },
          acl: acl
        };
        model.rest_read(query, [], function(err, docs){
          should.not.exist(err);
          should.exist(docs[0].embedded[0]._id);
          done();
        });
      });

      describe('commands', function(){
        it('should have working $regex port', function(done){
          var q = {};
          q.find = {
            str: {
              _$regex: {
                val: 'e',
                options: 'i'
              }
            }
          };
          q.acl = {read: 0};
          model.rest_read(q, [], function(err, docs){
            should.not.exist(err);
            (docs.length).should.equal(2);
            done();
          });
        });
        it('should work with dates', function(done){
          var q = {};
          q.find = {
            date: 1
          };
          q.acl = {read: 0};
          model.rest_read(q, [], function(err, docs){
            should.not.exist(err);
            (docs.length).should.equal(1);
            done();
          });
        });
        it('should work with dates ranges', function(done){
          var q = {};
          q.find = {
            date: {
              _$dgte: 1,
              _$lte: 2
            }
          };
          q.acl = acl;
          model.rest_read(q, [], function(err, docs){
            should.not.exist(err);
            (docs.length).should.equal(2);
            done();
          });
        });
        it('should work with objects', function(done){
          var q = {};
          q.find = {
            obj: {
              one: 'one'
            }
          };
          q.acl = acl;
          model.rest_read(q, [], function(err, docs){
            should.not.exist(err);
            (docs[0].obj.one).should.equal('one');
            (docs.length).should.equal(1);
            done();
          });
        });
        it('should work with arrays', function(done){
          var q = {};
          q.find = {
            arr: {
              _$all: [1,2]
            }
          };
          q.acl = acl;
          model.rest_read(q, [], function(err, docs){
            should.not.exist(err);  
            (docs.length).should.equal(2);
            done();
          });
        });
        it('should have $size port', function(done){
          var q = {};
          q.find = {
            arr: {
              _$size: 3
            }
          };
          q.acl = acl;
          model.rest_read(q, [], function(err, docs){
            should.not.exist(err);
            (docs.length).should.equal(1);
            done();
          });
        });
        it('should have $elemMatch port', function(done){
          var q = {};
          q.find = {
            embedded: {
              _$elemMatch: {
                title: 'first'
              }
            }
          };
          q.acl = acl;
          model.rest_read(q, [], function(err, docs){
            should.not.exist(err);
            (docs.length).should.equal(1);
            done();
          });
        });
        it('should work with $regex nested to $elemMatch', function(done){
          var q = {};
          q.find = {
            embedded: {
              _$elemMatch:{
                title: {
                  _$regex: {
                    val: 'fir',
                    options: 'i'
                  }
                }
              }
            }
          };
          q.acl = acl;
          model.rest_read(q, [], function(err, docs){
            should.not.exist(err);
            (docs.length).should.equal(1);
            done();
          });
        });
      });
      after(function(){
        connection.connection.db.dropCollection('test_instances');
      });
      //helpers
      function loadSomeData(done){
        var docs = [];
        docs[0] = new model({
          str: 'one',
          date: new Date(1),
          num: 1,
          arr: [1],
          obj: {
            one: 'one'
          },
          embedded: [
            {title: 'first', array: [1]}
          ]
        });
        docs[1] = new model({
          str: 'two',
          date: new Date(2),
          num: 2,
          arr: [1,2],
          obj:{
            two: 'two'
          },
          embedded: [
            {title: 'second', array: [2,2]}
          ]
        });
        docs[2] = new model({
          str: 'three',
          date: new Date(3),
          num: 3,
          arr: [1,2,3],
          obj: {
            three: 'three'
          },
          embedded: [
            {title: 'third', array: [3,3,3]}
          ]
        });
        async.each(docs, function(doc, cb){
          doc.save(function(err){
            should.not.exist(err);
            cb();
          })
        }, function(){
          done();
        });
      }
    });
    describe('update', function(){
      beforeEach(function(done){
        var sampleDoc = new model({
          str: 'one',
          date: new Date(1),
          num: 1,
          arr: [1],
          arrayOfStrings: ['one', 'two', 'three'],
          obj: {
            one: 'one'
          },
          embedded: [
            {title: 'first', array: [1], num: 0}
          ]
        });
        sampleDoc.save(function(err){
          should.not.exist(err);
          done();
        });
      });
      describe('general methods', function(){
        it('should have working $set method', function(done){
          var cmd = {
            _$set: {
              str: 'changed',
              arrayOfStrings: ['erased']
            }
          };
          model.rest_update({acl: acl}, cmd, [], function(err, upd){
            should.not.exist(err);
            (upd.length).should.equal(1);
            (upd[0].str).should.equal('changed');
            (upd[0].arrayOfStrings.length).should.equal(1);
            (upd[0].arrayOfStrings[0]).should.equal('erased');
            //(upd[0].embedded[0].array[0]).should.equal(0);
            //(upd[0].embedded[0].array.length).should.equal(1);
            done();
          });
        });
        it('$set should work with embedded documents', function(done){
          var cmd = {
            _$set:{
              embedded: {
                _$where_: {
                  title: 'first'
                },
                _$do_: {
                  array: [0]
                }
              }
            }
          };
          model.rest_update({acl: acl}, cmd, [], function(err, upd){
            should.not.exist(err);
            (upd[0].embedded[0].array[0]).should.equal(0);
            (upd[0].embedded[0].array.length).should.equal(1);
            done();
          });
        });
      });
      describe('working with numbers', function(){
        it('should have $inc working', function(done){
          var cmd = {
            _$inc: {
              num: 1
            }
          };
          model.rest_update({acl: acl}, cmd, [], function(err, upd){
            should.not.exist(err);
            (upd[0].num).should.equal(2);
            done();
          });
        });

        it('$inc should work with arrays', function(done){
          var cmd = {
            _$inc:{
              arr:{
                _$index_: 0,
                _$do_: 2
              }
            }
          };
          model.rest_update({acl: acl}, cmd, [], function(err, upd){
            should.not.exist(err);
            (upd[0].arr[0]).should.equal(3);
            done();
          });
        });
        it('$inc should work with arrays of documents', function(done){
          var cmd = {
            _$inc:{
              embedded:{
                _$where_:{
                  title: 'first'
                },
                _$do_:{
                  num: 3
                }
              }
            }
          };
          model.rest_update({acl: acl}, cmd, [], function(err, upd){
            should.not.exist(err);
            (upd[0].embedded[0].num).should.equal(3);
            done();
          });
        });

      });
      describe('working with arrays', function(){
        it('should have working $push method', function(done){
          var q = {
            acl: acl
          };
          var cmd = {
            _$push: {
              arr: [2,3,4],
              embedded:{
                _$where_:{
                  title: 'first'
                },
                _$do_: {
                  array: [2]
                }
              }
            }
          };
          model.rest_update(q, cmd, [], function(err, updated){
            should.not.exist(err);
            (updated[0].arr.length).should.equal(4);
            (updated[0].arr[2]).should.equal(3);
            (updated[0].embedded[0].array.length).should.equal(2);
            done();
          });
        });
        it('$push acts as $pushAll', function(done){
          var q = {
            acl: acl
          };
          var cmd = {
            _$push: {
              arr: [2,3,4]
            }
          };
          model.rest_update(q, cmd, [], function(err, updated){
            should.not.exist(err);
            (updated[0].arr.length).should.equal(4);
            done();
          });
        });
        it('$pull and $push should be able to work together', function(done){
          var q = {
            acl: acl
          };
          var cmd = {
            _$pull: {
              arr: [1,2,3,4]
            },
            _$push: {
              arr: [5,6,7,8]
            }
          };
          model.rest_update(q, cmd, [], function(err, updated){
            should.not.exist(err);
            (updated[0].arr.length).should.equal(4);
            (updated[0].arr[0]).should.equal(5);
            done();
          });
        });
        it('should have working $addToSet method', function(done){
          var q = {
            acl: acl
          };
          var cmd = {
            _$addToSet:{
              arr: [1,2]
            }
          };
          model.rest_update(q, cmd, [], function(err, updated){
            should.not.exist(err);
            (updated[0].arr.length).should.equal(2);
            done();
          });
        });
        it('_$addToSet should work with embedded documents', function(done){
          var cmd = {
            _$addToSet:{
              embedded:{
                _$where_:{
                  title: 'first'
                },
                _$do_:{
                  array: [1,2]
                }
              }
            }
          };
          model.rest_update({acl: acl}, cmd, [], function(err, updated){
            should.not.exist(err);
            (updated[0].embedded[0].array.length).should.equal(2);
            done();
          });
        });
        it('should have working $pull method', function(done){
          var cmd = {
            _$pull:{
              arr: [1]
            }
          };
          model.rest_update({acl: acl}, cmd, [], function(err, upd){
            should.not.exist(err);
            (upd[0].arr.length).should.equal(0);
            done();
          });
        });
        it('$pullAll method using array syntax', function(done){
          var cmd = {
            _$pull:{
              arrayOfStrings: ['one', 'two']
            }
          };
          model.rest_update({acl: acl}, cmd, [], function(err, upd){
            should.not.exist(err);
            (upd[0].arrayOfStrings.length).should.equal(1);
            (upd[0].arrayOfStrings[0]).should.equal('three');
            done();
          });
        });
        it('bugfix prove: string is pushed once', function(done){
          var cmd = {
            _$push:{
              arrayOfStrings: ['string']
            }
          };
          model.rest_update({acl: acl}, cmd, [], function(err, updated){
            should.not.exist(err);
            (updated[0].arrayOfStrings.length).should.equal(4);
            (updated[0].arrayOfStrings[3]).should.equal('string');
            done();
          });
        });
      });
      afterEach(function(){
        connection.connection.db.dropCollection('test_instances');
      });
    });
    describe('delete', function(){
      beforeEach(function(done){
        var doc = new model({
          str: 'some string'
        });
        doc.save(function(err){
          should.not.exist(err);
          done();
        });
      });
      it('should deny access if user has not enough acl power', function(done){
        model.findOne({}, function(err, doc){
          should.not.exist(err);
          model.rest_delete({_id: doc._id.toString()}, function(err){
            (err.message).should.equal('Access denied: delete');
            done();
          });
        });
      });
      it('should have working delete method', function(done){
        model.findOne({}, function(err, doc){
          should.not.exist(err);
          var query = {
            _id: doc._id.toString(),
            acl: {read: 2, delete: 10}
          };
          model.rest_delete(query, function(err){
            should.not.exist(err);
            done();
          });
        });
      });
      it('should be able to delete documents by query', function(done){
        var query = {
          find: {str: 'some string'},
          acl: {read: 2, delete: 10}
        };
        model.rest_delete(query, function(err){
          should.not.exist(err);
          done();
        });
      });
    });
    after(function(){
      connection.connection.db.dropCollection('test_instances');
    });

  });
  describe('population', function(){
    var parentSchema, parentModel, childSchema, childModel;
    before(function(done){
      parentSchema = new Schema({
        title: {type: String},
        child: {type: Schema.Types.ObjectId, ref: 'childModel'}
      }, {collection: 'parentInstances'});
      parentSchema.plugin(plugin, {acl: {create: 1, read: 1, update: 1, delete: 1}});
      parentModel = connection.model('parentModel', parentSchema);

      childSchema = new Schema({
        author: {type: String, acl: {read: 1, update: 1}},
        post: {type: String, acl: {read: 2, update: 2}}
      }, {collection: 'childInstances'});
      childSchema.plugin(plugin, {acl: {create: 1, read: 1, update: 1, delete: 1}});
      childModel = connection.model('childModel', childSchema);
      done();
    });
    beforeEach(function(done){
      var child = new childModel({author: 'test', post: 'test'});
      child.save(function(err, doc){
        should.not.exist(err);
        var parent = new parentModel({title: 'test', child: doc._id});
        parent.save(function(err){
          should.not.exist(err);
          done();
        });
      });
    });
    it('should populate by path', function(done){
      var query = {
        find: {},
        populate: 'child',
        acl: {read: 2}
      };
      parentModel.rest_read(query, [], function(err, docs){
        should.not.exist(err);
        (docs.length).should.equal(1);
        (docs[0].child.author).should.equal('test');
        done();
      });
    });
    it('should be able to select populated paths', function(done){
      var query = {
        populate: {
          path: 'child',
          select: 'author'
        },
        acl: {read: 1}
      };
      parentModel.rest_read(query, [], function(err, docs){
        should.not.exist(err);
        (docs[0].child.author).should.equal('test');
        should.not.exist(docs[0].child.post);
        done();
      });
    });
    it('should be able to exclude fields from populated object', function(done){
      var query = {
        populate: {
          path: 'child',
          select: '-post'
        },
        acl: {read: 1}
      };
      parentModel.rest_read(query, [], function(err, docs){
        should.not.exist(err);
        (docs[0].child.author).should.equal('test');
        should.not.exist(docs[0].child.post);
        done();
      })
    });
    it('should fail to query if populated path validation fails', function(done){
      var query = {
        populate: {
          path: 'child',
          select: 'author post'
        },
        acl: {read: 1}
      };
      parentModel.rest_read(query, [], function(err){
        should.exist(err);
        done();
      });
    });
    it('should return allowed fields if populate.select is not defined', function(done){
      var query = {
        populate: 'child',
        acl: {read: 1}
      };
      parentModel.rest_read(query, [], function(err, docs){
        should.not.exist(err);
        should.exist(docs[0].child.author);
        should.not.exist(docs[0].child.post);
        done();
      });
    });
    afterEach(function(){
      connection.connection.db.dropCollection('parentInstances');
      connection.connection.db.dropCollection('childInstances');
    });
  });
  describe("access control", function(){
    var schema, model;
    before(function(done){
      schema = new Schema({
        title: {type: String, acl: {read: 0, update: 1}},
        post: {type: String, acl: {read: 1, update: 1}},
        tags: {type: Array, acl: {read: 4, update: 1}}
      }, {collection: 'aclTestModels'});
      schema.plugin(plugin, {acl: {create: 1, read: 1, update: 1, delete: 1}});
      model = connection.model('aclModel', schema);
      var doc = new model({
        title: 'test',
        post: 'test',
        tags: ['test']
      });
      doc.save(function(err){
        done(err);
      });
    });
    it('read query should return allowed paths when no select query specified', function(done){
      var q = {
        title: 'test'
      };
      model.rest_read(q, null, function(err, docs){
        should.not.exist(err);
        docs.should.be.an.Array;
        should.not.exist(docs[0].post);
        should.not.exist(docs[0].tags);
        done();
      });
    });
    after(function(){
      connection.connection.db.dropCollection('aclTestModels');
    });
  });
});
