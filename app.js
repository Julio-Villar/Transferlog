/*
  TransferLog app.js
  1. Supabase client y auth
  2. Estado global y LocalStorage
  3. DB abstraction
  4. UI helpers
  5. Navegación
  6. Recibos
  7. Rutas
  8. Órdenes de viaje
  9. Resumen
  10. PDF
  11. Configuración
  12. Init
*/

// ── 1. Supabase client ────────────────────────────────────
const SUPABASE_URL     = 'https://luosbdpumkoqsfiwqjft.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1b3NiZHB1bWtvcXNmaXdxamZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4NzcwMjQsImV4cCI6MjA5NzQ1MzAyNH0.uqr2LcLICRxN6Galo8mqeeawzNk48_oS7S5WQmuZFwo';

const {jsPDF} = window.jspdf || {};
const _sb = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    })
  : null;

// ── 2. Estado global ──────────────────────────────────────
let currentUser  = null;
let useSupabase  = false;
let selVehicle   = '';
let curId        = null;
let _curReceipt  = null;
let _curOrdenId  = null;
let _curOrden    = null;   // objeto completo de la orden abierta
let vehFilter    = 'todos';

const LS = {
  get routes()    { try{return JSON.parse(localStorage.getItem('tl_r')||'[]')}catch{return[]} },
  set routes(v)   { localStorage.setItem('tl_r',JSON.stringify(v)) },
  get receipts()  { try{return JSON.parse(localStorage.getItem('tl_p')||'[]')}catch{return[]} },
  set receipts(v) { localStorage.setItem('tl_p',JSON.stringify(v)) },
  get settings()  { try{return JSON.parse(localStorage.getItem('tl_settings')||'{}')}catch{return{}} },
  set settings(v) { localStorage.setItem('tl_settings',JSON.stringify(v)) },
  get catalogs()  {
    const base={choferes:[],solicitantes:[],areas:[],empresas:[],costos:[]};
    try{return{...base,...JSON.parse(localStorage.getItem('tl_catalogs')||'{}')}}catch{return base}
  },
  set catalogs(v) { localStorage.setItem('tl_catalogs',JSON.stringify(v)) }
};

const CATALOG_LABELS = {
  choferes:'Choferes', solicitantes:'Quien solicita',
  areas:'Áreas', empresas:'Empresas', costos:'Centros de costo'
};

// ── 3. DB abstraction ─────────────────────────────────────
async function sbFetch(path, opts={}) {
  const session = _sb ? (await _sb.auth.getSession()).data.session : null;
  const token   = session?.access_token || SUPABASE_ANON_KEY;
  const res = await fetch(SUPABASE_URL+'/rest/v1/'+path, {
    ...opts,
    headers:{
      'apikey':SUPABASE_ANON_KEY,'Authorization':'Bearer '+token,
      'Content-Type':'application/json','Prefer':'return=representation',
      ...(opts.headers||{})
    }
  });
  if(!res.ok) throw new Error(await res.text());
  const t=await res.text(); return t?JSON.parse(t):[];
}

function withUser(obj){ return currentUser?{...obj,user_id:currentUser.id}:obj; }

async function getRoutes()     { return useSupabase?sbFetch('routes?order=created_at.asc'):LS.routes }
async function addRouteDB(r)   {
  if(useSupabase) return (await sbFetch('routes',{method:'POST',body:JSON.stringify(withUser(r))}))[0];
  const rows=LS.routes; rows.push({...r,id:Date.now().toString()}); LS.routes=rows; return rows[rows.length-1];
}
async function delRouteDB(id)  {
  if(useSupabase) return sbFetch('routes?id=eq.'+id,{method:'DELETE'});
  LS.routes=LS.routes.filter(x=>x.id!==id);
}
async function getReceipts()   { return useSupabase?sbFetch('receipts?order=num.asc'):LS.receipts }
async function addReceiptDB(r) {
  if(useSupabase) return (await sbFetch('receipts',{method:'POST',body:JSON.stringify(withUser(r))}))[0];
  const rows=LS.receipts; rows.push({...r,id:Date.now().toString()}); LS.receipts=rows; return rows[rows.length-1];
}
async function delReceiptDB(id){
  if(useSupabase) return sbFetch('receipts?id=eq.'+id,{method:'DELETE'});
  LS.receipts=LS.receipts.filter(x=>x.id!==id);
}
async function countReceipts() {
  if(useSupabase){const r=await sbFetch('receipts?select=num&order=num.desc&limit=1');return r.length?r[0].num:0;}
  return LS.receipts.length;
}

// Órdenes — solo con Supabase
async function getOrdenes() {
  if(!useSupabase) return [];
  return sbFetch('ordenes?assigned_to=eq.'+currentUser.id+'&order=created_at.desc');
}
async function responderOrden(id, estado, motivo='') {
  return sbFetch('ordenes?id=eq.'+id, {
    method:'PATCH',
    body:JSON.stringify({ estado, motivo_rechazo:motivo, respondido_at:new Date().toISOString() })
  });
}

// ── 4. UI helpers ─────────────────────────────────────────
function toast(msg,dur=2400){
  const t=document.getElementById('toast');
  t.textContent=msg; t.style.display='block';
  setTimeout(()=>t.style.display='none',dur);
}
function fmtDate(d){
  if(!d) return '';
  const[y,m,da]=d.split('-'); return`${da}/${m}/${y}`;
}
function fmtCLP(n){ return'$'+Number(n||0).toLocaleString('es-CL'); }
function escapeHTML(v){
  return String(v||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

// ── 5. Navegación ─────────────────────────────────────────
function nav(s){
  document.querySelectorAll('.sec').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(x=>x.classList.remove('active'));
  document.getElementById('s-'+s).classList.add('active');
  document.getElementById('nb-'+s).classList.add('active');
  if(s==='recibos')  renderReceipts();
  if(s==='nuevo')    { initForm(); renderRouteSelect(); }
  if(s==='ordenes')  renderOrdenes();
  if(s==='resumen')  {}
}

// ── 6. Recibos ────────────────────────────────────────────
function selVeh(v){
  selVehicle=v;
  document.querySelectorAll('.vo').forEach(b=>b.classList.remove('sel'));
  document.getElementById('v-'+v).classList.add('sel');
}

function initForm(){
  const today=new Date().toISOString().split('T')[0];
  document.getElementById('f-fecha').value=today;
  selVehicle='';
  document.querySelectorAll('.vo').forEach(b=>b.classList.remove('sel'));
  ['f-desde','f-hasta','f-espera','f-detalle','f-total'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  // Limpiar desglose de total
  const desglose=document.getElementById('total-desglose');
  if(desglose) desglose.innerHTML='';
  renderCatalogControls();
  ['f-chofer','f-area','f-solicita','f-empresa','f-costo'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  document.getElementById('f-ruta').value='';
  document.getElementById('f-total').dataset.baseTotal='';
  document.getElementById('f-paradas').value=0;
  document.getElementById('f-hinicio').value='';
  document.getElementById('f-fin').value='';
}

async function renderRouteSelect(){
  const sel=document.getElementById('f-ruta'); if(!sel) return;
  const routes=await getRoutes();
  sel.innerHTML='<option value="">— Seleccionar ruta —</option>';
  routes.forEach((r,i)=>{
    const opt=document.createElement('option');
    opt.value=i; opt.textContent=`${r.origen} → ${r.destino} (${fmtCLP(r.valor)})`;
    sel.appendChild(opt);
  });
  sel._routes=routes;
}

function applyRoute(){
  const sel=document.getElementById('f-ruta');
  const i=parseInt(sel.value);
  if(isNaN(i)||!sel._routes) return;
  const r=sel._routes[i]; if(!r) return;
  document.getElementById('f-desde').value=r.origen;
  document.getElementById('f-hasta').value=r.destino;
  document.getElementById('f-total').dataset.baseTotal=r.valor;
  updateReceiptTotal();
}

// ── Settings desde Supabase (con fallback a localStorage) ──
let _settingsCache = null;

async function loadSettings() {
  if (!useSupabase) {
    _settingsCache = LS.settings; return;
  }
  try {
    const rows = await sbFetch('settings?select=key,value');
    _settingsCache = {};
    rows.forEach(r => _settingsCache[r.key] = r.value);
  } catch(e) {
    _settingsCache = LS.settings;
  }
}

function getExtraStopValue() {
  return Number((_settingsCache||LS.settings).extraStopValue || 0);
}
function getWaitValue() {
  return Number((_settingsCache||LS.settings).waitValue || 0);
}

// ── Catálogos desde Supabase (con fallback a localStorage) ─
let _catalogsCache = null;

async function loadCatalogs() {
  if (!useSupabase) {
    _catalogsCache = LS.catalogs; return;
  }
  try {
    const rows = await sbFetch('catalogs?order=tipo.asc,valor.asc');
    const base  = { choferes:[], solicitantes:[], areas:[], empresas:[], costos:[] };
    rows.forEach(r => {
      if (base[r.tipo]) base[r.tipo].push(r.valor);
    });
    _catalogsCache = base;
  } catch(e) {
    _catalogsCache = LS.catalogs;
  }
}

// Calcula cuántas veces se cobra la espera: floor(minutos / 30)
function calcWaitUnits(minutos){ return Math.floor(Math.max(0, Number(minutos||0)) / 30); }

function syncBaseTotalFromManual(){
  const total=document.getElementById('f-total');
  total.dataset.baseTotal=Number(total.value||0);
}

function updateReceiptTotal(){
  const total  = document.getElementById('f-total');
  const base   = Number(total.dataset.baseTotal||total.value||0);
  const stops  = Math.max(0, Number(document.getElementById('f-paradas').value||0));
  const espera = document.getElementById('f-espera').value;
  const waitUnits = calcWaitUnits(espera);
  const nuevoTotal = base + (stops * getExtraStopValue()) + (waitUnits * getWaitValue());
  total.value = nuevoTotal;

  // Mostrar desglose si hay cobros adicionales
  let desglose = document.getElementById('total-desglose');
  if(!desglose){
    desglose = document.createElement('div');
    desglose.id = 'total-desglose';
    desglose.style.cssText = 'font-size:11px;color:var(--text2);margin-top:4px;line-height:1.7';
    total.parentNode.appendChild(desglose);
  }
  const lines = [];
  if(base)                              lines.push(`Base: ${fmtCLP(base)}`);
  if(stops > 0 && getExtraStopValue()) lines.push(`Paradas (${stops} × ${fmtCLP(getExtraStopValue())}): ${fmtCLP(stops * getExtraStopValue())}`);
  if(waitUnits > 0 && getWaitValue())  lines.push(`Espera (${waitUnits} × 30min × ${fmtCLP(getWaitValue())}): ${fmtCLP(waitUnits * getWaitValue())}`);
  desglose.innerHTML = lines.length > 1 ? lines.join('<br>') : '';
}

async function saveReceipt(){
  const fecha=document.getElementById('f-fecha').value;
  const chofer=document.getElementById('f-chofer').value.trim();
  const solicita=document.getElementById('f-solicita').value.trim();
  const total=document.getElementById('f-total').value;
  if(!fecha||!chofer||!solicita||!total){toast('Faltan campos obligatorios.');return;}
  const paradas=Math.max(0,Number(document.getElementById('f-paradas').value||0));
  const btn=document.getElementById('save-btn');
  btn.innerHTML='<span class="spin"></span> Guardando...'; btn.disabled=true;
  try{
    const count=await countReceipts();
    await addReceiptDB({
      num:count+1, vehiculo:selVehicle, fecha, chofer,
      area:document.getElementById('f-area').value,
      solicita, empresa:document.getElementById('f-empresa').value,
      costo:document.getElementById('f-costo').value,
      desde:document.getElementById('f-desde').value,
      hasta:document.getElementById('f-hasta').value,
      hinicio:document.getElementById('f-hinicio').value,
      espera:document.getElementById('f-espera').value,
      fin:document.getElementById('f-fin').value,
      detalle:document.getElementById('f-detalle').value,
      paradas_adicionales:paradas, total:Number(total)
    });
    toast('Recibo guardado ✓'); nav('recibos');
  }catch(e){ toast('Error: '+e.message); }
  btn.innerHTML='<i class="ti ti-check"></i> Guardar recibo'; btn.disabled=false;
}

async function renderReceipts(){
  const list=document.getElementById('receipt-list');
  list.innerHTML='<div class="empty"><i class="ti ti-refresh" style="opacity:.4;animation:spin .7s linear infinite"></i><br>Cargando...</div>';
  try{
    const receipts=(await getReceipts()).slice().reverse();
    if(!receipts.length){
      list.innerHTML='<div class="empty"><i class="ti ti-file-text"></i>Sin recibos aún.<br>Crea el primero en "Nuevo".</div>'; return;
    }
    list.innerHTML='<div class="card">'+receipts.map(r=>`
      <div class="ri" onclick="openReceipt('${r.id}')">
        <div class="rh">
          <div>
            <span class="rn">Recibo #${r.num}</span>
            ${r.vehiculo?`<span class="tag ${r.vehiculo}" style="margin-left:5px">${r.vehiculo}</span>`:''}
            <div class="rd">${fmtDate(r.fecha)}${r.desde&&r.hasta?' · '+escapeHTML(r.desde)+' → '+escapeHTML(r.hasta):''}</div>
            <div class="rw">${escapeHTML(r.solicita||'')}${r.empresa?' · '+escapeHTML(r.empresa):''}</div>
          </div>
          <div class="rtot">${fmtCLP(r.total)}</div>
        </div>
      </div>
    `).join('')+'</div>';
  }catch(e){ list.innerHTML='<div class="empty">Error al cargar recibos</div>'; }
}

async function openReceipt(id){
  const receipts=await getReceipts();
  const r=receipts.find(x=>String(x.id)===String(id)); if(!r) return;
  _curReceipt=r; curId=id;
  document.getElementById('modal-ttl').textContent='Recibo #'+r.num;
  const row=(l,v)=>v?`<tr><td style="color:var(--text2);padding:3px 0;font-size:12px;width:46%">${l}</td><td style="font-size:12px;padding:3px 0">${escapeHTML(String(v))}</td></tr>`:'';
  document.getElementById('modal-body').innerHTML=`
    <div style="margin-bottom:10px">
      ${r.vehiculo?`<span class="tag ${r.vehiculo}">${r.vehiculo}</span> `:''}
      <span style="font-size:12px;color:var(--text2)">${fmtDate(r.fecha)}</span>
    </div>
    <table style="width:100%;border-collapse:collapse">
      ${row('Chofer',r.chofer)}${row('Área',r.area)}${row('Solicita',r.solicita)}
      ${row('Empresa',r.empresa)}${row('Centro costo',r.costo)}
      ${row('Desde',r.desde)}${row('Hasta',r.hasta)}
      ${row('H. Inicio',r.hinicio)}${row('Tdo. Espera',r.espera?r.espera+' min':null)}${row('Fin servicio',r.fin)}
      ${row('Paradas adicionales',r.paradas_adicionales)}
      ${(Number(r.espera||0)>=30)?row('Cobro espera', calcWaitUnits(r.espera)+' × '+fmtCLP(getWaitValue())+' = '+fmtCLP(calcWaitUnits(r.espera)*getWaitValue())):''}
    </table>
    ${r.detalle?`<div style="margin-top:8px;font-size:12px;color:var(--text2);border-top:var(--border);padding-top:6px">${escapeHTML(r.detalle)}</div>`:''}
    <div style="margin-top:8px;border-top:var(--border);padding-top:8px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13px;font-weight:600">Total</span>
      <span style="font-size:18px;font-weight:700;color:#185FA5">${fmtCLP(r.total)}</span>
    </div>`;
  document.getElementById('detail-modal').classList.add('open');
}

function closeModal(){
  document.getElementById('detail-modal').classList.remove('open');
  curId=null; _curReceipt=null;
}

async function deleteReceipt(){
  if(!confirm('¿Eliminar este recibo?')) return;
  await delReceiptDB(curId); closeModal(); toast('Recibo eliminado'); renderReceipts();
}

// ── Rutas ─────────────────────────────────────────────────
async function addRoute(){
  const o=document.getElementById('r-origen').value.trim();
  const d=document.getElementById('r-destino').value.trim();
  const v=document.getElementById('r-valor').value;
  if(!o||!d||!v){toast('Completa todos los campos.');return;}
  try{
    await addRouteDB({origen:o,destino:d,valor:Number(v)});
    document.getElementById('r-origen').value='';
    document.getElementById('r-destino').value='';
    document.getElementById('r-valor').value='';
    toast('Ruta guardada ✓');
  }catch(e){ toast('Error: '+e.message); }
}

// ── 8. Órdenes de viaje ───────────────────────────────────
const ESTADO_STYLE = {
  pendiente:  { bg:'#FEF3CD', color:'#7C4E00', label:'Pendiente',  icon:'ti-clock'       },
  aceptada:   { bg:'#E1F5EE', color:'#085041', label:'Aceptada',   icon:'ti-check'       },
  rechazada:  { bg:'#FCEBEB', color:'#A32D2D', label:'Rechazada',  icon:'ti-x'           },
  completada: { bg:'#185FA5', color:'#ffffff', label:'Completada', icon:'ti-circle-check' }
};

async function renderOrdenes(){
  const list=document.getElementById('ordenes-list');
  if(!useSupabase){
    list.innerHTML='<div class="empty"><i class="ti ti-send"></i>Las órdenes de viaje requieren conexión a Supabase.</div>'; return;
  }
  list.innerHTML='<div class="empty"><i class="ti ti-refresh" style="opacity:.4;animation:spin .7s linear infinite"></i><br>Cargando...</div>';
  try{
    const ordenes=await getOrdenes();
    // Actualizar badge
    const pendientes=ordenes.filter(o=>o.estado==='pendiente').length;
    const badge=document.getElementById('ordenes-badge');
    badge.textContent=pendientes; badge.style.display=pendientes?'':'none';

    if(!ordenes.length){
      list.innerHTML='<div class="empty"><i class="ti ti-send"></i>No tienes órdenes de viaje asignadas.</div>'; return;
    }
    list.innerHTML=ordenes.map(o=>{
      const es=ESTADO_STYLE[o.estado]||ESTADO_STYLE.pendiente;
      return`<div class="card" style="margin-bottom:10px;cursor:pointer" onclick="openOrden('${o.id}')">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div>
            <span style="font-size:11px;font-weight:600;color:#185FA5">Orden de viaje</span>
            <div style="font-size:10px;color:var(--text2);margin-top:1px">${fmtDate(o.fecha)}${o.hinicio?' · '+o.hinicio:''}</div>
          </div>
          <span style="background:${es.bg};color:${es.color};font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px">
            <i class="ti ${es.icon}"></i> ${es.label}
          </span>
        </div>
        ${o.vehiculo?`<span class="tag ${o.vehiculo}" style="margin-bottom:6px;display:inline-flex">${o.vehiculo}</span>`:''}
        <div style="font-size:13px;font-weight:500">${escapeHTML(o.desde||'—')} → ${escapeHTML(o.hasta||'—')}</div>
        ${o.empresa?`<div style="font-size:11px;color:var(--text2);margin-top:3px">${escapeHTML(o.empresa)}</div>`:''}
        ${o.detalle?`<div style="font-size:11px;color:var(--text2);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(o.detalle)}</div>`:''}
        ${o.total?`<div style="font-size:14px;font-weight:600;color:#185FA5;margin-top:6px">${fmtCLP(o.total)}</div>`:''}
      </div>`;
    }).join('');
  }catch(e){ list.innerHTML='<div class="empty">Error al cargar órdenes</div>'; }
}

async function openOrden(id){
  const ordenes=await getOrdenes();
  const o=ordenes.find(x=>x.id===id); if(!o) return;
  _curOrdenId=id;
  _curOrden=o;   // guardar objeto completo
  const es=ESTADO_STYLE[o.estado]||ESTADO_STYLE.pendiente;
  document.getElementById('orden-modal-ttl').textContent='Orden de viaje';
  const row=(l,v)=>v?`<tr><td style="color:var(--text2);padding:3px 0;font-size:12px;width:46%">${l}</td><td style="font-size:12px;padding:3px 0">${escapeHTML(String(v))}</td></tr>`:'';
  document.getElementById('orden-modal-body').innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <span style="font-size:12px;color:var(--text2)">${fmtDate(o.fecha)}</span>
      <span style="background:${es.bg};color:${es.color};font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px">
        <i class="ti ${es.icon}"></i> ${es.label}
      </span>
    </div>
    ${o.vehiculo?`<span class="tag ${o.vehiculo}" style="margin-bottom:10px;display:inline-flex">${o.vehiculo}</span>`:''}
    <table style="width:100%;border-collapse:collapse">
      ${row('Chofer',o.chofer)}${row('Área',o.area)}
      ${row('Solicita',o.solicita)}
      ${row('Empresa',o.empresa)}${row('Centro costo',o.costo)}
      ${row('Desde',o.desde)}${row('Hasta',o.hasta)}
      ${row('H. Inicio',o.hinicio)}
    </table>
    ${o.detalle?`<div style="margin-top:8px;font-size:12px;color:var(--text2);border-top:var(--border);padding-top:6px">${escapeHTML(o.detalle)}</div>`:''}
    ${o.motivo_rechazo?`<div style="margin-top:8px;background:#FCEBEB;border-radius:8px;padding:8px 10px;font-size:12px;color:#A32D2D"><strong>Motivo de rechazo:</strong> ${escapeHTML(o.motivo_rechazo)}</div>`:''}
    ${o.total?`<div style="margin-top:8px;border-top:var(--border);padding-top:8px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13px;font-weight:600">Total estimado</span>
      <span style="font-size:18px;font-weight:700;color:#185FA5">${fmtCLP(o.total)}</span>
    </div>`:''}`;

  // Acciones según estado
  const actions=document.getElementById('orden-modal-actions');
  if(o.estado==='pendiente'){
    actions.innerHTML=`
      <div class="r2">
        <button class="btn danger" onclick="abrirRechazo()"><i class="ti ti-x"></i> Rechazar</button>
        <button class="btn primary" onclick="aceptarOrden()"><i class="ti ti-check"></i> Aceptar</button>
      </div>
      <div class="sep"></div>
      <button class="btn" onclick="closeOrdenModal()">Cerrar</button>`;
  } else if(o.estado==='aceptada'){
    actions.innerHTML=`
      <button class="btn primary" style="width:100%;background:#0F6E56;border-color:#0F6E56;justify-content:center" onclick="completarOrden()">
        <i class="ti ti-circle-check"></i> Viaje realizado — Convertir en recibo
      </button>
      <div class="sep"></div>
      <button class="btn" onclick="closeOrdenModal()">Cerrar</button>`;
  } else {
    actions.innerHTML=`<button class="btn" style="width:100%" onclick="closeOrdenModal()">Cerrar</button>`;
  }
  document.getElementById('orden-modal').classList.add('open');
}

function closeOrdenModal(){
  document.getElementById('orden-modal').classList.remove('open');
  _curOrdenId=null;
  _curOrden=null;
}

async function aceptarOrden(){
  if(!_curOrdenId) return;
  const btn=document.querySelector('#orden-modal-actions .btn.primary');
  if(btn){btn.disabled=true;btn.innerHTML='<span class="spin"></span> Guardando...';}
  try{
    await responderOrden(_curOrdenId,'aceptada');
    toast('Orden aceptada ✓'); closeOrdenModal(); renderOrdenes();
  }catch(e){ toast('Error: '+e.message); }
}

function abrirRechazo(){
  document.getElementById('rechazo-motivo').value='';
  document.getElementById('rechazo-modal').classList.add('open');
}

function closeRechazoModal(){
  document.getElementById('rechazo-modal').classList.remove('open');
}

async function confirmarRechazo(){
  const motivo=document.getElementById('rechazo-motivo').value.trim();
  if(!motivo){toast('Escribe el motivo del rechazo');return;}
  const btn=document.getElementById('rechazo-btn');
  btn.disabled=true; btn.innerHTML='<span class="spin"></span> Enviando...';
  try{
    await responderOrden(_curOrdenId,'rechazada',motivo);
    toast('Orden rechazada'); closeRechazoModal(); closeOrdenModal(); renderOrdenes();
  }catch(e){ toast('Error: '+e.message); }
  btn.disabled=false; btn.innerHTML='<i class="ti ti-x"></i> Confirmar rechazo';
}

async function completarOrden(){
  if(!_curOrden) return;
  const o = _curOrden;

  // Mostrar resumen de la orden en el modal de confirmación
  const lines = [
    o.fecha     ? `📅 Fecha: ${fmtDate(o.fecha)}`         : '',
    o.vehiculo  ? `🚗 Vehículo: ${o.vehiculo}`             : '',
    o.chofer    ? `👤 Chofer: ${o.chofer}`                 : '',
    o.desde&&o.hasta ? `📍 Ruta: ${o.desde} → ${o.hasta}` : '',
    o.empresa   ? `🏢 Empresa: ${o.empresa}`               : '',
    o.total     ? `💰 Total: ${fmtCLP(o.total)}`           : '',
  ].filter(Boolean);

  document.getElementById('completar-resumen').innerHTML =
    lines.map(l=>`<div>${escapeHTML(l)}</div>`).join('');

  // Resetear botón por si venía de un intento anterior
  const btn = document.getElementById('completar-btn');
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-circle-check"></i> Sí, crear recibo';

  document.getElementById('completar-modal').classList.add('open');
}

function closeCompletarModal(){
  document.getElementById('completar-modal').classList.remove('open');
}

async function ejecutarCompletar(){
  if(!_curOrdenId || !_curOrden) return;
  const o = _curOrden;
  const btn = document.getElementById('completar-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> Creando recibo...';

  try{
    // 1. Crear recibo con los datos de la orden
    const count = await countReceipts();
    const recibo = await addReceiptDB({
      num:                count + 1,
      vehiculo:           o.vehiculo  || '',
      fecha:              o.fecha,
      chofer:             o.chofer    || '',
      area:               o.area      || '',
      solicita:           o.solicita  || o.empresa || '',
      empresa:            o.empresa   || '',
      costo:              o.costo     || '',
      desde:              o.desde     || '',
      hasta:              o.hasta     || '',
      hinicio:            o.hinicio   || '',
      espera:             '',
      fin:                '',
      detalle:            o.detalle   || '',
      paradas_adicionales: 0,
      total:              Number(o.total || 0)
    });

    // 2. Eliminar la orden (ya no la necesitamos, el recibo es el registro oficial)
    await sbFetch('ordenes?id=eq.'+_curOrdenId, { method:'DELETE' });

    closeCompletarModal();
    closeOrdenModal();
    toast('Recibo #'+recibo.num+' creado ✓', 3500);
    renderOrdenes();
    setTimeout(()=>nav('recibos'), 700);
  }catch(e){
    toast('Error al crear recibo: '+e.message, 4000);
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-circle-check"></i> Sí, crear recibo';
  }
}

// Badge de pendientes al iniciar
async function checkOrdenesbadge(){
  if(!useSupabase||!currentUser) return;
  try{
    const ordenes=await getOrdenes();
    const pendientes=ordenes.filter(o=>o.estado==='pendiente').length;
    const badge=document.getElementById('ordenes-badge');
    badge.textContent=pendientes; badge.style.display=pendientes?'':'none';
  }catch(e){}
}

// ── 9. Resumen ────────────────────────────────────────────
function toggleChip(btn,val){
  document.querySelectorAll('#veh-filter .chip').forEach(c=>c.classList.remove('on'));
  btn.classList.add('on'); vehFilter=val;
}

async function calcSummary(){
  const from=document.getElementById('sum-from').value;
  const to=document.getElementById('sum-to').value;
  let receipts=await getReceipts();
  if(from) receipts=receipts.filter(r=>r.fecha>=from);
  if(to)   receipts=receipts.filter(r=>r.fecha<=to);
  if(vehFilter!=='todos') receipts=receipts.filter(r=>r.vehiculo===vehFilter);
  const total=receipts.reduce((a,r)=>a+Number(r.total||0),0);
  const byVeh={}; receipts.forEach(r=>{const v=r.vehiculo||'Sin tipo';byVeh[v]=(byVeh[v]||0)+Number(r.total||0);});
  const cont=document.getElementById('summary-results');
  if(!receipts.length){cont.innerHTML='<div class="card"><div class="empty" style="padding:14px">Sin resultados para ese período</div></div>';return;}
  cont.innerHTML=`
    <div class="sg">
      <div class="st"><div class="sl">Total recibos</div><div class="sv">${receipts.length}</div></div>
      <div class="st"><div class="sl">Total ($)</div><div class="sv blue">${fmtCLP(total)}</div></div>
    </div>
    <div class="card">
      <div class="ct">Por tipo de vehículo</div>
      ${Object.entries(byVeh).map(([v,t])=>`<div class="tr"><span style="font-size:12px">${v}</span><span style="font-size:13px;font-weight:600">${fmtCLP(t)}</span></div>`).join('<div class="hr"></div>')}
    </div>
    <div class="card">
      <div class="ct">Recibos del período</div>
      ${receipts.slice().reverse().map(r=>`
        <div class="ri" onclick="openReceipt('${r.id}')">
          <div class="rh">
            <div>
              <span class="rn">#${r.num}</span>
              <span class="rd" style="margin-left:5px">${fmtDate(r.fecha)}</span>
              <div class="rd">${escapeHTML(r.solicita||'')}${r.empresa?' · '+escapeHTML(r.empresa):''}</div>
            </div>
            <div style="font-size:13px;font-weight:600">${fmtCLP(r.total)}</div>
          </div>
        </div>`).join('')}
    </div>`;
}

// ── 10. PDF ───────────────────────────────────────────────
function exportPDF(){
  if(!_curReceipt){toast('Sin recibo seleccionado');return;}
  if(!jsPDF){toast('jsPDF no cargó');return;}
  const r=_curReceipt;
  const doc=new jsPDF({unit:'mm',format:'a5',orientation:'portrait'});
  const W=148,M=14;
  doc.setFillColor(24,95,165);doc.rect(0,0,W,20,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(14);doc.setTextColor(255,255,255);
  doc.text('RECIBO DE SERVICIO',W/2,11,{align:'center'});
  doc.setFontSize(8);doc.setFont('helvetica','normal');
  doc.text('TransferLog · Traslado de Personal',W/2,16.5,{align:'center'});
  let y=27;
  const box=(label,val,x,cy)=>{
    if(!val) return;
    doc.setFontSize(7);doc.setFont('helvetica','normal');doc.setTextColor(110,110,110);doc.text(label,x,cy);
    doc.setFontSize(9);doc.setTextColor(20,20,20);doc.text(String(val),x,cy+5);
  };
  const hl=()=>{doc.setDrawColor(220,220,220);doc.setLineWidth(0.2);doc.line(M,y-1,W-M,y-1);};
  if(r.vehiculo){doc.setFontSize(8);doc.setTextColor(24,95,165);doc.setFont('helvetica','bold');doc.text('● '+r.vehiculo,M,y);y+=7;}
  box('Fecha',fmtDate(r.fecha),M,y);box('Chofer',r.chofer,M+38,y);box('Área',r.area,M+90,y);y+=11;hl();y+=3;
  box('Solicita',r.solicita,M,y);box('Empresa',r.empresa,M+65,y);y+=11;hl();y+=3;
  box('Centro de costo',r.costo,M,y);y+=11;hl();y+=3;
  box('Traslado desde',r.desde,M,y);box('Hasta',r.hasta,M+65,y);y+=11;hl();y+=3;
  box('H. Inicio',r.hinicio,M,y);box('Tdo. Espera',r.espera?(r.espera+' min'):'',M+38,y);box('Fin servicio',r.fin,M+78,y);y+=11;hl();y+=3;
  if(Number(r.paradas_adicionales||0)>0){box('Paradas adicionales',r.paradas_adicionales,M,y);y+=11;hl();y+=3;}
  if(Number(r.espera||0)>=30){
    const wu=calcWaitUnits(r.espera);
    box('Cobro espera ('+wu+' × 30min)',fmtCLP(wu*getWaitValue()),M,y);y+=11;hl();y+=3;
  }
  if(r.detalle){
    doc.setFontSize(7);doc.setTextColor(110,110,110);doc.setFont('helvetica','normal');doc.text('Detalle del servicio',M,y);y+=4;
    doc.setFontSize(8);doc.setTextColor(20,20,20);
    const lines=doc.splitTextToSize(r.detalle,W-2*M);doc.text(lines,M,y);y+=lines.length*4+5;hl();y+=3;
  }
  doc.setFillColor(230,241,251);doc.roundedRect(M,y,W-2*M,15,2,2,'F');
  doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(24,95,165);doc.text('TOTAL',M+4,y+6);
  doc.setFontSize(14);doc.setFont('helvetica','bold');doc.text(fmtCLP(r.total),W-M-4,y+10,{align:'right'});
  y+=20;
  doc.setDrawColor(180,180,180);doc.setLineWidth(0.3);doc.line(M,y+8,M+55,y+8);
  doc.setFontSize(7);doc.setTextColor(150,150,150);doc.setFont('helvetica','normal');
  doc.text('Firma',M,y+12);
  doc.text('Recibo #'+r.num+' · '+new Date().toLocaleDateString('es-CL'),W-M,y+12,{align:'right'});
  doc.save('recibo-'+r.num+'-'+r.fecha+'.pdf');
  toast('PDF descargado ✓');
}

async function exportSummaryPDF(){
  if(!jsPDF){toast('jsPDF no disponible');return;}
  const from=document.getElementById('sum-from').value;
  const to=document.getElementById('sum-to').value;
  let receipts=await getReceipts();
  if(from) receipts=receipts.filter(r=>r.fecha>=from);
  if(to)   receipts=receipts.filter(r=>r.fecha<=to);
  if(vehFilter!=='todos') receipts=receipts.filter(r=>r.vehiculo===vehFilter);
  if(!receipts.length){toast('Sin datos para exportar');return;}
  const total=receipts.reduce((a,r)=>a+Number(r.total||0),0);
  const doc=new jsPDF({unit:'mm',format:'a4'});
  const W=210,M=14;
  doc.setFillColor(24,95,165);doc.rect(0,0,W,22,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(16);doc.setTextColor(255,255,255);
  doc.text('RESUMEN DE SERVICIOS DE TRANSPORTE',W/2,13,{align:'center'});
  doc.setFontSize(9);doc.setFont('helvetica','normal');
  doc.text(`Período: ${from?fmtDate(from):'inicio'} — ${to?fmtDate(to):'hoy'}`,W/2,18.5,{align:'center'});
  let y=30;
  doc.setFillColor(230,241,251);doc.roundedRect(M,y,87,16,2,2,'F');
  doc.setFontSize(8);doc.setTextColor(24,95,165);doc.text('Total recibos',M+4,y+6);
  doc.setFontSize(14);doc.setFont('helvetica','bold');doc.text(String(receipts.length),M+4,y+13);
  doc.setFillColor(225,245,238);doc.roundedRect(M+92,y,90,16,2,2,'F');
  doc.setFontSize(8);doc.setTextColor(15,110,86);doc.text('Monto total',M+96,y+6);
  doc.setFontSize(14);doc.setFont('helvetica','bold');doc.setTextColor(15,110,86);doc.text(fmtCLP(total),M+96,y+13);
  y+=24;
  // Columnas: # | Fecha | Detalle | Empresa | Vehículo | Desde | Hasta | Total
  const cols=['#','Fecha','Detalle','Empresa','Vehículo','Desde','Hasta','Total'];
  const xs=[M,M+10,M+26,M+82,M+118,M+138,M+158,M+176];
  doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(80,80,80);
  cols.forEach((h,i)=>doc.text(h,xs[i],y));
  y+=2;doc.setDrawColor(24,95,165);doc.setLineWidth(0.5);doc.line(M,y,W-M,y);y+=4;
  doc.setFont('helvetica','normal');doc.setFontSize(7.5);
  receipts.forEach((r,idx)=>{
    const detalleRaw=(r.detalle||'').replace(/\n/g,' ').trim();
    const detalle=detalleRaw.length>28?detalleRaw.substring(0,27)+'…':detalleRaw;
    if(idx%2===0){doc.setFillColor(248,249,250);doc.rect(M,y-3,W-2*M,7,'F');}
    doc.setTextColor(30,30,30);
    [String(r.num||''),fmtDate(r.fecha),detalle,
     (r.empresa||'').substring(0,16),(r.vehiculo||''),
     (r.desde||'').substring(0,10),(r.hasta||'').substring(0,10),fmtCLP(r.total)]
    .forEach((v,i)=>doc.text(v,xs[i],y+1));
    y+=7;if(y>272){doc.addPage();y=20;}
  });
  doc.setDrawColor(200,200,200);doc.setLineWidth(0.3);doc.line(M,y,W-M,y);y+=5;
  doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(24,95,165);
  doc.text('TOTAL: '+fmtCLP(total),W-M,y,{align:'right'});y+=10;
  doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(160,160,160);
  doc.text('Generado el '+new Date().toLocaleDateString('es-CL')+' · TransferLog',W/2,y,{align:'center'});
  doc.save('resumen-transferlog-'+new Date().toISOString().split('T')[0]+'.pdf');
  toast('PDF resumen descargado ✓');
}

// ── 11. Configuración ─────────────────────────────────────
// Los valores de cobro y catálogos ahora se gestionan desde
// el panel de administración. La app los carga al iniciar.

function clearLocal(){
  if(!confirm('¿Eliminar todos los datos locales?')) return;
  localStorage.removeItem('tl_r');localStorage.removeItem('tl_p');
  localStorage.removeItem('tl_catalogs');localStorage.removeItem('tl_settings');
  toast('Datos locales eliminados'); renderReceipts();
}

function renderCatalogControls(){
  const catalogs = _catalogsCache || LS.catalogs;
  const selectMap={
    choferes:{id:'f-chofer',placeholder:'Seleccionar chofer'},
    areas:{id:'f-area',placeholder:'Seleccionar área'},
    solicitantes:{id:'f-solicita',placeholder:'Seleccionar solicitante'},
    empresas:{id:'f-empresa',placeholder:'Seleccionar empresa'},
    costos:{id:'f-costo',placeholder:'Seleccionar centro de costo'}
  };
  Object.entries(selectMap).forEach(([key,cfg])=>{
    const select=document.getElementById(cfg.id); if(!select) return;
    const current=select.value;
    const options=(catalogs[key]||[]).map(v=>`<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join('');
    select.innerHTML=`<option value="">— ${cfg.placeholder} —</option>${options}`;
    if((catalogs[key]||[]).includes(current)) select.value=current;
  });
}

function renderCatalogs(){} // catálogos gestionados desde admin

// ── Cerrar modales al tocar fondo ─────────────────────────
['detail-modal','orden-modal','rechazo-modal','completar-modal'].forEach(id=>{
  const el=document.getElementById(id);
  if(el) el.addEventListener('click',function(e){if(e.target===this) this.classList.remove('open');});
});

// ── 12. Init ──────────────────────────────────────────────
const today=new Date().toISOString().split('T')[0];
document.getElementById('sum-from').value=today.substring(0,8)+'01';
document.getElementById('sum-to').value=today;

async function initApp(){
  if(!_sb){ renderReceipts(); return; }
  try{
    const { data:{ session } } = await _sb.auth.getSession();
    if(session?.user){
      currentUser=session.user; useSupabase=true;
      document.getElementById('db-badge').textContent='● Supabase';
      document.getElementById('db-badge').className='db-badge ok';
    } else {
      document.getElementById('db-badge').textContent='● Local';
      document.getElementById('db-badge').className='db-badge off';
    }
  }catch(e){
    document.getElementById('db-badge').textContent='● Local';
    document.getElementById('db-badge').className='db-badge off';
  }

  // Cargar settings y catálogos desde Supabase (o localStorage como fallback)
  await Promise.all([ loadSettings(), loadCatalogs() ]);

  renderCatalogControls();
  initForm();
  renderReceipts();
  checkOrdenesbadge();
}

initApp();
