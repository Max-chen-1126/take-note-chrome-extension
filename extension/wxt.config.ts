import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Take-Note",
    action: {}, // sidepanel needs an empty action
    permissions: ["sidePanel", "activeTab", "scripting", "storage", "identity"],
    host_permissions: ["https://www.youtube.com/*", "<all_urls>"],
  },
});
