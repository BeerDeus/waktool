// Tests Waktool : site servi en statique, Chromium (PC + mobile).
const { defineConfig, devices } = require('@playwright/test');
const PORT = 8799;
module.exports = defineConfig({
  testDir: '.',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: { baseURL: `http://localhost:${PORT}/`, trace: 'off', serviceWorkers: 'block' },
  webServer: { command: `python3 -m http.server ${PORT} --bind 127.0.0.1`, cwd: '..', port: PORT, reuseExistingServer: !process.env.CI, stdout: 'ignore', stderr: 'ignore' },
  projects: [
    { name: 'pc', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 950 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /pages\.spec\.js/ },
  ],
});
