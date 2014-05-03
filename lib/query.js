var Parser = require('./parsers');
var acl = require('./acl');

var defaultAccess = {
  read: 0,
  create: 0,
  update: 0,
  delete: 0
};

function Query(globals, model, find, select, populate, sort, skip, limit, access){
  this.parser = new Parser();
  this.acl = access || defaultAccess;
  this.find = this.parser.query(find || {});
  this.select = select || acl.getAllowed(this.acl, model);
  this.populate = this.parser.populate(populate);
  this.skip = skip || 0;
  this.sort = sort || '_id';
  this.limit = isNaN(limit) ? globals.limit || 25 : limit;
  this.valid = {
    read: acl.validateRead(this.find, this.acl, model),
    create: acl.validateCreate(this.acl, model),
    delete: acl.validateDelete(this.acl, model),
    select: acl.validateSelect(this.select, this.acl, model),
    populate: null
  };

  var that = this;
  this.valid.populate = true;
  if (this.populate.length> 0){
    this.populate.forEach(function(pop){
      if (!acl.validatePop(pop, that.acl, model)){
        that.valid.populate = false;
      }
    });
  }
}

module.exports = Query;