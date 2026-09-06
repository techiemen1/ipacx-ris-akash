class BaseRepository {
  constructor(pool, tableName) {
    this.pool = pool;
    this.tableName = tableName;
  }

  async query(text, params = []) {
    return this.pool.query(text, params);
  }

  async findById(id) {
    const result = await this.query(`SELECT * FROM ${this.tableName} WHERE id=$1 LIMIT 1`, [id]);
    return result.rows[0] || null;
  }
}

module.exports = BaseRepository;
