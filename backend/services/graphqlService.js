const { ApolloServer } = require("@apollo/server");
const { expressMiddleware } = require("@apollo/server/express4");
const pool = require("../db");
const logger = require("../utils/logger");

const typeDefs = `#graphql
  type Patient {
    id: ID!
    mrn: String
    first_name: String
    last_name: String
    gender: String
    dob: String
    phone: String
    reports: [Report]
  }

  type Report {
    id: ID!
    patient_id: ID
    modality: String
    status: String
    findings: String
    impression: String
    created_at: String
  }

  type Query {
    patients(limit: Int): [Patient]
    patient(id: ID!): Patient
    reports(status: String): [Report]
  }
`;

const resolvers = {
  Query: {
    patients: async (_, { limit = 20 }) => {
      const res = await pool.query("SELECT * FROM patients ORDER BY id DESC LIMIT $1", [limit]);
      return res.rows;
    },
    patient: async (_, { id }) => {
      const res = await pool.query("SELECT * FROM patients WHERE id = $1", [id]);
      return res.rows[0] || null;
    },
    reports: async (_, { status }) => {
      let query = "SELECT * FROM reports";
      const params = [];
      if (status) {
        query += " WHERE status = $1";
        params.push(status);
      }
      query += " ORDER BY id DESC LIMIT 50";
      const res = await pool.query(query, params);
      return res.rows;
    },
  },
  Patient: {
    reports: async (parent) => {
      const res = await pool.query("SELECT * FROM reports WHERE patient_id = $1", [parent.id]);
      return res.rows;
    },
  },
};

async function setupGraphQLServer(app) {
  try {
    const server = new ApolloServer({
      typeDefs,
      resolvers,
    });

    await server.start();
    app.use("/graphql", expressMiddleware(server));
    logger.info("Apollo GraphQL server mounted on /graphql endpoint.");
  } catch (err) {
    logger.error("Failed to mount Apollo GraphQL server", { error: err.message });
  }
}

module.exports = { setupGraphQLServer };
