const request = require("supertest");
const express = require("express");
const authRoutes = require("../routes/auth");
const requireAuth = require("../middleware/auth");

const app = express();
app.use(express.json());
app.use("/api", authRoutes);

const protectedApp = express();
protectedApp.use(express.json());
protectedApp.use("/api", requireAuth);
protectedApp.get("/api/patients", (req, res) => res.json({ success: true, data: "patients" }));
protectedApp.get("/api/login_secret", (req, res) => res.json({ success: true, data: "secret" }));
protectedApp.get("/api/public/data", (req, res) => res.json({ success: true, data: "public" }));

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

describe("Auth Middleware Security Bypass Tests", () => {
  test("Query string containing '/login' or '/public' must NOT bypass authentication", async () => {
    const res1 = await request(protectedApp).get("/api/patients?bypass=/login");
    expect(res1.statusCode).toBe(401);

    const res2 = await request(protectedApp).get("/api/patients?bypass=/public");
    expect(res2.statusCode).toBe(401);
  });

  test("Subpaths of login must NOT bypass authentication", async () => {
    const res = await request(protectedApp).get("/api/login_secret");
    expect(res.statusCode).toBe(401);
  });

  test("Strict public prefix route /api/public/data MUST bypass authentication", async () => {
    const res = await request(protectedApp).get("/api/public/data");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: "public" });
  });
});
