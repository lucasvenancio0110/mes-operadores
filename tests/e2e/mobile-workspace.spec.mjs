import { test,expect } from '@playwright/test';
import { installForensicApi } from './support/forensic-api.mjs';

test('iPhone mantém página e navegação no shell mobile sem reparent desktop',async({ page })=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await installForensicApi(page);
  await page.goto('/');
  await expect(page.getByText('TNL 091',{ exact:true }).first()).toBeVisible();
  await page.waitForFunction(()=>Boolean(window.__NEOMES_MODULE_BOOT));
  await page.waitForTimeout(450);

  const structure=await page.evaluate(()=>({
    width:window.innerWidth,
    layouts:document.querySelectorAll('.ops-desktop-layout').length,
    pageParent:document.querySelector('.ops-page')?.parentElement?.className || '',
    navParent:document.querySelector('.ops-nav')?.parentElement?.className || '',
    navDisplay:document.querySelector('.ops-nav') ? getComputedStyle(document.querySelector('.ops-nav')).display : 'missing',
    navRect:document.querySelector('.ops-nav')?.getBoundingClientRect().toJSON?.() || null
  }));

  expect(structure.width).toBeLessThan(760);
  expect(structure.layouts).toBe(0);
  expect(structure.pageParent).toContain('ops-shell');
  expect(structure.navParent).toContain('ops-shell');
  expect(structure.navDisplay).not.toBe('none');
  await expect(page.locator('.ops-nav')).toBeVisible();

  await page.getByRole('button',{ name:'Histórico' }).tap();
  await expect(page.getByRole('heading',{ name:'Histórico' })).toBeVisible();
  await page.getByRole('button',{ name:'Turno' }).tap();
  await expect(page.getByRole('heading',{ name:'Meu turno' })).toBeVisible();

  await page.waitForTimeout(700);
  expect(await page.locator('.ops-desktop-layout').count()).toBe(0);
  await expect(page.locator('.ops-nav')).toBeVisible();
  expect(errors).toEqual([]);
});
