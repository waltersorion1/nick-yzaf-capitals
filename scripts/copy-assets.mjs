import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("public/assets", { recursive: true });
copyFileSync(
  "node_modules/bootstrap/dist/css/bootstrap.min.css",
  "public/assets/bootstrap-5.3.9.min.css",
);

copyFileSync(
  "node_modules/chart.js/dist/chart.umd.min.js",
  "public/assets/chart-4.6.1.umd.min.js",
);
