let bootstrapLayer = null;

function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,character=>({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[character]);}

function injectBootstrapEntry(){
  const form=document.getElementById('secureLoginForm');
  if(!form||document.querySelector('[data-bootstrap-admin]'))return;
  const button=document.createElement('button');
  button.type='button';button.className='auth-bootstrap-link';button.dataset.bootstrapAdmin='true';button.textContent='Configurar primeiro administrador';
  form.insertAdjacentElement('afterend',button);
}

function closeBootstrap(){bootstrapLayer?.remove();bootstrapLayer=null;}

function openBootstrap(){
  if(bootstrapLayer)return;
  bootstrapLayer=document.createElement('div');bootstrapLayer.className='auth-bootstrap-layer';
  bootstrapLayer.innerHTML=`<section class="auth-bootstrap-modal" role="dialog" aria-modal="true" aria-labelledby="bootstrapTitle">
    <header><div><p>INICIALIZAÇÃO SEGURA</p><h2 id="bootstrapTitle">Primeiro administrador</h2></div><button type="button" data-bootstrap-close aria-label="Fechar">×</button></header>
    <form id="bootstrapAdminForm" novalidate>
      <p class="auth-bootstrap-help">Esta etapa funciona apenas enquanto ainda não existir um administrador ativo.</p>
      <label><span>Segredo temporário do Cloudflare</span><input name="bootstrapToken" type="password" autocomplete="off" required></label>
      <label><span>Nome completo</span><input name="name" autocomplete="name" required></label>
      <label><span>Matrícula</span><input name="registration" inputmode="numeric" autocomplete="username" required></label>
      <label><span>Turno padrão</span><select name="shift"><option value="1">1º turno</option><option value="2">2º turno</option><option value="3">3º turno</option></select></label>
      <label><span>Senha do administrador</span><input name="password" type="password" autocomplete="new-password" minlength="10" required></label>
      <label><span>Confirmar senha</span><input name="confirmation" type="password" autocomplete="new-password" minlength="10" required></label>
      <ul><li>Pelo menos 10 caracteres</li><li>Letras e números</li><li>Não pode conter a matrícula</li></ul>
      <div class="auth-error" role="alert"></div>
      <footer><button type="button" class="auth-bootstrap-secondary" data-bootstrap-close>Cancelar</button><button type="submit" class="auth-primary">Criar administrador</button></footer>
    </form>
  </section>`;
  document.body.appendChild(bootstrapLayer);
}

async function submitBootstrap(form){
  const data=Object.fromEntries(new FormData(form));
  const error=form.querySelector('.auth-error');
  if(data.password!==data.confirmation)return void(error.textContent='A confirmação não corresponde à senha.');
  const button=form.querySelector('[type="submit"]');button.disabled=true;button.textContent='Criando…';
  try{
    const response=await fetch('/api/v1/auth/bootstrap',{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json','X-Bootstrap-Token':data.bootstrapToken},
      body:JSON.stringify({name:data.name,registration:data.registration,shift:data.shift,password:data.password})
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error||`Erro ${response.status}`);
    form.innerHTML=`<div class="auth-bootstrap-success"><strong>Administrador criado</strong><p>Agora feche esta janela e entre com sua matrícula e a senha que acabou de definir.</p><button class="auth-primary" type="button" data-bootstrap-close>Ir para o login</button></div>`;
  }catch(failure){error.textContent=failure.message;button.disabled=false;button.textContent='Criar administrador';}
}

new MutationObserver(injectBootstrapEntry).observe(document.body,{childList:true,subtree:true});
injectBootstrapEntry();

document.addEventListener('click',event=>{
  if(event.target.closest('[data-bootstrap-admin]'))openBootstrap();
  if(event.target.closest('[data-bootstrap-close]'))closeBootstrap();
});
document.addEventListener('submit',event=>{if(event.target.id==='bootstrapAdminForm'){event.preventDefault();submitBootstrap(event.target);}});
