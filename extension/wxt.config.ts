import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "NZ Accredited Employer Inspector",
    description: "Check a company's New Zealand employer accreditation from supported job sites.",
    version: "0.6.0",
    icons: {
      16: "/icon-16.png",
      32: "/icon-32.png",
      48: "/icon-48.png",
      96: "/icon-96.png",
      128: "/icon-128.png",
    },
    permissions: ["storage"],
    host_permissions: [
      "https://www.linkedin.com/*",
      "https://nz.seek.com/*",
      "https://www.immigration.govt.nz/*",
      "https://nzaec.zemo.bio/*",
    ],
  },
});
