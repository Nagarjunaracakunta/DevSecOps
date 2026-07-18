// Demo file for the code analyzer to scan. Intentionally vulnerable.
function searchUsersByName(db, name) {
  const query = "SELECT * FROM users WHERE name = '" + name + "'";
  return db.query(query);
}

module.exports = { searchUsersByName };
