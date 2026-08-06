import { defineConfig } from "astro/config";

const site = process.env.SITE_URL ?? "https://nzaec.zemo.bio";

export default defineConfig({
  site,
  output: "static",
});
