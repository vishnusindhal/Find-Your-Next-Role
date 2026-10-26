import mongoose from "mongoose";
import { app } from "./app.js";
import { config } from "./config.js";

await mongoose.connect(config.mongoUri);
app.listen(config.port, config.host, () => {
  console.log(`Dashboard API listening at http://${config.host}:${config.port}`);
});
