import { test,expect } from '@playwright/test';
import { installForensicApi } from './support/forensic-api.mjs';

async function waitForCard(page){
  await expect(page.getByText('TNL 091',{ exact:true }).first()).toBeVisible();
  await expect(page.locator('.ops-machine-card').first()).toBeVisible();
}

async function hitInfo(locator){
  return locator.evaluate(element=>{
    const rect=element.getBoundingClientRect();
    const x=rect.left+rect.width/2;
    const y=rect.top+rect.height/2;
    const inViewport=x>=0&&x<window.innerWidth&&y>=0&&y<window.innerHeight;
    const hit=inViewport?document.elementFromPoint(x,y):null;
    const stack=inViewport?document.elementsFromPoint(x,y).slice(0,8).map(node=>({
      tag:node.tagName,id:node.id,className:typeof node.className==='string'?node.className:'',
      pointerEvents:getComputedStyle(node).pointerEvents,zIndex:getComputedStyle(node).zIndex
    })):[];
    const style=getComputedStyle(element);
    return {
      rect:{ x:rect.x,y:rect.y,width:rect.width,height:rect.height },x,y,inViewport,
      hitInside:inViewport&&(hit===element||element.contains(hit)),
      hit:hit?{ tag:hit.tagName,id:hit.id,className:typeof hit.className==='string'?hit.className:'' }:null,
      stack,display:style.display,visibility:style.visibility,opacity:style.opacity,pointerEvents:style.pointerEvents
    };
  });
}

async function expectTouchable(locator,label){
  await expect(locator,label).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  const info=await hitInfo(locator);
  expect(info.rect.width,`${label}: largura inválida`).toBeGreaterThan(0);
  expect(info.rect.height,`${label}: altura inválida`).toBeGreaterThan(0);
  expect(info.inViewport,`${label}: centro fora da viewport após scroll`).toBeTruthy();
  expect(info.visibility,`${label}: visibility`).not.toBe('hidden');
  expect(info.pointerEvents,`${label}: pointer-events`).not.toBe('none');
  expect(Number(info.opacity),`${label}: opacity`).toBeGreaterThan(0.05);
  expect(info.hitInside,`${label} bloqueado por ${JSON.stringify(info.hit)}; stack=${JSON.stringify(info.stack)}`).toBeTruthy();
}

async function panelForensics(page){
  return page.evaluate(()=>{
    const viewportArea=Math.max(1,window.innerWidth*window.innerHeight);
    const blockers=[...document.querySelectorAll('body *')].map(element=>{
      const rect=element.getBoundingClientRect();
      const style=getComputedStyle(element);
      return { element,rect,style,area:Math.max(0,rect.width)*Math.max(0,rect.height) };
    }).filter(item=>{
      if(item.area<viewportArea*.55)return false;
      if(!['fixed','absolute'].includes(item.style.position))return false;
      if(item.style.display==='none'||item.style.visibility==='hidden'||item.style.pointerEvents==='none')return false;
      return true;
    }).map(item=>({
      tag:item.element.tagName,id:item.element.id,className:typeof item.element.className==='string'?item.element.className:'',
      position:item.style.position,pointerEvents:item.style.pointerEvents,opacity:item.style.opacity,zIndex:item.style.zIndex,
      width:Math.round(item.rect.width),height:Math.round(item.rect.height)
    }));
    const ghostBlockers=blockers.filter(item=>Number(item.opacity)<.08);
    return {
      layersChildren:document.getElementById('layers')?.children.length||0,
      layersHtml:(document.getElementById('layers')?.innerHTML||'').slice(0,500),
      bodyHasLayer:document.body.classList.contains('has-layer'),blockers,ghostBlockers
    };
  });
}

async function expectPanelClear(page,label='painel'){
  await expect.poll(async()=>await page.locator('#layers').evaluate(el=>el.children.length),{ message:`${label}: #layers deveria estar vazio` }).toBe(0);
  const state=await panelForensics(page);
  expect(state.bodyHasLayer,`${label}: body.has-layer órfão`).toBeFalsy();
  expect(state.ghostBlockers,`${label}: overlay transparente detectado: ${JSON.stringify(state.ghostBlockers)}`).toEqual([]);
  const unexpected=state.blockers.filter(item=>!String(item.className).includes('ops-nav')&&!String(item.className).includes('topbar')&&!String(item.className).includes('ops-header'));
  expect(unexpected,`${label}: elemento full-screen interceptando ponteiro: ${JSON.stringify(unexpected)}`).toEqual([]);
}

async function establishReadyState(page){
  await page.goto('/');
  await waitForCard(page);
  const trigger=page.locator('[data-action="open-conference"],[data-ta-reconfirm]').first();
  await expectTouchable(trigger,'Fazer conferência');
  await trigger.tap();
  await expect(page.locator('#taHandoffForm')).toBeVisible();
  await page.locator('#taHandoffForm [name="currentBarPieces"]').fill('20');
  await page.locator('#taHandoffForm [name="feederBars"]').fill('2');
  const submit=page.locator('[data-ta-submit-form="taHandoffForm"]');
  await expectTouchable(submit,'Confirmar conferência');
  await submit.tap();
  await expect(page.getByText('Pronta para o turno',{ exact:true })).toBeVisible();
  const back=page.getByRole('button',{ name:'Voltar ao painel',exact:true });
  await expectTouchable(back,'Voltar ao painel');
  await back.tap();
  await expect(page.locator('[data-ta-point]')).toBeVisible();
  await expectPanelClear(page,'após conferência');
}

test('nenhuma camada fantasma cobre os controles visíveis do painel',async({ page })=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await installForensicApi(page);
  await establishReadyState(page);

  const controls=[
    ['Menu','[data-action="menu"]'],
    ['Informar situação','[data-runtime-open]'],
    ['Histórico','[data-runtime-history-open]'],
    ['Fazer apontamento','[data-ta-point]'],
    ['Atualizar dados','[data-ta-update]'],
    ['Encerrar OP','[data-ta-close-order]']
  ];
  for(const [label,selector] of controls)await expectTouchable(page.locator(selector).first(),label);

  await page.evaluate(()=>window.scrollTo(0,0));
  const generic=await page.evaluate(()=>[...document.querySelectorAll('button,a[href],input,select,textarea,[role="button"]')]
    .filter(element=>{
      const r=element.getBoundingClientRect();const s=getComputedStyle(element);
      const x=r.left+r.width/2;const y=r.top+r.height/2;
      return r.width>0&&r.height>0&&x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&s.display!=='none'&&s.visibility!=='hidden'&&!element.disabled;
    }).map(element=>{
      const r=element.getBoundingClientRect();const x=r.left+r.width/2;const y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);
      return { label:(element.getAttribute('aria-label')||element.textContent||element.name||element.id||element.tagName).trim().slice(0,80),ok:hit===element||element.contains(hit),hit:hit?.outerHTML?.slice(0,180)||'' };
    }).filter(item=>!item.ok));
  expect(generic,`controles realmente visíveis cobertos no painel: ${JSON.stringify(generic)}`).toEqual([]);
  expect(errors).toEqual([]);
});

test('abrir e fechar modais repetidamente nunca deixa #layers órfão',async({ page })=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await installForensicApi(page);
  await establishReadyState(page);

  for(let round=1;round<=5;round++){
    const runtime=page.locator('[data-runtime-open]').first();
    await expectTouchable(runtime,`situação rodada ${round}`);await runtime.tap();
    await expect(page.locator('[data-machine-runtime-layer]')).toBeVisible();
    await expectTouchable(page.locator('[data-runtime-close]').first(),`fechar situação rodada ${round}`);await page.locator('[data-runtime-close]').first().tap();
    await expectPanelClear(page,`situação rodada ${round}`);

    const history=page.locator('[data-runtime-history-open]').first();
    await expectTouchable(history,`histórico rodada ${round}`);await history.tap();
    await expect(page.locator('[data-machine-runtime-layer]')).toBeVisible();
    await expectTouchable(page.locator('[data-runtime-close]').first(),`fechar histórico rodada ${round}`);await page.locator('[data-runtime-close]').first().tap();
    await expectPanelClear(page,`histórico rodada ${round}`);

    const update=page.locator('[data-ta-update]').first();
    await expectTouchable(update,`atualizar rodada ${round}`);await update.tap();
    await expect(page.locator('#taHandoffForm')).toBeVisible();
    await expectTouchable(page.locator('[data-ta-close]').first(),`cancelar atualização rodada ${round}`);await page.locator('[data-ta-close]').first().tap();
    await expectPanelClear(page,`atualização rodada ${round}`);

    const pointing=page.locator('[data-ta-point]').first();
    await expectTouchable(pointing,`apontamento rodada ${round}`);await pointing.tap();
    await expect(page.locator('#taPointingForm')).toBeVisible();
    await expectTouchable(page.locator('[data-ta-close]').first(),`cancelar apontamento rodada ${round}`);await page.locator('[data-ta-close]').first().tap();
    await expectPanelClear(page,`apontamento rodada ${round}`);

    const closeOrder=page.locator('[data-ta-close-order]').first();
    await expectTouchable(closeOrder,`encerrar OP rodada ${round}`);await closeOrder.tap();
    await expect(page.locator('#taOrderCloseForm')).toBeVisible();
    await expectTouchable(page.locator('[data-ta-close]').first(),`cancelar encerramento rodada ${round}`);await page.locator('[data-ta-close]').first().tap();
    await expectPanelClear(page,`encerramento rodada ${round}`);

    const menu=page.locator('[data-action="menu"]').first();
    await expectTouchable(menu,`menu rodada ${round}`);await menu.tap();
    await expect(page.locator('#layers > *')).toBeVisible();
    const closeMenu=page.locator('[data-close-layer]').first();
    await expectTouchable(closeMenu,`fechar menu rodada ${round}`);await closeMenu.tap();
    await expectPanelClear(page,`menu rodada ${round}`);
  }
  expect(errors).toEqual([]);
});

test('toque físico no centro dos botões chega ao elemento correto',async({ page })=>{
  await installForensicApi(page);
  await establishReadyState(page);
  for(const [label,selector,opened] of [
    ['Informar situação','[data-runtime-open]','[data-machine-runtime-layer]'],
    ['Atualizar dados','[data-ta-update]','#taHandoffForm'],
    ['Fazer apontamento','[data-ta-point]','#taPointingForm'],
    ['Encerrar OP','[data-ta-close-order]','#taOrderCloseForm']
  ]){
    const control=page.locator(selector).first();await expectTouchable(control,label);
    const box=await control.boundingBox();expect(box).not.toBeNull();
    await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
    await expect(page.locator(opened)).toBeVisible();
    const closer=page.locator('[data-runtime-close],[data-ta-close]').first();await closer.tap();
    await expectPanelClear(page,`depois de ${label}`);
  }
});

test('botões críticos mantêm identidade DOM estável quando o usuário vai tocar',async({ page })=>{
  await installForensicApi(page);
  await establishReadyState(page);
  const selectors=['[data-runtime-open]','[data-runtime-history-open]','[data-ta-point]','[data-ta-update]','[data-ta-close-order]'];
  for(const selector of selectors){
    const locator=page.locator(selector).first();
    await locator.scrollIntoViewIfNeeded();
    const marker=`stable-${Math.random().toString(36).slice(2)}`;
    await locator.evaluate((element,value)=>element.dataset.forensicIdentity=value,marker);
    await page.waitForTimeout(600);
    const state=await page.locator(`[data-forensic-identity="${marker}"]`).evaluateAll((nodes,value)=>({
      count:nodes.length,connected:nodes[0]?.isConnected||false,selectorStillMatches:nodes[0]?.matches(value)||false
    }),selector);
    expect(state,`${selector} foi substituído durante janela de toque`).toEqual({ count:1,connected:true,selectorStillMatches:true });
  }
});
