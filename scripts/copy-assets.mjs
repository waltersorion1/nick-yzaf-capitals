import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("public/assets", { recursive: true });
copyFileSync(
  "node_modules/bootstrap/dist/css/bootstrap.min.css",
  "public/assets/bootstrap-5.3.9.min.css",
);
