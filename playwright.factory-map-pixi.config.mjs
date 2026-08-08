import { defineConfig } from '@playwright/test';

const projects=[
  ['chromium-1920x1080','chromium',1920,1080],
  ['chromium-1600x900','chromium',1600,900],
  ['chromium-1366x768','chromium',1366,768],
  ['webkit-390x844','webkit',390,844],
  ['webkit-393x852','webkit',393,852],
  ['webkit-430x932','webkit',430,932]
].map(([name,browserName,width,height])=>({ name,use:{ browserName,viewport:{ width,height } } }));

export default defineConfig({
  testDir:'tests/e2e',
  testMatch:'factory-map-pixi.spec.mjs',
  fullyParallel:true,
  retries:0,
  workers:2,
  timeout:60000,
  expect:{ timeout:12000 },
  outputDir:'test-results/factory-map-pixi',
  reporter:[['line'],['html',{ outputFolder:'playwright-report/factory-map-pixi',open:'never' }]],
  use:{
    baseURL:'http://127.0.0.1:4175',
    trace:'retain-on-failure',
    screenshot:'only-on-failure',
    video:'retain-on-failure'
  },
  webServer:{
    command:'PORT=4175 node tests/e2e/factory-map-server.mjs',
    url:'http://127.0.0.1:4175',
    reuseExistingServer:false,
    timeout:15000
  },
  projects
});
