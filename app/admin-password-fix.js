const auth=window.NEOMES_AUTH;
const allowed=auth&&!auth.offline&&(auth.user.roleCode==='admin'||(auth.user.permissions||[]).includes('users.reset_password'));

function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,character=>({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[character]);}

async function resetPassword(id){
  if(!window.confirm('A senha atual será invalidada e todas as sessões deste usuário serão encerradas.'))return;
  const response=await fetch(`/api/v1/admin/users/${encodeURIComponent(id)}/reset-password`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Accept':'application/json'},body:'{}'});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(payload.error||`Erro ${response.status}`);
  return payload.temporaryPassword;
}

function showPassword(password){
  document.querySelector('.admin-modal-layer')?.remove();
  const root=document.querySelector('.admin-layer');if(!root)return;
  const layer=document.createElement('div');layer.className='admin-modal-layer';
  layer.innerHTML=`<section class="admin-modal" role="dialog" aria-modal="true"><header><h2>Senha temporária</h2><button type="button" data-password-fix-close>×</button></header><div><div class="admin-temporary"><p>Esta senha será mostrada somente agora. Entregue-a ao usuário por um canal seguro.</p><code>${escapeHtml(password)}</code><button class="admin-primary" type="button" data-password-fix-copy="${escapeHtml(password)}">Copiar senha</button><small>O usuário deverá criar uma nova senha no primeiro acesso.</small></div></div></section>`;
  root.appendChild(layer);
}

if(allowed){
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-admin-reset-password]');
    if(!button)return;
    event.preventDefault();event.stopImmediatePropagation();
    button.disabled=true;
    try{const password=await resetPassword(button.dataset.adminResetPassword);if(password)showPassword(password);}catch(error){window.alert(error.message);}finally{button.disabled=false;}
  },true);
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-password-fix-close]'))event.target.closest('.admin-modal-layer')?.remove();
    const copy=event.target.closest('[data-password-fix-copy]')?.dataset.passwordFixCopy;
    if(copy)navigator.clipboard?.writeText(copy);
  });
}
