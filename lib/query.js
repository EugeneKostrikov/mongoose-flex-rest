var Parser = require('./parsers');
var acl = require('./acl');

var defaultAcess = {
  read: 0,
  create: 0,
  update: 0,
  delete: 0
};

function Query(model, find, select, populate, sort, skip, limit, access){
  this.parser = new Parser();
  this.find = this.parser.query(find || {});
  this.select = select || acl.getAllowed(access, model);
  this.populate = this.parser.populate(populate || {});
  this.skip = skip || 0;
  this.sort = sort || '_id';
  this.limit = isNaN(limit) ? 25 : limit;
  this.access = access || defaultAcess;
  this.valid = {
    read: acl.validateRead(this.find, this.access, model),
    create: acl.validateCreate(this.access, model),
    delete: acl.validateDelete(this.access, model)
  };
}

module.exports = Query;