const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

function runWithRequestTestContext(context, fn) {
  return storage.run(context, fn);
}

function getRequestTestContext() {
  return storage.getStore();
}

module.exports = { runWithRequestTestContext, getRequestTestContext };
