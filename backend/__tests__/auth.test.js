const request = require("supertest");
const express = require("express");
const authRoutes = require("../routes/auth");

const app = express();
app.use(express.json());
app.use("/api", authRoutes);

describe("Authentication API Endpoint Tests", () => {
  test("POST /api/login should reject empty body with 400 status", async () => {
    const res = await request(app).post("/api/login").send({});
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty("message");
  });

  test("GET /api/verify without Bearer token should return 401", async () => {
    const res = await request(app).get("/api/verify");
    expect(res.statusCode).toBe(401);
  });
});
