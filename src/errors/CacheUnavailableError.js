class CacheUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'CacheUnavailableError';
  }
}

module.exports = CacheUnavailableError;
