var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var should = require('should');
var Factory = require('../lib/factory');
var Middleware = require('../lib/middleware');

describe('Plugin factory', function(){
  var factory;
  before(function(){
    factory = new Factory();
  });
  describe('configuration', function(){
    it('should create new Middleware and store it for later use', function(done){
      (factory._middleware).should.be.an.instanceof(Middleware);
      done();
    });
    it('should have a chainable proxy to middleware use method', function(done){
      (factory.use).should.be.a.Function;
      var firstRun, secondRun;
      function mOne(callback){
        firstRun = true;
        callback();
      }
      function mTwo(callback){
        secondRun = true;
        callback();
      }
      factory.use('read', mOne).use('read', mTwo);
      factory._middleware.run('read', {}, [], function(err){
        should.not.exist(err);
        firstRun.should.be.ok;
        secondRun.should.be.ok;
        done();
      });
    });
  });
  describe('implementation', function(){
    var testSchema;
    before(function(){
      factory = new Factory();
      testSchema = new Schema({
        path: {type: String}
      });
    });
    it('plugin property should represent pluggable function', function(done){
      factory.use('read', function(callback){
        callback(null);
      });
      testSchema.plugin(factory.plugin, {});
      done();
    });
  });
});
