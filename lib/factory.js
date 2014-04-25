var Middleware = require('./middleware');
var plugin = require('./plugin');

function Assembly(){
  this._middleware = new Middleware();

  this.use = function(setName, fn){
    this._middleware.use(setName, fn);
    return this;
  };

  this.plugin = function(Schema, config){
    plugin(Schema, config, this._middleware);
  };
}

module.exports = Assembly;
