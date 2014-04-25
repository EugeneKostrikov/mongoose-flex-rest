var should = require('should');
var Middleware = require('../lib/middleware');

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
  });
});