var Middleware = require('./middleware');
var plugin = require('./plugin');

function Assembly(){
  //Store middleware to pass into the plugin and export for tests
  var middleware = new Middleware();
  this._middleware = middleware;

  this.use = function(setName, fn){
    middleware.use(setName, fn);
    return this;
  };

  this.plugin = function(Schema, config){
    plugin(Schema, config, middleware);
  };
}

module.exports = Assembly;
