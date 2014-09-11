var _ = require('underscore');
var should = require('should');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var Parser = require('../lib/parsers');
var parsers = new Parser();

describe('Module parsers', function(){
  describe('Parser class', function(){
    var parser;
    beforeEach(function(done){
      parser = new Parser();
      done();
    });
    it('should count $regex queries', function(done){
      var q = {
        path: {
          $regex: {
            val: 'something',
            options: 'i'
          }
        }
      };
      var parsed = parser.query(q);
      (parser.difficulty.$regex).should.equal(1);
      done();
    });
    it('should count logical (and, or, not, nor) queries', function(done){
      var q = {
        $or: [
          {path: 'value'},
          {path: 'another value'},
          {$and: [
            {hello: 'world'},
            {hola: 'mundo'}
          ]}
        ]
      };
      var parsed = parser.query(q);
      (parser.difficulty.logical).should.equal(5);
      done();
    });
    it('should count comparison operators', function(done){
      var q = {
        path: {$gte: 10},
        another: {$ne: 'value'}
      };
      var parsed = parser.query(q);
      (parser.difficulty.comparison).should.equal(2);
      done();
    });
  });
  describe('read query parser', function(){
    var sampleQuery = {};
    beforeEach(function(){
      sampleQuery = {
        title: {
          $regex: {
            val: 'Str',
            options: 'igm'
          }
        },
        embedded:{
          array: {
            $in: ["array", "of", "items"]
          }
        },
        array:{
          id: mongoose.Types.ObjectId()
        },
        score: {
          $gt: 3,
          $lte: 10
        },
        date: {
          $dgte: '03-05-2014',
          $dlt: '05-09-2014'
        }
      };
    });
    it('should have valid query for mongoose when rewritten', function(){
      var q = parsers.query(sampleQuery);
      (q.title.$regex).should.be.an.instanceof(RegExp);
      q = parsers.query(sampleQuery);
      (q.date).should.be.an.Object;
      (q.date.$gte).should.be.an.instanceof(Date);
      (q.date.$lt).should.be.an.instanceof(Date);
    });
    it('should properly rewrite complex queries', function(done){
      var query = {
        $or: [{
          field: {
            $exists: false
          }
        },{
          path: {
            $size: 10
          }
        }]
      };
      var parsed = parsers.query(query);
      should.exist(parsed.$or[0].field.$exists);
      (parsed.$or[0].field.$exists).should.equal(false);
      should.exist(parsed.$or[1].path.$size);
      (parsed.$or[1].path.$size).should.equal(10);
      done();
    });
    it('should properly rewrite $regex nested to $elemMatch', function(done){
      var query = {
        array: {
          $elemMatch: {
            path: {
              $regex:{
                val: 'some',
                options: 'i'
              }
            }
          }
        }
      };
      var parsed = parsers.query(query);
      should.exist(parsed.array.$elemMatch.path);
      (parsed.array.$elemMatch.path.$regex).should.be.an.instanceof(RegExp);
      done();
    });
    it('should drop off $where queries', function(){
      var query = {
        array: {
          $where: {
            path: {
              $regex:{
                val: 'some',
                options: 'i'
              }
            }
          }
        },
        field: {
          $or: [{
            $where: 'string',
            valid: true,
            $and: [{
              $where: function(){},
              valid: true
            }]
          }],
        }
      };
      var parsed = parsers.query(query);
      should.not.exist(parsed.array.$where);
      should.not.exist(parsed.field.$or[0].$where);
      should.not.exist(parsed.field.$or[0].$and[0].$where);
      should.exist(parsed.field.$or[0].valid);
      should.exist(parsed.field.$or[0].$and[0].valid);
    });
  });
  describe('update command parser', function(){
    var doc, Model;
    before(function(){
      var schema = new Schema({
        title: {type: String},
        date: {type: Date},
        embedded: {
          title: {type: String},
          array: [{type: String}],
          number: {type: Number}
        },
        array: [{
          type: {type: String},
          of: {type: String},
          array: [{type: String}]
        }],
        arrayOfValues: [{type: String}],
        score: {type: Number},
        num: {type: Number}
      });
      Model = mongoose.model('test', schema);
    });
    beforeEach(function(){
      doc = new Model({
        title: 'Hello',
        date: new Date(Date.now()),
        embedded:{
          title: 'Hi!',
          array: ['one', 'two', 'three'],
          number: 0
        },
        array: [
          {type: 'nested', of: 'document', array: ['one']},
          {type: 'another', of: 'document', array: []}
        ],
        score: 0,
        num: 15
      });
    });
    describe('$set', function(){
      it('should update multiple paths when specified as top-level key' +
        ' and value is an object leaving _id and __v untouched', function(){
        var cmd = {
          $set: {
            _id: 'i should exist to overwrite',
            title: 'I\'ve been flushed :(',
            score: 100
          }
        };
        parsers.update(doc, cmd);
        (doc.title).should.equal('I\'ve been flushed :(');
        (doc.score).should.equal(100);
        (doc.embedded.title).should.equal('Hi!');
      });
      it('should work correctly with embedded objects', function(){
        var cmd = {
          $set:{
            embedded: {
              title: 'Hola!',
              array: ['i', 'am', 'not', 'empty']
            }
          }
        };
        parsers.update(doc, cmd);
        //Assert update
        (doc.embedded).should.be.an.Object;
        (doc.embedded.title).should.equal('Hola!');
        (doc.embedded.array).should.be.an.Array;
        (doc.embedded.array.length).should.equal(4);
        //And atomicity
        (doc.title).should.equal('Hello');
        (doc.embedded.number).should.equal(0);
      });
    });
    describe('$inc', function(){
      it('should work :) on any level', function(){
        var cmd = {
          $inc: {
            score: 10,
            embedded: {
              number: 1
            },
            num: 5
          }
        };
        parsers.update(doc, cmd);
        (doc.score).should.equal(10);
        (doc.embedded.number).should.equal(1);
        (doc.num).should.equal(20);
      })
    });
    describe('$push - should properly pushed to', function(){
      it('top-level array of values', function(){
        var cmd = {
          $push: {
            arrayOfValues: ['push', 'all']
          }
        };
        parsers.update(doc, cmd);
        (doc.arrayOfValues.length).should.equal(2);
        (doc.arrayOfValues[0]).should.equal('push');
        (doc.arrayOfValues[1]).should.equal('all');
      });
      it('top-level array of documents', function(){
        var cmd = {
          $push: {
            array:[{
              type: 'pushed', of: 'something'
            }]
          }
        };
        parsers.update(doc, cmd);
        (doc.array.length).should.equal(3);
        (doc.array[2].type).should.equal('pushed');
      });
      it('an array nested to embedded document', function(){
        var cmd = {
          $push: {
            embedded:{
              array: ['four']
            }
          }
        };
        parsers.update(doc, cmd);
        (doc.embedded.array.length).should.equal(4);
        (doc.embedded.array[3]).should.equal('four');
      });
      it('an array inside of array of documents', function(){
        var cmd = {
          $push: {
            array:{
              _$where_: {
                type: 'nested'
              },
              _$do_:{
                array: ['item', 'two']
              }
            }
          }
        };
        parsers.update(doc, cmd);
        (doc.array[0].type).should.equal('nested');
        (doc.array[0].array.length).should.equal(3);
        (doc.array[0].array[1]).should.equal('item');
        (doc.array[0].array[2]).should.equal('two');
      });
    });
    describe('$pull', function(){
      it('should work with plain array regardless how deep it is nested', function(){
        var cmd = {
          $pull:{
            embedded:{
              array: ['one']
            },
            array:{
              _$where_:{
                type: 'nested'
              },
              _$do_:{
                array: ['one']
              }
            }
          }
        };
        parsers.update(doc, cmd);
        (doc.embedded.array.length).should.equal(2);
        (doc.embedded.array.indexOf('one')).should.equal(-1);
        (doc.array[0].array.length).should.equal(0)
      });
      it('should work properly with array of objects regardless how deep it is nested', function(){
        var cmd = {
          $pull:{
            array:{
              _$where_:{
                type: 'another'
              }
            }
          }
        };
        parsers.update(doc, cmd);
        (doc.array.length).should.equal(1);
      });
    });
    describe('$addToSet', function(){
      it('should work with plain arrays', function(){
        var cmd = {
          $addToSet:{
            embedded: {
              array: ['one', 'two', 'three', 'four']
            },
            array:{
              _$where_: {
                type: 'nested'
              },
              _$do_:{
                array: ['one', 'two']
              }
            }
          }
        };
        parsers.update(doc, cmd);
        (doc.embedded.array.length).should.equal(4);
        (doc.array[0].array.length).should.equal(2);
      });
      it('should work with array of documents only when proper _id is provided', function(){
        var cmd = {
          $addToSet:{
            array:[
              {type: 'nested', of: 'document', array: ['one']}
            ]
          }
        };
        parsers.update(doc, cmd);
        //Assert doc has been pushed
        (doc.array.length).should.equal(3);
        cmd = {
          $addToSet: {
            array:[
              doc.array[0]
            ]
          }
        };
        parsers.update(doc, cmd);
        //Assert doc has not been pushed
        (doc.array.length).should.equal(3);
      });
    });
  });
  describe('populate query parser', function(){
    it('should consume string query', function(done){
      var populate = 'child';
      var parsed = parsers.populate(populate);
      parsed.should.be.an.Array;
      (parsed[0].path).should.equal('child');
      done();
    });
    it('should consume objects', function(done){
      var populate = {
        path: 'child',
        select: 'something'
      };
      var parsed = parsers.populate(populate);
      parsed.should.be.an.Array;
      (parsed[0].path).should.equal('child');
      (parsed[0].select).should.equal('something');
      done();
    });
    it('should consume arrays of objects', function(done){
      var populate = [{
        path: 'child',
        select: 'something'
      }, {
        path: 'another',
        select: 'something'
      }];
      var parsed = parsers.populate(populate);
      parsed.should.be.an.Array;
      (parsed[0].path).should.equal('child');
      (parsed[1].path).should.equal('another');
      done();
    });
    it('should return empty array if populate is undefined', function(done){
      var parsed = parsers.populate();
      parsed.should.be.an.Array;
      (parsed.length).should.equal(0);
      done();
    });
  });
  describe('performance', function(){
    describe('read ops', function(){
      var sampleQuery = {};
      beforeEach(function(){
        sampleQuery = {
          title: {
            $regex: {
              val: 'Str',
              options: 'igm'
            }
          },
          embedded:{
            array: {
              $in: ["array", "of", "items"]
            }
          },
          array:{
            _id: 'SomeObjectId'
          },
          score: {
            $gt: 3,
            $lte: 10
          },
          date: {
            $dgte: '03-05-2014',
            $dlt: '05-09-2014'
          }
        };
      });
      it('complex query', function(){
        var start = Date.now();
        for(var i = 10000; i >0; i--){
          parsers.query(sampleQuery);
        }
        var end = Date.now();
        console.log('complex read query parser: ', (10000 / (end - start)) * 1000, 'ops per second\n');
      });
      it('simple query', function(){
        var start = Date.now();
        for(var i = 10000; i >0; i--){
          parsers.query({_id: 1230});
        }
        var end = Date.now();
        console.log('simple read query parser: ',  (10000 / (end - start)) * 1000, 'ops per second\n');
      });
    });
  });
});
