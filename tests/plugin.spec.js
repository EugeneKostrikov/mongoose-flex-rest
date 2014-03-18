var plugin = require('../lib/plugin');
var expect = require('chai').expect;
var should = require('should');
var async = require('async');

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var acl = {
  create: 0,
  read: 0,
  update: 1,
  delete: 0
};

describe('REST plugin', function(){
  describe('Plugin configs', function(){
    describe('Exclude methods', function(){
      var schema, control;
      before(function(){
        schema = new Schema({
          key: {type: String, acl: {read: 0, write: 0}},
          something: {type: String, acl: {read: 1, write: 1}},
          obj: {
            path: {type: String, acl: {read: 1, write: 1}}
          },
          arr: [{type: String, acl: {read: 1, write: 1}}]},
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
    var connection, schema, model;
    before(function(done){
      connection = mongoose.connect('mongodb://localhost:27017/test', function(err){
        should.not.exist(err);
        schema = new Schema({
          str: {type: String, acl: {read: 0, write: 0}},
          date: {type: Date, acl: {read: 0, write: 0}},
          num: {type: Number, acl: {read: 0, write: 0}},
          arr: [{type: Number, acl: {read: 0, write: 0}}],
          arrayOfStrings: [{type: String, acl: {read: 0, write: 0}}],
          obj: {
            one: {type: String, acl: {read: 0, write: 0}}
          },
          embedded: [{
            title: {type: String, acl: {read: 0, write: 0}},
            array: [{type: Number, acl: {read: 0, write: 0}}],
            num: {type: Number, acl: {read:0, write: 0}}
          }],
          ref: {type: Schema.Types.ObjectId, ref: 'model', acl: {read: 0, write: 0}}
        }, {collection: 'test_instances'});
        schema.plugin(plugin, {create: 0, delete: 0});
        model = connection.model('model', schema);
        done();
      });
    });
    describe('create', function(){
      it('has nothing to test', function(done){
        done();
      });
    });
    describe('read', function(){
      before(function(done){
        loadSomeData(done);
      });
      it('should return query if no callback passed', function(done){
        var promise = model.rest_read({}, {acl: acl});
        should.exist(promise.exec);
        done();
      });
      it('should execute when provided with a callback', function(done){
        model.rest_read({}, {acl: acl}, function(err, results){
          should.not.exist(err);
          should.exist(results);
          done();
        });
      });
      it('should work with simpliest query', function(done){
        var query = {
          str: 'one'
        };
        model.rest_read(query, {acl: acl}, function(err, docs){
          should.not.exist(err);
          docs.should.be.an.Array;
          (docs.length).should.equal(1);
          (docs[0].str).should.equal('one');
          done();
        });
      });
      describe('commands', function(){
        it('should have working $regex port', function(done){
          var q = {
            str: {
              _$regex: {
                val: 'e',
                options: 'i'
              }
            }
          };
          model.rest_read(q, {acl: acl}, function(err, docs){
            should.not.exist(err);
            (docs.length).should.equal(2);
            done();
          });
        });
        it('should work with dates', function(done){
          var q = {
            date: 1
          };
          model.rest_read(q, {acl: acl}, function(err, docs){
            should.not.exist(err);
            (docs.length).should.equal(1);
            done();
          });
        });
        it('should work with dates ranges', function(done){
          var q = {
            date: {
              _$dgte: 1,
              _$lte: 2
            }
          };
          model.rest_read(q, {acl: acl}, function(err, docs){
            should.not.exist(err);
            (docs.length).should.equal(2);
            done();
          });
        });
        it('should work with objects', function(done){
          var q = {
            obj: {
              one: 'one'
            }
          };
          model.rest_read(q, {acl: acl}, function(err, docs){
            should.not.exist(err);
            (docs[0].obj.one).should.equal('one');
            (docs.length).should.equal(1);
            done();
          });
        });
        it('should work with arrays', function(done){
          var q = {
            arr: {
              _$all: [1,2]
            }
          };
          model.rest_read(q, {acl: acl}, function(err, docs){
            should.not.exist(err);  
            (docs.length).should.equal(2);
            done();
          });
        });
        it('should have $size port', function(done){
          var q = {
            arr: {
              _$size: 3
            }
          };
          model.rest_read(q, {acl: acl}, function(err, docs){
            should.not.exist(err);
            (docs.length).should.equal(1);
            done();
          });
        });
        it('should have $elemMatch port', function(done){
          var q = {
            embedded: {
              _$elemMatch: {
                title: 'first'
              }
            }
          };
          model.rest_read(q, {acl: acl}, function(err, docs){
            should.not.exist(err);
            (docs.length).should.equal(1);
            done();
          });
        });
      });
      describe('configuration', function(){
        var doc;
        before(function(done){
          model.findOne({str: 'one'}, function(err, document){
            should.not.exist(err);
            (document.str).should.equal('one');
            doc = document;
            var newDoc = new model({
              str: 'referenced',
              ref: [doc._id]
            });
            newDoc.save(function(err){
              should.not.exist(err);
              done();
            });
          });
        });
        describe('population', function(){
          it('should be available with string notation', function(done){
            var q = {
              str: 'referenced'
            };
            var opts = {
              populate: 'ref',
              acl: acl
            };
            model.rest_read(q, opts, function(err, docs){
              should.not.exist(err);
              (docs[0].ref.str).should.equal('one');
              done();
            });
          });
          it('it should have object notation', function(done){
            var q = {
              str: 'referenced'
            };
            var opts = {
              acl: acl,
              populate: JSON.stringify({
                path: 'ref',
                select: 'num'
              }) //This is not parsed by express bodyparser
            };
            model.rest_read(q, opts, function(err, docs){
              should.not.exist(err);
              (docs[0].ref.num).should.equal(1);
              should.not.exist(docs[0].ref.str);
              done();
            });
          });
          it('should support array notation to populate multiple paths', function(done){
            var q = {
              str: 'referenced'
            };
            var opts = {
              acl: acl,
              populate: JSON.stringify([
                {path: 'ref', select: 'str'},
                {path: 'undefined'}
              ])
            };
            model.rest_read(q, opts, function(err, docs){
              should.not.exist(err);
              (docs[0].ref.str).should.equal('one');
              should.not.exist(docs[0].ref.num);
              done();
            });
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
          model.rest_update({}, cmd, {acl: acl}, function(err, upd){
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
          model.rest_update({}, cmd, {acl: acl}, function(err, upd){
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
          model.rest_update({}, cmd, {acl: acl}, function(err, upd){
            should.not.exist(err);
            (upd[0].num).should.equal(2);
            done();
          });
        });
/*
        it('$inc should work with arrays', function(done){
          var cmd = {
            _$inc:{
              arr:{
                _$index_: 0,
                _$do_: 2
              }
            }
          };
          model.rest_update({}, cmd, {acl: acl}, function(err, upd){
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
          model.rest_update({}, cmd, {acl: acl}, function(err, upd){
            should.not.exist(err);
            (upd[0].embedded[0].num).should.equal(3);
            done();
          });
        });
*/
      });
      describe('working with arrays', function(){
        it('should have working $push method', function(done){
          var q = {};
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
          model.rest_update(q, cmd, {acl: acl}, function(err, updated){
            should.not.exist(err);
            (updated[0].arr.length).should.equal(4);
            (updated[0].arr[2]).should.equal(3);
            (updated[0].embedded[0].array.length).should.equal(2);
            done();
          });
        });
        it('$push acts as $pushAll', function(done){
          var q = {};
          var cmd = {
            _$push: {
              arr: [2,3,4]
            }
          };
          model.rest_update(q, cmd, {acl: acl}, function(err, updated){
            should.not.exist(err);
            (updated[0].arr.length).should.equal(4);
            done();
          });
        });
        it('should have working $addToSet method', function(done){
          var q = {};
          var cmd = {
            _$addToSet:{
              arr: [1,2]
            }
          };
          model.rest_update(q, cmd, {acl: acl}, function(err, updated){
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
          model.rest_update({}, cmd, {acl:acl}, function(err, updated){
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
          model.rest_update({}, cmd, {acl: acl}, function(err, upd){
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
          model.rest_update({}, cmd, {acl: acl}, function(err, upd){
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
          model.rest_update({}, cmd, {acl: acl}, function(err, updated){
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
    after(function(){
      connection.connection.db.dropCollection('test_instances');
    });

  });
});
