
var Middleware = function(){
  this._sets = {
    read: [],
    create: [],
    update: [],
    delete: [],
    all: []
  };
};

Middleware.prototype.use = function(setName, fn){
  this._sets[setName].push(fn);
};

Middleware.prototype.run = function(setName, context, args, callback){
  var countdown = this._sets[setName].length;
  if (countdown === 0) return callback(null); //pass empty sets transparently

  var failed = false;
  //Remove callback from previous set
  if (args.length === 4) args.pop();
  //And push fresh one
  args.push(done);
  this._sets[setName].forEach(function(task){
    task.apply(context, args);
  });

  function done(err){
    countdown--;
    if (failed) return;
    if (err){
      failed = true;
      return callback(err);
    }
    if (countdown !== 0) return;
    callback(null);
  }
};

module.exports = Middleware;
