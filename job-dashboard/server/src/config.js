import "dotenv/config";

const required = ["MONGODB_URI", "CLIENT_ORIGIN"];
for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

export const config = {
  mongoUri: process.env.MONGODB_URI,
  port: Number(process.env.PORT || 4000),
  clientOrigin: process.env.CLIENT_ORIGIN,
  host: process.env.HOST || "127.0.0.1",
  dataDir: process.env.DATA_DIR || "..\\data",
};
