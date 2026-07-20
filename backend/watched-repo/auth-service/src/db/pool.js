// Demo file for the code analyzer to scan. Intentionally buggy: the
// connection is never released back to the pool, so under load the pool
// exhausts even though each individual query completes fine.
async function withConnection(pool, fn) {
  const conn = await pool.acquire();
  return fn(conn);
}

module.exports = { withConnection };
