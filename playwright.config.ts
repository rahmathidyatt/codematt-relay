import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'tests/e2e',workers:1,timeout:90000,use:{baseURL:'http://127.0.0.1:5180',headless:true,launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE},screenshot:'only-on-failure'},
  webServer:{command:'npm run dev -- --port 5180',url:'http://127.0.0.1:5180',reuseExistingServer:false,timeout:60000,env:{RELAY_DEMO_DIR:'.demo-test-data'}},
});
