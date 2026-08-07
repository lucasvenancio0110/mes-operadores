import { defineConfig } from '@playwright/test';

const mobileWebKit = (name,width,height) => ({
  name,
  use:{ browserName:'webkit',viewport:{ width,height },isMobile:true,hasTouch:true }
});

export default defineConfig({
  testDir:'./tests/e2e',
  timeout:45_000,
  expect:{ timeout:8_000 },
  fullyParallel:false,
  retries:1,
  reporter:[['list'],['html',{ outputFolder:'playwright-report',open:'never' }]],
  use:{
    baseURL:'http://127.0.0.1:4173',
    locale:'pt-BR',
    timezoneId:'America/Sao_Paulo',
    trace:'retain-on-failure',
    screenshot:'only-on-failure',
    video:'retain-on-failure'
  },
  projects:[
    mobileWebKit('webkit-390x844',390,844),
    mobileWebKit('webkit-393x852',393,852),
    mobileWebKit('webkit-430x932',430,932)
  ],
  webServer:{
    command:'node tests/e2e/server.mjs',
    url:'http://127.0.0.1:4173',
    reuseExistingServer:true,
    timeout:15_000
  }
});
