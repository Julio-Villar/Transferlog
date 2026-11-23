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
  get fuel()      { try{return JSON.parse(localStorage.getItem('tl_fuel')||'[]')}catch{return[]} },
  set fuel(v)     { localStorage.setItem('tl_fuel',JSON.stringify(v)) },
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
  if(s==='nuevo')    { if(!_formReady){ initForm(); restoreDraft(); _formReady=true; } renderRouteSelect(); }
  if(s==='ordenes')  renderOrdenes();
  if(s==='resumen')  {}
}

// ── 6. Recibos ────────────────────────────────────────────
function selVeh(v){
  selVehicle=v;
  document.querySelectorAll('.vo').forEach(b=>b.classList.remove('sel'));
  document.getElementById('v-'+v).classList.add('sel');
  saveDraft();
}

function initForm(){
  const today=localToday();
  document.getElementById('f-fecha').value=today;
  selVehicle='';
  document.querySelectorAll('.vo').forEach(b=>b.classList.remove('sel'));
  ['f-desde','f-hasta','f-espera','f-detalle','f-total'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  // Limpiar desglose de total
  const desglose=document.getElementById('total-desglose');
  if(desglose) desglose.innerHTML='';
  // Resetear cronómetro del formulario
  cronoReset('form', true);
  const _bn=document.getElementById('draft-banner'); if(_bn) _bn.style.display='none';
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
function getNightValue(){ return Number((_settingsCache||LS.settings).nightValue||0); }
function getNightFrom(){ return (_settingsCache||LS.settings).nightFrom||'22:00'; }
function getNightTo(){   return (_settingsCache||LS.settings).nightTo  ||'06:00'; }

// Devuelve true si la hora HH:MM cae en la franja nocturna
function isNocturno(hora){
  if(!hora||!getNightValue()) return false;
  const toMins = h=>{ const[hh,mm]=(h||'00:00').split(':'); return Number(hh)*60+Number(mm); };
  const t=toMins(hora), from=toMins(getNightFrom()), to=toMins(getNightTo());
  if(from>to) return t>=from||t<to;   // cruza medianoche
  return t>=from&&t<to;               // mismo día
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
  const total   = document.getElementById('f-total');
  const base    = Number(total.dataset.baseTotal||total.value||0);
  const stops   = Math.max(0, Number(document.getElementById('f-paradas').value||0));
  const espera  = document.getElementById('f-espera').value;
  const hinicio = document.getElementById('f-hinicio').value;
  const waitUnits  = calcWaitUnits(espera);
  const nightCost  = isNocturno(hinicio) ? getNightValue() : 0;
  const nuevoTotal = base + (stops * getExtraStopValue()) + (waitUnits * getWaitValue()) + nightCost;
  total.value = nuevoTotal;

  // Mostrar desglose
  let desglose = document.getElementById('total-desglose');
  if(!desglose){
    desglose = document.createElement('div');
    desglose.id = 'total-desglose';
    desglose.style.cssText = 'font-size:11px;color:var(--text2);margin-top:4px;line-height:1.7';
    total.parentNode.appendChild(desglose);
  }
  const lines = [];
  if(base)                              lines.push(`Base: ${fmtCLP(base)}`);
  if(stops>0 && getExtraStopValue())   lines.push(`Paradas (${stops} × ${fmtCLP(getExtraStopValue())}): ${fmtCLP(stops*getExtraStopValue())}`);
  if(waitUnits>0 && getWaitValue())    lines.push(`Espera (${waitUnits} × 30min × ${fmtCLP(getWaitValue())}): ${fmtCLP(waitUnits*getWaitValue())}`);
  if(nightCost)                        lines.push(`🌙 Nocturno (${hinicio}): ${fmtCLP(nightCost)}`);
  desglose.innerHTML = lines.length>1 ? lines.join('<br>') : '';
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
    toast('Recibo guardado ✓'); clearDraft(); initForm(); nav('recibos');
  }catch(e){ toast('Error: '+e.message); }
  btn.innerHTML='<i class="ti ti-check"></i> Guardar recibo'; btn.disabled=false;
}

// La pestaña "Recibos" ahora es el Dashboard. Se conserva el nombre renderReceipts()
// para no tener que cambiar las demás funciones que ya la llaman.
function renderReceipts(){ return renderDashboard(); }

async function openReceipt(id){
  let r=_dashRecent.find(x=>String(x.id)===String(id));
  if(!r){ const receipts=await getReceipts(); r=receipts.find(x=>String(x.id)===String(id)); }
  if(!r) return;
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

  // Resumen de la orden
  const lines = [
    o.fecha     ? `📅 Fecha: ${fmtDate(o.fecha)}`           : '',
    o.vehiculo  ? `🚗 Vehículo: ${o.vehiculo}`               : '',
    o.chofer    ? `👤 Chofer: ${o.chofer}`                   : '',
    o.desde&&o.hasta ? `📍 Ruta: ${o.desde} → ${o.hasta}`   : '',
    o.empresa   ? `🏢 Empresa: ${o.empresa}`                 : '',
  ].filter(Boolean);
  document.getElementById('completar-resumen').innerHTML =
    lines.map(l=>`<div>${escapeHTML(l)}</div>`).join('');

  // Pre-llenar campos con datos de la orden
  document.getElementById('comp-hinicio').value = o.hinicio || '';
  document.getElementById('comp-fin').value     = '';
  document.getElementById('comp-espera').value  = '';
  document.getElementById('comp-total').value   = o.total || '';

  // Mostrar hint del total base
  const hint = document.getElementById('comp-total-hint');
  hint.textContent = o.total ? `(base: ${fmtCLP(o.total)})` : '';

  // Resetear botón y cronómetro del modal
  const btn = document.getElementById('completar-btn');
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-circle-check"></i> Crear recibo';
  // ¿Hay un borrador de ESTA orden (cronómetro o datos a medio ingresar)?
  let saved=null;
  try{ saved=JSON.parse(localStorage.getItem(compKey())||'null'); }catch(e){}
  if(saved && saved.ordenId===o.id){
    _restoring=true;
    try{
      document.getElementById('comp-hinicio').value = saved.hinicio ?? '';
      document.getElementById('comp-fin').value     = saved.fin     ?? '';
      document.getElementById('comp-espera').value  = saved.espera  ?? '';
      document.getElementById('comp-total').value   = saved.total   ?? '';
      Object.assign(_cr.modal,{ llegadaTs:saved.cr?.llegadaTs||null, inicioTs:saved.cr?.inicioTs||null, finTs:saved.cr?.finTs||null });
      _renderCrono('modal');
      if(_cr.modal.llegadaTs && !_cr.modal.finTs) wakeOn();
    } finally { _restoring=false; }
  } else {
    cronoReset('modal', true);
    clearCompDraft();
  }

  document.getElementById('completar-modal').classList.add('open');
}

function recalcCompTotal(){
  const espera    = Number(document.getElementById('comp-espera').value || 0);
  const hinicio   = document.getElementById('comp-hinicio').value;
  const base      = Number(_curOrden?.total || 0);
  const waitUnits = calcWaitUnits(espera);
  const waitCost  = waitUnits * getWaitValue();
  const nightCost = isNocturno(hinicio) ? getNightValue() : 0;
  const nuevo     = base + waitCost + nightCost;
  document.getElementById('comp-total').value = nuevo || base || '';
  const hint = document.getElementById('comp-total-hint');
  const parts = [];
  if(waitCost)  parts.push(`espera ${fmtCLP(waitCost)}`);
  if(nightCost) parts.push(`🌙 nocturno ${fmtCLP(nightCost)}`);
  hint.textContent = parts.length
    ? `(base ${fmtCLP(base)} + ${parts.join(' + ')})`
    : base ? `(base: ${fmtCLP(base)})` : '';
}

function closeCompletarModal(){
  document.getElementById('completar-modal').classList.remove('open');
}

async function ejecutarCompletar(){
  if(!_curOrdenId || !_curOrden) return;
  const o = _curOrden;

  // Leer campos corregidos del modal
  const hinicio = document.getElementById('comp-hinicio').value;
  const fin     = document.getElementById('comp-fin').value;
  const espera  = document.getElementById('comp-espera').value;
  const total   = Number(document.getElementById('comp-total').value || o.total || 0);

  const btn = document.getElementById('completar-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> Creando recibo...';

  try{
    // 1. Marcar orden como completada
    const patchRes = await sbFetch('ordenes?id=eq.'+_curOrdenId, {
      method: 'PATCH',
      body: JSON.stringify({
        estado: 'completada',
        completada_at: new Date().toISOString()
      })
    });
    // Verificar que el PATCH realmente actualizó el registro
    const verificar = await sbFetch('ordenes?id=eq.'+_curOrdenId+'&select=estado');
    if (!verificar.length || verificar[0].estado !== 'completada') {
      throw new Error('No se pudo actualizar el estado de la orden. Verifica los permisos en Supabase.');
    }

    // 2. Crear recibo con datos de la orden + correcciones del usuario
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
      hinicio:            hinicio     || o.hinicio || '',
      espera:             espera      || '',
      fin:                fin         || '',
      detalle:            o.detalle   || '',
      paradas_adicionales: 0,
      total
    });

    clearCompDraft(); cronoReset('modal', true);
    closeCompletarModal();
    closeOrdenModal();
    toast('Recibo #'+recibo.num+' creado ✓', 3500);
    renderOrdenes();
    setTimeout(()=>nav('recibos'), 700);
  }catch(e){
    toast('Error: '+e.message, 4000);
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-circle-check"></i> Crear recibo';
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
// Dibuja un recibo completo (formato A5) en la página actual del documento
function drawReceiptPage(doc, r){
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
}

function exportPDF(){
  if(!_curReceipt){toast('Sin recibo seleccionado');return;}
  if(!jsPDF){toast('jsPDF no cargó');return;}
  const r=_curReceipt;
  const doc=new jsPDF({unit:'mm',format:'a5',orientation:'portrait'});
  drawReceiptPage(doc, r);
  doc.save('recibo-'+r.num+'-'+r.fecha+'.pdf');
  toast('PDF descargado ✓');
}

// Un solo PDF con varios recibos (uno por página) según rango de fechas y vehículo
async function exportReceiptsRangePDF(){
  if(!jsPDF){toast('jsPDF no disponible');return;}
  const from=document.getElementById('sum-from').value;
  const to=document.getElementById('sum-to').value;
  let receipts=await getReceipts();
  if(from) receipts=receipts.filter(r=>r.fecha>=from);
  if(to)   receipts=receipts.filter(r=>r.fecha<=to);
  if(vehFilter!=='todos') receipts=receipts.filter(r=>r.vehiculo===vehFilter);
  if(!receipts.length){toast('Sin recibos en ese período');return;}
  receipts.sort((a,b)=>(a.fecha||'').localeCompare(b.fecha||'')||(a.num||0)-(b.num||0));

  const doc=new jsPDF({unit:'mm',format:'a5',orientation:'portrait'});
  receipts.forEach((r,i)=>{
    if(i>0) doc.addPage('a5','portrait');
    drawReceiptPage(doc, r);
  });
  doc.save('recibos-'+(from||'inicio')+'_a_'+(to||'hoy')+'.pdf');
  toast(receipts.length+' recibos exportados ✓');
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

  // Landscape A4 — 297mm ancho, más espacio para Ruta
  const doc=new jsPDF({unit:'mm',format:'a4',orientation:'landscape'});
  const W=297,M=12;

  // Encabezado
  doc.setFillColor(24,95,165);doc.rect(0,0,W,22,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(15);doc.setTextColor(255,255,255);
  doc.text('RESUMEN DE SERVICIOS DE TRANSPORTE',W/2,13,{align:'center'});
  doc.setFontSize(8);doc.setFont('helvetica','normal');
  doc.text(`Período: ${from?fmtDate(from):'inicio'} — ${to?fmtDate(to):'hoy'} · Generado el ${new Date().toLocaleDateString('es-CL')}`,W/2,18.5,{align:'center'});

  let y=30;
  // Stats
  doc.setFillColor(230,241,251);doc.roundedRect(M,y,65,16,2,2,'F');
  doc.setFontSize(8);doc.setTextColor(24,95,165);doc.text('Total recibos',M+4,y+6);
  doc.setFontSize(13);doc.setFont('helvetica','bold');doc.text(String(receipts.length),M+4,y+13);
  doc.setFillColor(225,245,238);doc.roundedRect(M+70,y,85,16,2,2,'F');
  doc.setFontSize(8);doc.setTextColor(15,110,86);doc.text('Monto total',M+74,y+6);
  doc.setFontSize(13);doc.setFont('helvetica','bold');doc.setTextColor(15,110,86);
  doc.text(fmtCLP(total),M+74,y+13);
  y+=24;

  // Columnas — ancho total útil ~273mm (297 - 2×12)
  // Fecha:18 | Ruta(desde→hasta):80 | Detalle:60 | Solicita:40 | C.Costo:20 | Valor:28
  const cols=['Fecha','Ruta (Desde → Hasta)','Detalle','Solicita','C.Costo','Valor'];
  const xs  =[M, M+20, M+102, M+164, M+207, M+227];

  doc.setFont('helvetica','bold');doc.setFontSize(7.5);doc.setTextColor(60,60,60);
  doc.setFillColor(225,232,242);doc.rect(M,y-4,W-2*M,8,'F');
  cols.forEach((h,i)=>doc.text(h,xs[i],y));
  y+=2;doc.setDrawColor(24,95,165);doc.setLineWidth(0.5);doc.line(M,y,W-M,y);y+=4;

  doc.setFont('helvetica','normal');doc.setFontSize(7);
  receipts.forEach((r,idx)=>{
    if(idx%2===0){doc.setFillColor(248,249,250);doc.rect(M,y-3,W-2*M,7,'F');}
    doc.setTextColor(30,30,30);

    // Ruta: desde → hasta — hasta 38 chars cada parte
    const desde  = (r.desde||'').substring(0,36);
    const hasta  = (r.hasta||'').substring(0,36);
    const ruta   = hasta ? desde+' → '+hasta : desde;

    const detalle  = (r.detalle||'').replace(/\n/g,' ').substring(0,32);
    const solicita = (r.solicita||'').substring(0,22);
    const costo    = (r.costo||'').substring(0,8); // Centro costo al mínimo

    [
      fmtDate(r.fecha),
      ruta,
      detalle,
      solicita,
      costo,
      fmtCLP(r.total)
    ].forEach((v,i)=>doc.text(v,xs[i],y+1));

    y+=7;
    if(y>190){doc.addPage();y=20;}
  });

  doc.setDrawColor(200,200,200);doc.setLineWidth(0.3);doc.line(M,y,W-M,y);y+=5;
  doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(24,95,165);
  doc.text('TOTAL: '+fmtCLP(total),W-M,y,{align:'right'});y+=8;
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
['detail-modal','orden-modal','rechazo-modal','completar-modal','fuel-modal'].forEach(id=>{
  const el=document.getElementById(id);
  if(el) el.addEventListener('click',function(e){if(e.target===this) this.classList.remove('open');});
});

// ══════════════════════════════════════════════════════════
// DASHBOARD + CONTROL DE COMBUSTIBLE
// ══════════════════════════════════════════════════════════
const FUEL_ALERT_PCT = 15;   // alerta si el último tramo rinde este % MENOS que tu promedio anterior

// Fecha de HOY en hora local. (toISOString() usa UTC: de noche en Chile daría el día siguiente)
function localToday(){
  const d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function dateAddDays(str,n){
  const [y,m,d]=str.split('-').map(Number), dt=new Date(Date.UTC(y,m-1,d+n));
  return dt.getUTCFullYear()+'-'+String(dt.getUTCMonth()+1).padStart(2,'0')+'-'+String(dt.getUTCDate()).padStart(2,'0');
}
const fmtNum=(n,d=1)=>Number(n).toLocaleString('es-CL',{minimumFractionDigits:d,maximumFractionDigits:d});
const normPat=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const fmtLitros=n=>Number(n).toLocaleString('es-CL',{maximumFractionDigits:2});

// Acepta coma o punto como separador decimal (el teclado del celular puede mostrar cualquiera)
function parseDec(v){ const n=Number(String(v==null?'':v).trim().replace(',','.')); return isFinite(n)?n:NaN; }
function decFilter(el){ el.value=el.value.replace(/[^0-9.,]/g,''); }

// ── Período de trabajo ──
// Empieza el día N de un mes y termina el día N-1 del mes siguiente (ej.: N=20 → del 20 al 19).
// N=1 equivale al mes calendario. N va de 1 a 28 para que exista en todos los meses.
function workPeriod(todayStr,startDay){
  const sd=Math.min(28,Math.max(1,Math.round(Number(startDay))||1));
  const [y,m,d]=todayStr.split('-').map(Number);
  const mi=d>=sd ? m-1 : m-2;                       // mes (base 0) en que empezó el período vigente
  const iso=t=>t.getUTCFullYear()+'-'+String(t.getUTCMonth()+1).padStart(2,'0')+'-'+String(t.getUTCDate()).padStart(2,'0');
  const from=new Date(Date.UTC(y,mi,sd)), nextFrom=new Date(Date.UTC(y,mi+1,sd));
  return {from:iso(from), to:iso(new Date(nextFrom.getTime()-86400000)), startDay:sd};
}
function getPeriodStartDay(){
  return Math.min(28,Math.max(1,Math.round(Number((_settingsCache||LS.settings).periodStartDay))||1));
}
function currentPeriod(){ return workPeriod(localToday(),getPeriodStartDay()); }
// Rango por defecto del Resumen = período vigente (se define en Admin → Configuración)
function applyPeriodDefaults(){
  const p=currentPeriod();
  document.getElementById('sum-from').value=p.from;
  document.getElementById('sum-to').value=p.to;
}

let _dashRecent=[];   // últimos recibos mostrados (para abrir el detalle sin volver a consultar)
let _fuelCache=[];    // cargas de combustible cargadas (para validar odómetro y listar patentes)

// ── Datos de combustible ──
async function getFuel(){
  if(useSupabase) return sbFetch('combustible?fecha=gte.'+dateAddDays(localToday(),-400)+'&order=fecha.asc,odometro.asc');
  return LS.fuel;
}
async function addFuelDB(r){
  if(useSupabase) return (await sbFetch('combustible',{method:'POST',body:JSON.stringify(withUser(r))}))[0];
  const rows=LS.fuel; rows.push({...r,id:Date.now().toString()}); LS.fuel=rows; return rows[rows.length-1];
}
async function delFuelDB(id){
  if(useSupabase) return sbFetch('combustible?id=eq.'+id,{method:'DELETE'});
  LS.fuel=LS.fuel.filter(x=>x.id!==id);
}

// ── Cálculo del rendimiento (método "estanque lleno a estanque lleno") ──
// Un tramo va desde una carga LLENA hasta la siguiente carga LLENA. Los litros del tramo
// son todos los cargados desde entonces (incluidas cargas parciales); los km salen del odómetro.
// `loads` debe ser de UNA sola patente y estar ordenado por odómetro.
function fuelSegments(loads){
  const segs=[]; let baseOdo=null, litros=0, monto=0;
  loads.forEach(l=>{
    if(baseOdo===null){                       // antes de la primera carga llena no hay punto de partida
      if(l.lleno){ baseOdo=l.odometro; litros=0; monto=0; }
      return;
    }
    litros+=Number(l.litros); monto+=Number(l.monto);
    if(l.lleno){
      const km=l.odometro-baseOdo;
      if(km>0 && litros>0) segs.push({fecha:l.fecha,km,litros,monto,rend:km/litros,costoKm:monto/km});
      baseOdo=l.odometro; litros=0; monto=0;
    }
  });
  return segs;
}

// Estadísticas por vehículo (el que cargó más recientemente va primero)
function fuelStats(loads){
  const byP={};
  loads.forEach(l=>{ (byP[l.patente]=byP[l.patente]||[]).push(l); });
  return Object.entries(byP).map(([patente,arr])=>{
    arr.sort((a,b)=>(a.odometro-b.odometro)||(a.fecha<b.fecha?-1:1));
    const segs=fuelSegments(arr), last=segs[segs.length-1]||null, prev=segs.slice(0,-1);
    const sum=(xs,k)=>xs.reduce((a,x)=>a+x[k],0);
    const prevAvg=sum(prev,'litros')>0 ? sum(prev,'km')/sum(prev,'litros') : null;
    const trendPct=(last&&prevAvg)?(last.rend/prevAvg-1)*100:null;
    const byDate=arr.slice().sort((a,b)=>(a.fecha<b.fecha?1:a.fecha>b.fecha?-1:b.odometro-a.odometro));
    return {
      patente, cargas:arr.length, ultimaCarga:byDate[0], segs, last, prevAvg, trendPct,
      avg: sum(segs,'litros')>0 ? sum(segs,'km')/sum(segs,'litros') : null,
      costoKm: sum(segs,'km')>0 ? sum(segs,'monto')/sum(segs,'km') : null,
      alerta: !!(last && prev.length>=2 && trendPct<=-FUEL_ALERT_PCT)
    };
  }).sort((a,b)=>a.ultimaCarga.fecha<b.ultimaCarga.fecha?1:-1);
}

// ── Dashboard ──
async function getDashboardData(){
  const per=currentPeriod(), first=per.from, last=per.to;
  let recent, monthRows, fuel;
  if(useSupabase){
    [recent,monthRows,fuel]=await Promise.all([
      sbFetch('receipts?order=fecha.desc,num.desc&limit=5'),                              // solo los últimos 5, no todos
      sbFetch('receipts?select=total&fecha=gte.'+first+'&fecha=lte.'+last),               // solo los totales del período
      getFuel().catch(()=>null)                                                           // si falla (tabla sin crear), el resto igual se muestra
    ]);
  } else {
    const all=LS.receipts.slice().sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'')||(b.num||0)-(a.num||0));
    recent=all.slice(0,5); monthRows=all.filter(r=>r.fecha>=first&&r.fecha<=last); fuel=LS.fuel;
  }
  return {recent,monthRows,fuel,first,last};
}

async function renderDashboard(){
  const root=document.getElementById('receipt-list');
  root.innerHTML='<div class="empty"><i class="ti ti-refresh" style="opacity:.4;animation:spin .7s linear infinite"></i><br>Cargando...</div>';
  try{
    const d=await getDashboardData();
    _dashRecent=d.recent; _fuelCache=d.fuel||[];
    const facturado=d.monthRows.reduce((a,r)=>a+Number(r.total||0),0);
    const stats=fuelStats(_fuelCache), main=stats[0]||null;
    const mes=_fuelCache.filter(l=>l.fecha>=d.first&&l.fecha<=d.last);
    const litrosMes=mes.reduce((a,l)=>a+Number(l.litros||0),0);
    const gastoMes=mes.reduce((a,l)=>a+Number(l.monto||0),0);
    const pctIng=(facturado>0&&gastoMes>0)?Math.round(gastoMes/facturado*100):null;
    const trend=(main&&main.trendPct!==null)
      ? `<span class="${main.trendPct>=0?'trend-up':'trend-down'}">${main.trendPct>=0?'▲':'▼'} ${Math.abs(Math.round(main.trendPct))}%</span>` : '';

    // 1) Tarjetas del mes
    let html=`<div class="hint" style="margin:0 2px 8px">Período de trabajo: ${fmtDate(d.first)} al ${fmtDate(d.last)}</div>
    <div class="sg">
      <div class="st"><div class="sl">Recibos del período</div><div class="sv">${d.monthRows.length}</div></div>
      <div class="st"><div class="sl">Facturado del período</div><div class="sv blue">${fmtCLP(facturado)}</div></div>
      <div class="st"><div class="sl">Combustible del período</div><div class="sv">${d.fuel===null?'—':fmtCLP(gastoMes)}</div>
        <div class="sl">${d.fuel===null?'':fmtLitros(litrosMes)+' L · '+mes.length+(mes.length===1?' carga':' cargas')+(pctIng!==null?' · '+pctIng+'% de lo facturado':'')}</div></div>
      <div class="st"><div class="sl">Rendimiento${main?' · '+escapeHTML(main.patente):''}</div>
        <div class="sv">${main&&main.avg?fmtNum(main.avg)+' km/L':'—'}</div>
        <div class="sl">${main&&main.last?'Último tramo '+fmtNum(main.last.rend)+' '+trend:'Registra 2 cargas con estanque lleno'}</div></div>
    </div>`;

    // 2) Alertas de consumo anormal
    stats.filter(s=>s.alerta).forEach(s=>{
      html+=`<div class="dash-alert bad"><i class="ti ti-alert-triangle"></i><div><b>${escapeHTML(s.patente)}: consumo anormal.</b>
        El último tramo rindió ${fmtNum(s.last.rend)} km/L, un ${Math.abs(Math.round(s.trendPct))}% menos que su promedio anterior (${fmtNum(s.prevAvg)} km/L).
        Revisa fugas, presión de neumáticos o cargas sin registrar.</div></div>`;
    });

    // 3) Últimos recibos
    html+=`<div class="card"><div class="cardhead"><div class="ct">Últimos recibos</div>
      <button class="btn sm" onclick="verTodosRecibos()">Ver todos</button></div>`;
    html+= d.recent.length ? d.recent.map(r=>`
      <div class="ri" onclick="openReceipt('${r.id}')">
        <div class="rh"><div>
          <span class="rn">Recibo #${r.num}</span>
          ${r.vehiculo?`<span class="tag ${r.vehiculo}" style="margin-left:5px">${r.vehiculo}</span>`:''}
          <div class="rd">${fmtDate(r.fecha)}${r.desde&&r.hasta?' · '+escapeHTML(r.desde)+' → '+escapeHTML(r.hasta):''}</div>
          <div class="rw">${escapeHTML(r.solicita||'')}${r.empresa?' · '+escapeHTML(r.empresa):''}</div>
        </div><div class="rtot">${fmtCLP(r.total)}</div></div>
      </div>`).join('')
      : '<div class="empty compact">Aún no hay recibos. Crea el primero en "Nuevo".</div>';
    html+='</div>';

    // 4) Combustible
    html+=`<div class="card"><div class="cardhead"><div class="ct">Combustible</div>
      <button class="btn sm primary" onclick="openFuelModal()"><i class="ti ti-plus"></i> Registrar carga</button></div>`;
    if(d.fuel===null){
      html+='<div class="empty compact">No se pudo cargar el combustible. Falta ejecutar combustible_setup.sql en Supabase.</div>';
    } else if(!_fuelCache.length){
      html+='<div class="empty compact">Aún no hay cargas. Registra la primera; con 2 cargas de estanque lleno ya se calcula el rendimiento.</div>';
    } else {
      html+=stats.map(s=>`<div class="fuel-row"><div>
        <div class="fuel-main"><span class="tag pat">${escapeHTML(s.patente)}</span> ${s.avg?fmtNum(s.avg)+' km/L en promedio':'rendimiento aún sin calcular'}</div>
        <div class="fuel-sub">${s.last
          ? 'Último tramo '+fmtNum(s.last.rend)+' km/L · '+fmtCLP(Math.round(s.costoKm))+' por km · '+s.cargas+' cargas'
          : 'Falta otra carga con estanque lleno para calcular'}</div></div></div>`).join('');
      const ult=_fuelCache.slice().sort((a,b)=>(a.fecha<b.fecha?1:a.fecha>b.fecha?-1:b.odometro-a.odometro)).slice(0,3);
      html+='<div class="fuel-sep">Últimas cargas</div>'+ult.map(l=>`<div class="fuel-row"><div>
        <div class="fuel-main">${fmtDate(l.fecha)} · ${escapeHTML(l.patente)}</div>
        <div class="fuel-sub">${fmtLitros(l.litros)} L · ${fmtCLP(l.monto)} · ${fmtCLP(Math.round(l.monto/l.litros))}/L · ${Number(l.odometro).toLocaleString('es-CL')} km${l.lleno?'':' · parcial'}</div></div>
        <button class="btn sm danger" onclick="deleteFuel('${l.id}')" aria-label="Eliminar carga"><i class="ti ti-trash"></i></button></div>`).join('');
    }
    html+='</div>';
    root.innerHTML=html;
  }catch(e){ root.innerHTML='<div class="empty">Error al cargar el dashboard</div>'; }
}

// "Ver todos": la lista completa de recibos vive en la pestaña Resumen (sin límite de fechas)
function verTodosRecibos(){
  document.getElementById('sum-from').value=''; document.getElementById('sum-to').value='';
  nav('resumen'); calcSummary();
}

// ── Registrar una carga ──
let _fuelRestoring=false;
const fuelDraftKey=()=> 'tl_fuel_draft_'+(currentUser?currentUser.id:'local');
const FUEL_IDS=['fu-fecha','fu-patente','fu-patente-new','fu-litros','fu-monto','fu-odo','fu-notas'];

function saveFuelDraft(){
  if(_fuelRestoring) return;
  const d={}; FUEL_IDS.forEach(id=>{ d[id]=document.getElementById(id).value; });
  d.lleno=document.getElementById('fu-lleno').checked;
  try{ localStorage.setItem(fuelDraftKey(),JSON.stringify(d)); }catch(e){}
}
function clearFuelDraft(){ try{ localStorage.removeItem(fuelDraftKey()); }catch(e){} }

function fuelLastHint(){
  const sel=document.getElementById('fu-patente').value;
  const p=normPat(sel==='__nueva__'?document.getElementById('fu-patente-new').value:sel);
  const prev=_fuelCache.filter(l=>l.patente===p).sort((a,b)=>b.odometro-a.odometro)[0];
  document.getElementById('fu-last').textContent = prev
    ? 'Última carga de '+p+': '+Number(prev.odometro).toLocaleString('es-CL')+' km ('+fmtDate(prev.fecha)+')' : '';
}
function fuelPatenteChange(){
  const nueva=document.getElementById('fu-patente').value==='__nueva__';
  document.getElementById('fu-patente-new').style.display=nueva?'':'none';
  fuelLastHint();
}
function fuelHint(){
  const l=parseDec(document.getElementById('fu-litros').value), m=Number(document.getElementById('fu-monto').value);
  document.getElementById('fu-hint').textContent=(l>0&&m>0)?'Precio por litro: '+fmtCLP(Math.round(m/l)):'';
}

function openFuelModal(){
  const sel=document.getElementById('fu-patente');
  const last=localStorage.getItem('tl_last_patente')||'';
  const pats=[...new Set([..._fuelCache.map(l=>l.patente),...(last?[last]:[])])].sort();
  sel.innerHTML='<option value="">— Seleccionar —</option>'+pats.map(p=>`<option value="${escapeHTML(p)}">${escapeHTML(p)}</option>`).join('')+'<option value="__nueva__">+ Nueva patente…</option>';
  document.getElementById('fu-fecha').value=localToday();
  sel.value = pats.length===0 ? '__nueva__' : (pats.includes(last)?last:(pats.length===1?pats[0]:''));
  ['fu-patente-new','fu-litros','fu-monto','fu-odo','fu-notas'].forEach(id=>{ document.getElementById(id).value=''; });
  document.getElementById('fu-lleno').checked=true;
  document.getElementById('fu-err').textContent='';
  // ¿Hay un borrador (se apagó la pantalla o se cerró la app a medias)? Se recupera.
  let d=null; try{ d=JSON.parse(localStorage.getItem(fuelDraftKey())||'null'); }catch(e){}
  if(d){
    _fuelRestoring=true;
    try{
      FUEL_IDS.forEach(id=>{ if(d[id]!==undefined) document.getElementById(id).value=d[id]; });
      document.getElementById('fu-lleno').checked=d.lleno!==false;
    } finally { _fuelRestoring=false; }
  }
  const btn=document.getElementById('fu-btn'); btn.disabled=false; btn.innerHTML='<i class="ti ti-check"></i> Guardar';
  fuelPatenteChange(); fuelHint();
  document.getElementById('fuel-modal').classList.add('open');
}
// discard=true (botón Cancelar) borra el borrador; la X y tocar el fondo lo conservan
function closeFuelModal(discard){
  document.getElementById('fuel-modal').classList.remove('open');
  if(discard) clearFuelDraft();
}

async function saveFuel(){
  const err=document.getElementById('fu-err'); err.textContent='';
  const fecha=document.getElementById('fu-fecha').value;
  const sel=document.getElementById('fu-patente').value;
  const patente=normPat(sel==='__nueva__'?document.getElementById('fu-patente-new').value:sel);
  const litros=Math.round(parseDec(document.getElementById('fu-litros').value)*100)/100;
  const monto=Number(document.getElementById('fu-monto').value);
  const odo=Math.round(Number(document.getElementById('fu-odo').value));
  const lleno=document.getElementById('fu-lleno').checked;
  const notas=document.getElementById('fu-notas').value.trim();

  if(!fecha){ err.textContent='Indica la fecha'; return; }
  if(patente.length<4){ err.textContent='Ingresa la patente del vehículo (ej: ABCD12)'; return; }
  if(!(litros>0)){ err.textContent='Ingresa los litros cargados (ej: 32,5)'; return; }
  if(!(monto>0)){ err.textContent='Ingresa el monto total pagado'; return; }
  if(!(odo>0)){ err.textContent='Ingresa el kilometraje (odómetro)'; return; }
  // El odómetro nunca puede ser menor al de la carga anterior del mismo vehículo
  const prev=_fuelCache.filter(l=>l.patente===patente&&l.fecha<=fecha).sort((a,b)=>b.odometro-a.odometro)[0];
  if(prev && odo<prev.odometro){
    err.textContent='El odómetro ('+odo.toLocaleString('es-CL')+' km) es menor al de la carga anterior ('+Number(prev.odometro).toLocaleString('es-CL')+' km). Revisa el número.';
    return;
  }
  const btn=document.getElementById('fu-btn');
  btn.disabled=true; btn.innerHTML='<span class="spin"></span> Guardando...';
  try{
    await addFuelDB({fecha,patente,litros,monto,odometro:odo,lleno,notas:notas||null});
    localStorage.setItem('tl_last_patente',patente);
    clearFuelDraft(); closeFuelModal(false);
    toast('Carga registrada ✓');
    renderDashboard();
  }catch(e){
    err.textContent=/combustible|PGRST205|relation/i.test(e.message)?'Falta ejecutar combustible_setup.sql en Supabase.':'Error: '+e.message;
    btn.disabled=false; btn.innerHTML='<i class="ti ti-check"></i> Guardar';
  }
}

async function deleteFuel(id){
  if(!confirm('¿Eliminar esta carga de combustible?')) return;
  try{ await delFuelDB(id); toast('Carga eliminada'); renderDashboard(); }
  catch(e){ toast('Error: '+e.message); }
}

// Guardar el borrador de la carga mientras se escribe
const _fm=document.getElementById('fuel-modal');
if(_fm){ _fm.addEventListener('input',saveFuelDraft); _fm.addEventListener('change',saveFuelDraft); }

// ── 12. Cronómetro de servicio + borrador automático ──────
// Los cronómetros guardan marcas de tiempo ABSOLUTAS (hora real), no un contador
// que "corre". Así siguen siendo correctos aunque la pantalla se apague, la app
// pase a segundo plano o el navegador recargue la página.
const _cr = {
  form:  { llegadaTs:null, inicioTs:null, finTs:null, intervalo:null },
  modal: { llegadaTs:null, inicioTs:null, finTs:null, intervalo:null }
};
let _restoring    = false;   // true mientras se restauran datos (evita re-guardar)
let _formReady    = false;   // true cuando el formulario ya fue inicializado/restaurado
let _loggedUserId = null;    // evita reinicializar al refrescar el token
let _wakeLock     = null;

const _pref = ctx => ctx==='modal' ? 'crono-m-' : 'crono-';
function _pad(n){ return String(n).padStart(2,'0'); }
function _horaHHMM(ts){ const d=new Date(ts); return _pad(d.getHours())+':'+_pad(d.getMinutes()); }
function _diffMins(a,b){ return Math.floor((b-a)/60000); }

function _tickEspera(ctx){
  const el=document.getElementById(_pref(ctx)+'contador'), c=_cr[ctx];
  if(!el||!c.llegadaTs) return;
  const segs=Math.max(0,Math.floor((Date.now()-c.llegadaTs)/1000));
  el.textContent=_pad(Math.floor(segs/60))+':'+_pad(segs%60);
}

// Dibuja el paso correcto del cronómetro según las marcas de tiempo guardadas
function _renderCrono(ctx){
  const p=_pref(ctx), c=_cr[ctx];
  const show=step=>['llegada','espera','viaje','ok'].forEach(st=>{
    const el=document.getElementById(p+'step-'+st); if(el) el.style.display = st===step ? '' : 'none';
  });
  clearInterval(c.intervalo); c.intervalo=null;

  if(!c.llegadaTs){
    show('llegada');
    const cnt=document.getElementById(p+'contador'); if(cnt) cnt.textContent='00:00';
    return;
  }
  if(!c.inicioTs){
    show('espera');
    document.getElementById(p+'hora-llegada').textContent=_horaHHMM(c.llegadaTs);
    _tickEspera(ctx);
    c.intervalo=setInterval(()=>_tickEspera(ctx),1000);
    return;
  }
  const espera=_diffMins(c.llegadaTs,c.inicioTs);
  if(!c.finTs){
    show('viaje');
    document.getElementById(p+'hora-inicio').textContent=_horaHHMM(c.inicioTs);
    document.getElementById(p+'espera-ok').textContent=espera;
    return;
  }
  show('ok');
  document.getElementById(p+'resumen').innerHTML =
    `🕐 Llegada: ${_horaHHMM(c.llegadaTs)}<br>🚌 Inicio: ${_horaHHMM(c.inicioTs)}<br>⏱ Espera: ${espera} min<br>🏁 Fin: ${_horaHHMM(c.finTs)}`;
}

// ── Mantener pantalla encendida mientras el cronómetro corre ──
function cronoActivo(){ return ['form','modal'].some(c=>_cr[c].llegadaTs && !_cr[c].finTs); }
async function wakeOn(){
  try{
    if('wakeLock' in navigator && !_wakeLock){
      _wakeLock = await navigator.wakeLock.request('screen');
      _wakeLock.addEventListener('release',()=>{ _wakeLock=null; });
    }
  }catch(e){ /* no soportado o denegado: el cronómetro igual funciona */ }
}
function wakeOff(){ try{ if(_wakeLock){ _wakeLock.release(); _wakeLock=null; } }catch(e){} }

function _persist(ctx){ if(ctx==='modal') saveCompDraft(); else saveDraft(); }

// Paso 1 — llegué al sitio
function cronoLlegada(ctx='form'){
  const c=_cr[ctx];
  c.llegadaTs=Date.now(); c.inicioTs=null; c.finTs=null;
  // La "H. Inicio" del recibo es la hora de LLEGADA al sitio (no la del inicio del viaje)
  const hLlegada=_horaHHMM(c.llegadaTs);
  if(ctx==='modal'){
    document.getElementById('comp-hinicio').value=hLlegada;
    recalcCompTotal();
  } else {
    document.getElementById('f-hinicio').value=hLlegada;
    updateReceiptTotal();
  }
  _renderCrono(ctx); wakeOn(); _persist(ctx);
  toast('⏱ Llegada registrada — espera iniciada');
}

// Paso 2 — iniciar viaje
function cronoInicio(ctx='form'){
  const c=_cr[ctx];
  if(!c.llegadaTs){ toast('Primero registra la llegada'); return; }
  c.inicioTs=Date.now(); c.finTs=null;
  const espera=_diffMins(c.llegadaTs,c.inicioTs);
  if(ctx==='modal'){
    document.getElementById('comp-espera').value=espera;
    recalcCompTotal();
  } else {
    document.getElementById('f-espera').value=espera;
    updateReceiptTotal();
  }
  _renderCrono(ctx); _persist(ctx);
  toast('🚌 Viaje iniciado');
}

// Paso 3 — finalizar viaje
function cronoFin(ctx='form'){
  const c=_cr[ctx];
  if(!c.inicioTs){ toast('Primero inicia el viaje'); return; }
  c.finTs=Date.now();
  const hFin=_horaHHMM(c.finTs);
  if(ctx==='modal'){
    document.getElementById('comp-fin').value=hFin;
    recalcCompTotal();
  } else {
    document.getElementById('f-fin').value=hFin;
  }
  _renderCrono(ctx);
  if(!cronoActivo()) wakeOff();
  _persist(ctx);
  toast('🏁 Viaje finalizado — tiempos registrados');
}

// Reiniciar cronómetro (silent=true: no guarda borrador, para usar dentro de initForm)
function cronoReset(ctx='form', silent=false){
  const c=_cr[ctx];
  c.llegadaTs=c.inicioTs=c.finTs=null;
  _renderCrono(ctx);
  if(!cronoActivo()) wakeOff();
  if(!silent) _persist(ctx);
}

// ── Borrador del formulario "Nuevo recibo" ────────────────
const DRAFT_FIELDS=['f-fecha','f-chofer','f-area','f-solicita','f-empresa','f-costo',
  'f-desde','f-hasta','f-hinicio','f-espera','f-fin','f-paradas','f-detalle','f-total'];

function draftKey(){ return 'tl_draft_'+(currentUser?currentUser.id:'local'); }
function compKey(){  return 'tl_draft_comp_'+(currentUser?currentUser.id:'local'); }

function saveDraft(){
  if(_restoring || !_formReady) return;
  const fields={};
  DRAFT_FIELDS.forEach(id=>{ const el=document.getElementById(id); if(el) fields[id]=el.value; });
  const f=_cr.form;
  // ¿El usuario realmente ingresó algo? (fecha por defecto y paradas=0 no cuentan)
  const touched = !!selVehicle || !!f.llegadaTs || DRAFT_FIELDS.some(id=>{
    const v=fields[id]; if(!v) return false;
    if(id==='f-fecha') return false;
    if(id==='f-paradas') return v!=='0';
    return true;
  });
  try{
    if(!touched){ localStorage.removeItem(draftKey()); return; }
    localStorage.setItem(draftKey(), JSON.stringify({
      fields, veh:selVehicle,
      base: document.getElementById('f-total').dataset.baseTotal||'',
      cr:{ llegadaTs:f.llegadaTs, inicioTs:f.inicioTs, finTs:f.finTs },
      saved: Date.now()
    }));
  }catch(e){}
}

function restoreDraft(){
  let d=null;
  try{ d=JSON.parse(localStorage.getItem(draftKey())||'null'); }catch(e){}
  if(!d) return false;
  _restoring=true;
  try{
    DRAFT_FIELDS.forEach(id=>{
      const el=document.getElementById(id);
      if(el && d.fields && d.fields[id]!==undefined) el.value=d.fields[id];
    });
    document.getElementById('f-total').dataset.baseTotal=d.base||'';
    if(d.veh){
      selVehicle=d.veh;
      document.querySelectorAll('.vo').forEach(b=>b.classList.remove('sel'));
      const vb=document.getElementById('v-'+d.veh); if(vb) vb.classList.add('sel');
    }
    if(d.cr){
      Object.assign(_cr.form,{ llegadaTs:d.cr.llegadaTs||null, inicioTs:d.cr.inicioTs||null, finTs:d.cr.finTs||null });
      _renderCrono('form');
      if(_cr.form.llegadaTs && !_cr.form.finTs) wakeOn();
    }
  } finally { _restoring=false; }
  const b=document.getElementById('draft-banner'); if(b) b.style.display='flex';
  return true;
}

function clearDraft(){ try{ localStorage.removeItem(draftKey()); }catch(e){} }

function discardDraft(){
  if(!confirm('¿Descartar el borrador y empezar un recibo nuevo?')) return;
  initForm(); clearDraft();
}

// ── Borrador del modal "completar orden" ──────────────────
function saveCompDraft(){
  if(_restoring || !_curOrdenId) return;
  const m=_cr.modal;
  try{
    localStorage.setItem(compKey(), JSON.stringify({
      ordenId:_curOrdenId,
      hinicio:document.getElementById('comp-hinicio').value,
      fin:    document.getElementById('comp-fin').value,
      espera: document.getElementById('comp-espera').value,
      total:  document.getElementById('comp-total').value,
      cr:{ llegadaTs:m.llegadaTs, inicioTs:m.inicioTs, finTs:m.finTs },
      saved:Date.now()
    }));
  }catch(e){}
}
function clearCompDraft(){ try{ localStorage.removeItem(compKey()); }catch(e){} }

// ── Guardar al instante cuando el usuario escribe o la app pasa a segundo plano ──
document.getElementById('s-nuevo').addEventListener('input', saveDraft);
document.getElementById('s-nuevo').addEventListener('change', saveDraft);
document.getElementById('completar-modal').addEventListener('input', saveCompDraft);

document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden'){
    saveDraft(); if(_curOrdenId) saveCompDraft();
  } else {
    // Al volver (pantalla desbloqueada): re-adquirir pantalla activa y refrescar contador
    if(cronoActivo()) wakeOn();
    ['form','modal'].forEach(c=>{ if(_cr[c].llegadaTs && !_cr[c].inicioTs) _tickEspera(c); });
  }
});
window.addEventListener('pagehide',()=>{ saveDraft(); if(_curOrdenId) saveCompDraft(); });

// ── 13. Auth ──────────────────────────────────────────────
function showAuthScreen(){ document.getElementById('auth-screen').style.display='flex'; }
function hideAuthScreen(){ document.getElementById('auth-screen').style.display='none'; }

function setAuthMsg(msg, ok=false){
  const el=document.getElementById('auth-msg');
  el.textContent=msg;
  el.style.color = ok ? '#0F6E56' : '#A32D2D';
}

function setBtnLoading(id, loading, label){
  const b=document.getElementById(id); if(!b) return;
  b.disabled=loading;
  b.innerHTML=loading?'<span class="spin"></span> Cargando...':label;
}

async function doLogin(){
  if(!_sb){ setAuthMsg('Supabase no disponible'); return; }
  const email=document.getElementById('login-email').value.trim();
  const pass=document.getElementById('login-pass').value;
  if(!email||!pass){ setAuthMsg('Ingresa correo y contraseña'); return; }
  setBtnLoading('login-btn',true,'<i class="ti ti-login"></i> Entrar');
  const { error } = await _sb.auth.signInWithPassword({ email, password:pass });
  setBtnLoading('login-btn',false,'<i class="ti ti-login"></i> Entrar');
  if(error){ setAuthMsg(translateError(error.message)); return; }
  // onAuthStateChange se encarga del resto
}

async function doForgot(){
  if(!_sb) return;
  const email=document.getElementById('login-email').value.trim();
  if(!email){ setAuthMsg('Escribe tu correo primero'); return; }
  const { error } = await _sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
  if(error){ setAuthMsg(translateError(error.message)); return; }
  setAuthMsg('Correo de recuperación enviado ✓', true);
}

async function doLogout(){
  if(!confirm('¿Cerrar sesión?')) return;
  if(_sb) await _sb.auth.signOut();
  currentUser=null; useSupabase=false;
  _loggedUserId=null; _formReady=false;
  cronoReset('form', true); cronoReset('modal', true);
  document.getElementById('user-email').textContent='';
  showAuthScreen();
}

function translateError(msg){
  if(msg.includes('Invalid login credentials')) return 'Correo o contraseña incorrectos';
  if(msg.includes('Email not confirmed'))       return 'Confirma tu correo antes de entrar';
  if(msg.includes('User already registered'))   return 'Ese correo ya tiene cuenta';
  if(msg.includes('Password should be'))        return 'La contraseña debe tener al menos 6 caracteres';
  return msg;
}

// ── 13. Init ──────────────────────────────────────────────
applyPeriodDefaults();   // rango inicial del Resumen: período de trabajo vigente

async function onUserLoggedIn(user){
  currentUser=user; useSupabase=true;
  // Supabase vuelve a emitir el evento al refrescar el token o reabrir la app:
  // si ya estaba cargado este usuario, NO reinicializar (borraría lo que se está escribiendo)
  if(_loggedUserId===user.id){ hideAuthScreen(); return; }
  _loggedUserId=user.id;
  document.getElementById('user-email').textContent=user.email;
  hideAuthScreen();
  await Promise.all([ loadSettings(), loadCatalogs() ]); applyPeriodDefaults();
  renderCatalogControls();
  initForm();
  restoreDraft();
  _formReady=true;
  renderReceipts();
  checkOrdenesbadge();
}

async function initApp(){
  if(!_sb){
    // Sin Supabase: modo local directo
    await Promise.all([ loadSettings(), loadCatalogs() ]); applyPeriodDefaults();
    renderCatalogControls(); initForm(); restoreDraft(); _formReady=true; renderReceipts();
    return;
  }

  // Mostrar auth mientras verifica sesión
  showAuthScreen();

  // Escuchar cambios de sesión (login, logout, refresh de token)
  _sb.auth.onAuthStateChange(async (event, session) => {
    if(session?.user){
      await onUserLoggedIn(session.user);
    } else {
      currentUser=null; useSupabase=false;
      showAuthScreen();
    }
  });

  // Verificar sesión existente (cubre el caso de reabrir la app en iPhone)
  const { data:{ session } } = await _sb.auth.getSession();
  if(session?.user){
    await onUserLoggedIn(session.user);
  }
  // Si no hay sesión, la pantalla de login ya está visible
}

initApp();
