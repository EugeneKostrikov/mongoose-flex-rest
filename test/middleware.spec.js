var should = require('should');
var Middleware = require('../lib/middleware');
var Factory = require('../lib/factory');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var schema = new Schema({
  path: {type: String}
});

describe('Middleware layer', function(){
  describe('plain middleware', function(){
    var mw;
    beforeEach(function(){
      mw = new Middleware();
      mw.use('read', function(){
        var callback = arguments[arguments.length - 1];
        callback();
      });
    });
    it('should directly modify objects passed in', function(done){
      var context = {
        property: 'initial'
      };
      var argument = {
        property: 'initial'
      };
      mw.use('read', function(arg){
        var callback = arguments[arguments.length - 1];
        this.property = 'changed';
        arg.property = 'changed';
        callback(null);
      });
      mw.run('read', context, [argument], function(err){
        should.not.exist(err);
        (context.property).should.equal('changed');
        (argument.property).should.equal('changed');
        done();
      });
    });
    it('should return immediately if a middleware returns an error', function(done){
      var secondMwRun = false;
      mw.use('read', function(callback){
        callback(new Error('Catch me if you can'));
      });
      mw.use('read', function(callback){
        setTimeout(function(){
          secondMwRun = true;
          callback();
        }, 0);
      });
      mw.run('read', {}, [], function(err){
        (err.message).should.equal('Catch me if you can');
        (secondMwRun).should.equal(false);
        done();
      });
    });
    it('should properly work with nested middleware', function(done){
      mw.use('all', function(query, change, context, callback){
        change.one = 1;
        callback();
      });
      mw.use('read', function(query, change, context, callback){
        change.two = 2;
        callback();
      });
      mw.use('create', function(query, change, context, callback){
        change.three = 3;
        callback();
      });
      var change = {};
      mw.run('all', {}, [{}, change, {}], function(err){
        should.not.exist(err);
        (change.one).should.equal(1);
        mw.run('read', {}, [{}, change, {}], function(err){
          should.not.exist(err);
          (change.one).should.equal(1);
          (change.two).should.equal(2);
          mw.run('create', {}, [{}, change, {}], function(err){
            should.not.exist(err);
            (change.one).should.equal(1);
            (change.two).should.equal(2);
            (change.three).should.equal(3);
            done();
          });
        });
      });
    });
  });
  describe('middleware in action', function(){
    var connection;
    beforeEach(function(done){
      connection = mongoose.createConnection('mongodb://localhost:27017/test', function(err){
        should.not.exist(err);
        done();
      });
    });
    describe('ALL middleware', function(){
      it('should have common interface', function(done){
        var plugin = new Factory();
        var called = false;
        plugin.use('all', function(query, change, custom, callback){
          this.should.be.instanceOf.model;
          query.should.be.an.Object;
          (query.find.path).should.equal('initial');
          change.should.be.an.Object;
          (change._$set.path).should.equal('changed');
          custom.should.be.an.Object;
          (custom.custom).should.equal('var');
          callback.should.be.a.Function;
          called = true;
          callback();
        });
        schema.plugin(plugin.plugin, {});
        var model = connection.model('test', schema);
        model.rest_update({find: {path: 'initial'}}, {_$set: {path: 'changed'}}, {custom: 'var'}, function(err){
          should.not.exist(err);
          called.should.be.ok;
          done();
        });
      });
    });
    describe('READ middleware', function(){
      it('be passed query and custom object', function(done){
        var plugin = new Factory();
        var called = false;
        plugin.use('read', function(query, change, custom, callback){
          this.should.be.instanceOf.model;
          should.not.exist(change);
          (query.find.path).should.equal('something');
          (custom.custom).should.equal('variable');
          callback.should.be.a.Function;
          called = true;
          callback();
        });
        schema.plugin(plugin.plugin, {});
        var model = connection.model('test', schema);
        model.rest_read({find:{path: 'something'}}, {custom: 'variable'}, function(err){
          should.not.exist(err);
          called.should.be.ok;
          done();
        });
      });
    });
    describe('CREATE middleware', function(){
      it('be passed data to create and custom object', function(done){
        var plugin = new Factory();
        var called = false;
        plugin.use('create', function(query, change, custom, callback){
          this.should.be.instanceOf.model;
          should.exist(query.acl);
          (change.path).should.equal('something');
          (custom.custom).should.equal('variable');
          callback.should.be.a.Function;
          called = true;
          callback();
        });
        schema.plugin(plugin.plugin, {});
        var model = connection.model('test', schema);
        model.rest_create({path: 'something'}, {}, {custom: 'variable'}, function(err){
          should.not.exist(err);
          called.should.be.ok;
          done();
        });
      });
    });
    describe('UPDATE middleware', function(){
      it('be passed query, change command and custom object', function(done){
        var plugin = new Factory();
        var called = false;
        plugin.use('update', function(query, change, custom, callback){
          this.should.be.instanceOf.model;
          query.should.be.an.Object;
          (query.find.path).should.equal('initial');
          change.should.be.an.Object;
          (change._$set.path).should.equal('changed');
          custom.should.be.an.Object;
          (custom.custom).should.equal('var');
          callback.should.be.a.Function;
          called = true;
          callback();
        });
        schema.plugin(plugin.plugin, {});
        var model = connection.model('test', schema);
        model.rest_update({find: {path: 'initial'}}, {_$set: {path: 'changed'}}, {custom: 'var'}, function(err){
          should.not.exist(err);
          called.should.be.ok;
          done();
        });
      });
    });
    describe('DELETE middleware', function(){
      it('be passed query and custom object', function(done){
        var plugin = new Factory();
        var called = false;
        plugin.use('delete', function(query, change, custom, callback){
          this.should.be.instanceOf.model;
          query.should.be.an.Object;
          (query.find.path).should.equal('initial');
          should.not.exist(change);
          custom.should.be.an.Object;
          (custom.custom).should.equal('var');
          callback.should.be.a.Function;
          called = true;
          callback();
        });
        schema.plugin(plugin.plugin, {});
        var model = connection.model('test', schema);
        model.rest_delete({find: {path: 'initial'}}, {custom: 'var'}, function(err){
          should.not.exist(err);
          called.should.be.ok;
          done();
        });
      });
    });
  });
});