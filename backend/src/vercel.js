import { createApp } from "./app.js";
// Adaptez ces imports à ce que fait votre server.js :
import { connectMongo } from "./db/mongo.js";            // votre connexion Mongo
import { createRepositories } from "./repositories/index.js"; // votre création des repos

let app;

async function init() {
  if (!app) {
    const db = await connectMongo(process.env.MONGO_URI);
    const repos = createRepositories(db);
    app = createApp(repos);
  }
  return app;
}

// Export par défaut : une fonction (req, res), ce que Vercel attend
export default async function handler(req, res) {
  const application = await init();
  return application(req, res);
}
