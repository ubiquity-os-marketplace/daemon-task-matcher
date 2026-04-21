import type { Config } from "jest";

const cfg: Config = {
  testEnvironment: "node",
  transform: {
    "^.+\\.[jt]s$": "@swc/jest",
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  coveragePathIgnorePatterns: ["node_modules", "mocks", "tests"],
  collectCoverage: true,
  coverageReporters: ["json", "lcov", "text", "clover", "json-summary"],
  reporters: ["default", "jest-junit", "jest-md-dashboard"],
  coverageDirectory: "coverage",
  testTimeout: 20000,
  roots: ["<rootDir>", "tests"],
  transformIgnorePatterns: [],
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@ubiquity-os/plugin-sdk$": "<rootDir>/tests/__mocks__/plugin-sdk.ts",
    "^@ubiquity-os/plugin-sdk/manifest$": "<rootDir>/tests/__mocks__/plugin-sdk.ts",
  },
  setupFilesAfterEnv: ["dotenv/config", "<rootDir>/tests/jest-setup.ts"],
};

export default cfg;
