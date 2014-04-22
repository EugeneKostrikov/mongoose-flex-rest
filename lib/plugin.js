
var mongoose = require('mongoose');
var acl = require('./acl');

var plugin = function(Schema, globals){
  globals = globals || {};
  globals.exclude = globals.exclude || [];
  globals.readLimit = globals.readLimit || 500; //Default max of items to read
  globals.acl = globals.acl || {create: 0, delete: 0, read: 0, update: 0};
  acl.createRules(Schema, {
    create: globals.acl.create,
    delete: globals.acl.delete,
    read: globals.acl.read,
    update: globals.acl.update
  });

  var methods = require('./methods')(globals);

  if (globals.exclude.indexOf('head') === -1){
    Schema.statics['rest_head'] = methods.head;
  }
  if (globals.exclude.indexOf('create') === -1){
    Schema.statics['rest_create'] = methods.create;
  }
  if (globals.exclude.indexOf('read') === -1){
    Schema.statics['rest_read'] = methods.read;
  }
  if (globals.exclude.indexOf('update') === -1){
    Schema.statics['rest_update'] = methods.update;
  }
  if (globals.exclude.indexOf('delete') === -1){
    Schema.statics['rest_delete'] = methods.del;
  }
};

module.exports = plugin;