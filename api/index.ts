// Vercel serverless entry point.
// The Express app handles all /api/* routes; Vercel serves the Vite build as static files.
import { createApp } from "../server/src/app.js";

export default createApp();
