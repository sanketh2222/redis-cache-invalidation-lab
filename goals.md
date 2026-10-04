# Goals reference

Short definitions of the numbered goals used in the prep tracker and our sessions. The numbering follows ROADMAP.md.

## Goal 0: createProduct ordering
A small test showing that a failing `setCachedProduct` can't leave the not-found key (`product:missing:<id>`) behind after a create.
Status: done in commit 97b67ec (`tests/products/productService-create-cache.test.js`), building on the reorder in a2320ea.

## Goal 2: Cache warming
The warmer actually refreshes products that are already cached, instead of just counting them as warmed.
Status: the warmer was fixed in a2320ea and the evaluate warming check passes. Verify that already-cached products get refreshed.
