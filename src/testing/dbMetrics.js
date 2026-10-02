let queryCount = 0;

function getDbQueryCount() {
  return queryCount;
}

function resetDbQueryCount() {
  queryCount = 0;
}

function incrementDbQueryCount() {
  queryCount += 1;
}

module.exports = {
  getDbQueryCount,
  resetDbQueryCount,
  incrementDbQueryCount,
};
