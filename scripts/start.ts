import { config } from "dotenv";
const index = process.argv.indexOf("--env");
config({ path: index >= 0 ? process.argv[index + 1] : ".env", override: true });
// Set NODE_ENV=production behind HTTPS. For local same-origin demos leave it unset.
await import("../apps/api/src/main");
