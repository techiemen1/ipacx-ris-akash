const BaseRepository = require("./BaseRepository");

class PacsRepository extends BaseRepository {
  constructor(pool) {
    super(pool, "pacs");
  }

  async findAll() {
    const result = await this.query("SELECT * FROM pacs ORDER BY id ASC");
    return result.rows;
  }

  async findActive() {
    const result = await this.query("SELECT * FROM pacs WHERE is_active=true ORDER BY id ASC");
    return result.rows;
  }

  async upsert(data) {
    const {
      id,
      pacs_name,
      pacs_type,
      ae_title,
      ip_address,
      port,
      username,
      password,
    } = data;

    if (id) {
      const result = await this.query(
        `UPDATE pacs
         SET pacs_name=$1, pacs_type=$2, ae_title=$3, ip_address=$4, port=$5,
             username=$6, password=$7, updated_at=NOW()
         WHERE id=$8
         RETURNING *`,
        [pacs_name, pacs_type, ae_title, ip_address, port, username, password, id]
      );
      return result.rows[0] || null;
    }

    try {
      const result = await this.query(
        `INSERT INTO pacs (pacs_name, pacs_type, ae_title, ip_address, port, username, password)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (ae_title)
         DO UPDATE SET
            pacs_name = EXCLUDED.pacs_name,
            pacs_type = EXCLUDED.pacs_type,
            ip_address = EXCLUDED.ip_address,
            port = EXCLUDED.port,
            username = EXCLUDED.username,
            password = EXCLUDED.password,
            updated_at = NOW()
         RETURNING *`,
        [pacs_name, pacs_type, ae_title, ip_address, port, username, password]
      );
      return result.rows[0];
    } catch (err) {
      // Fallback insert if ON CONFLICT (ae_title) constraint is missing
      const result = await this.query(
        `INSERT INTO pacs (pacs_name, pacs_type, ae_title, ip_address, port, username, password)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [pacs_name, pacs_type, ae_title, ip_address, port, username, password]
      );
      return result.rows[0];
    }
  }

  async deleteById(id) {
    const result = await this.query("DELETE FROM pacs WHERE id=$1 RETURNING id, pacs_name", [id]);
    return result.rows[0] || null;
  }

  async setActive(id, isActive) {
    const result = await this.query(
      "UPDATE pacs SET is_active=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
      [isActive, id]
    );
    return result.rows[0] || null;
  }
}

module.exports = PacsRepository;
