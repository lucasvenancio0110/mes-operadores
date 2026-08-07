import { test,expect } from '@playwright/test';
import { installForensicApi } from './support/forensic-api.mjs';

const enabled=process.env.NEOMES_FORENSIC_MAIN==='1';
test.skip(!enabled,'executado somente contra worktree da main atual');

async function waitForCard(page){
  await expect(page.getByText('TNL 091',{ exact:true }).first()).toBeVisible();
  await expect(page.locator('.ops-machine-card').first()).toBeVisible();
}

async function fullScreenBlockers(page){
  return page.evaluate(()=>{
    const area=innerWidth*innerHeight;
    return [...document.querySelectorAll('body *')].map(element=>{
      const r=element.getBoundingClientRect();const s=getComputedStyle(element);
      return { element,r,s,a:r.width*r.height };
    }).filter(x=>x.a>area*.55&&['fixed','absolute'].includes(x.s.position)&&x.s.display!=='none'&&x.s.visibility!=='hidden'&&x.s.pointerEvents!=='none')
      .map(x=>({ tag:x.element.tagName,id:x.element.id,className:typeof x.element.className==='string'?x.element.className:'',opacity:x.s.opacity,zIndex:x.s.zIndex,pointerEvents:x.s.pointerEvents }));
  });
}

async function centerForHitTest(locator){
  await locator.evaluate(element=>element.scrollIntoView({ block:'center',inline:'nearest',behavior:'instant' }));
  await locator.page().waitForTimeout(50);
}

test('main limpa não possui overlay invisível permanente antes da conferência',async({ page })=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await installForensicApi(page);
  await page.goto('/');
  await waitForCard(page);
  const trigger=page.locator('[data-action="open-conference"],[data-ta-reconfirm]').first();
  await expect(trigger).toBeVisible();
  await centerForHitTest(trigger);
  const info=await trigger.evaluate(element=>{
    const r=element.getBoundingClientRect();const x=r.left+r.width/2;const y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);
    return {
      ok:hit===element||element.contains(hit),
      hit:hit?.outerHTML?.slice(0,180)||'',
      layers:document.getElementById('layers')?.innerHTML||'',
      point:{ x,y },viewport:{ width:innerWidth,height:innerHeight }
    };
  });
  expect(info.ok,`botão de conferência coberto por ${info.hit}; point=${JSON.stringify(info.point)}; viewport=${JSON.stringify(info.viewport)}; layers=${info.layers.slice(0,300)}`).toBeTruthy();
  expect((await fullScreenBlockers(page)).filter(item=>Number(item.opacity)<.08)).toEqual([]);
  expect(errors).toEqual([]);
});

test('main atual é fail-fast: falha de um módulo visual interrompe auth-shell',async({ page })=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await installForensicApi(page);
  await page.route('**/app/factory-map-workspace.js*',route=>route.abort('failed'));
  await page.goto('/');
  await page.waitForTimeout(1200);
  await expect(page.locator('.boot')).toBeVisible();
  await expect(page.locator('.ops-machine-card')).toHaveCount(0);
  await expect(page.locator('.auth-page')).toHaveCount(0);
  expect(errors.length,'a falha de import deveria produzir erro de módulo na main atual').toBeGreaterThan(0);
});
