const dotenv = require("dotenv");

jest.mock("dotenv", () => ({
  config: jest.fn(() => ({ parsed: {} })),
}));

describe("Runtime Environment Startup Validation Tests", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test("Should throw fatal error if POSTGRES_USER / DB_USER is missing or empty", () => {
    delete process.env.POSTGRES_USER;
    delete process.env.DB_USER;
    expect(() => {
      jest.isolateModules(() => {
        require("../db");
      });
    }).toThrow(/FATAL CONFIGURATION ERROR/i);
  });

  test("Should throw fatal error if POSTGRES_PASSWORD / DB_PASSWORD is missing or empty", () => {
    delete process.env.POSTGRES_PASSWORD;
    delete process.env.DB_PASSWORD;
    expect(() => {
      jest.isolateModules(() => {
        require("../db");
      });
    }).toThrow(/FATAL CONFIGURATION ERROR/i);
  });

  test("Should throw fatal error if ORTHANC_USER is missing or empty", () => {
    delete process.env.ORTHANC_USER;
    expect(() => {
      jest.isolateModules(() => {
        require("../routes/pacs");
      });
    }).toThrow(/FATAL CONFIGURATION ERROR/i);
  });

  test("Should throw fatal error if ORTHANC_PASS / ORTHANC_PASSWORD is missing or empty", () => {
    delete process.env.ORTHANC_PASS;
    delete process.env.ORTHANC_PASSWORD;
    expect(() => {
      jest.isolateModules(() => {
        require("../routes/pacs");
      });
    }).toThrow(/FATAL CONFIGURATION ERROR/i);
  });

  test("Should throw fatal error in env.js if JWT_SECRET is missing or empty", () => {
    delete process.env.JWT_SECRET;
    expect(() => {
      jest.isolateModules(() => {
        require("../config/env");
      });
    }).toThrow(/FATAL CONFIGURATION ERROR/i);
  });
});
