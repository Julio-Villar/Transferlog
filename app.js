/*
  TransferLog app
  Estructura:
  1. Configuración Supabase y cliente Auth
  2. Estado global y LocalStorage
  3. Auth: login, registro, sesión
  4. Adaptador de datos (Supabase con user_id / LocalStorage)
  5. Utilidades de UI
  6. Flujos: recibos, rutas, resumen
  7. Exportación PDF
  8. Configuración
  9. Init
*/

// ── 1. Supabase client ────────────────────────────────────
const SUPABASE_URL     = 'https://luosbdpumkoqsfiwqjft.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1b3NiZHB1bWtvcXNmaXdxamZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4NzcwMjQsImV4cCI6MjA5NzQ1MzAyNH0.uqr2LcLICRxN6Galo8mqeeawzNk48_oS7S5WQmuZFwo';

const _sb = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    })
  : null;

// ── 2. Estado global y LocalStorage ───────────────────────
const {jsPDF} = window.jspdf || {};

let currentUser  = null;   // supabase user object
let useSupabase  = false;
let selVehicle   = '';
let curId        = null;
let _curReceipt  = null;
let vehFilter    = 'todos';

const LS = {
  get routes()    { try { return JSON.parse(localStorage.getItem('tl_r')  || '[]') } catch { return [] } },
  set routes(v)   { localStorage.setItem('tl_r',  JSON.stringify(v)) },
  get receipts()  { try { return JSON.parse(localStorage.getItem('tl_p')  || '[]') } catch { return [] } },
  set receipts(v) { localStorage.setItem('tl_p',  JSON.stringify(v)) },
  get settings()  { try { return JSON.parse(localStorage.getItem('tl_settings') || '{}') } catch { return {} } },
  set settings(v) { localStorage.setItem('tl_settings', JSON.stringify(v)) },
  get catalogs()  {
    const base = { choferes: [], solicitantes: [], areas: [], empresas: [], costos: [] };
    try { return { ...base, ...JSON.parse(localStorage.getItem('tl_catalogs') || '{}') } } catch { return base }
  },
  set catalogs(v) { localStorage.setItem('tl_catalogs', JSON.stringify(v)) }
};

const CATALOG_LABELS = {
  choferes:     'Choferes',
  solicitantes: 'Quien solicita',
  areas:        'Áreas',
  empresas:     'Empresas',
  costos:       'Centros de costo'
};

// ── 3. Auth ───────────────────────────────────────────────

// ---- UI de auth ----
function showAuthScreen() {
  document.getElementById('auth-screen').classList.add('active');
}
function hideAuthScreen() {
  document.getElementById('auth-screen').classList.remove('active');
}
function showAuthTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('tab-login').classList.toggle('on', isLogin);
  document.getElementById('tab-register').classList.toggle('on', !isLogin);
  document.getElementById('auth-login').style.display    = isLogin ? '' : 'none';
  document.getElementById('auth-register').style.display = isLogin ? 'none' : '';
  setAuthMsg('');
}
function setAuthMsg(msg, isOk = false) {
  const el = document.getElementById('auth-msg');
  el.textContent = msg;
  el.className = 'auth-msg ' + (msg ? (isOk ? 'ok' : 'err') : '');
}
function setBtnLoading(id, loading, label) {
  const b = document.getElementById(id);
  b.disabled = loading;
  b.innerHTML = loading ? '<span class="spin"></span> Cargando...' : label;
}

// ---- Login ----
async function doLogin() {
  if (!_sb) { setAuthMsg('Supabase no disponible'); return; }
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  if (!email || !pass) { setAuthMsg('Ingresa correo y contraseña'); return; }
  setBtnLoading('login-btn', true, '<i class="ti ti-login"></i> Entrar');
  const { error } = await _sb.auth.signInWithPassword({ email, password: pass });
  setBtnLoading('login-btn', false, '<i class="ti ti-login"></i> Entrar');
  if (error) { setAuthMsg(translateAuthError(error.message)); return; }
  // onAuthStateChange manejará el resto
}

// ---- Registro ----
async function doRegister() {
  if (!_sb) { setAuthMsg('Supabase no disponible'); return; }
  const email = document.getElementById('reg-email').value.trim();
  const pass  = document.getElementById('reg-pass').value;
  const pass2 = document.getElementById('reg-pass2').value;
  if (!email || !pass) { setAuthMsg('Completa todos los campos'); return; }
  if (pass !== pass2)  { setAuthMsg('Las contraseñas no coinciden'); return; }
  if (pass.length < 6) { setAuthMsg('La contraseña debe tener al menos 6 caracteres'); return; }
  setBtnLoading('reg-btn', true, '<i class="ti ti-user-plus"></i> Crear cuenta');
  const { error } = await _sb.auth.signUp({ email, password: pass });
  setBtnLoading('reg-btn', false, '<i class="ti ti-user-plus"></i> Crear cuenta');
  if (error) { setAuthMsg(translateAuthError(error.message)); return; }
  setAuthMsg('¡Cuenta creada! Revisa tu correo para confirmar.', true);
}

// ---- Olvidé contraseña ----
async function doForgot() {
  if (!_sb) return;
  const email = document.getElementById('login-email').value.trim();
  if (!email) { setAuthMsg('Escribe tu correo primero'); return; }
  const { error } = await _sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href
  });
  if (error) { setAuthMsg(translateAuthError(error.message)); return; }
  setAuthMsg('Correo de recuperación enviado ✓', true);
}

// ---- Logout ----
async function logout() {
  if (!confirm('¿Cerrar sesión?')) return;
  if (_sb) await _sb.auth.signOut();
  currentUser = null;
  useSupabase = false;
  showAuthScreen();
  document.getElementById('user-email').textContent = '';
  // Limpiar pantalla
  document.getElementById('receipt-list').innerHTML = '';
}

// ---- Traducir errores de Supabase Auth ----
function translateAuthError(msg) {
  if (msg.includes('Invalid login credentials')) return 'Correo o contraseña incorrectos';
  if (msg.includes('Email not confirmed'))       return 'Confirma tu correo antes de entrar';
  if (msg.includes('User already registered'))   return 'Ese correo ya tiene cuenta, inicia sesión';
  if (msg.includes('Password should be'))        return 'La contraseña debe tener al menos 6 caracteres';
  if (msg.includes('Unable to validate'))        return 'Error de red. Intenta de nuevo';
  return msg;
}

// ---- Escuchar cambios de sesión ----
function setupAuthListener() {
  if (!_sb) {
    // Sin Supabase: modo local directo
    showAuthScreen = () => {};
    hideAuthScreen();
    initAppData();
    return;
  }
  _sb.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      currentUser = session.user;
      useSupabase = true;
      hideAuthScreen();
      document.getElementById('user-email').textContent = currentUser.email;
      await initAppData();
    } else {
      currentUser = null;
      useSupabase = false;
      showAuthScreen();
    }
  });
}

// ── 4. DB abstraction (Supabase con user_id o Local) ──────

// Supabase REST con JWT de usuario
async function sbFetch(path, opts = {}) {
  const session = _sb ? (await _sb.auth.getSession()).data.session : null;
  const token = session?.access_token || SUPABASE_ANON_KEY;
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...opts,
    headers: {
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + token,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
      ...(opts.headers || {})
    }
  });
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

// El user_id se filtra automáticamente por RLS en Supabase.
// En el body de inserción lo añadimos explícitamente para tablas sin RLS activo.
function withUser(obj) {
  return currentUser ? { ...obj, user_id: currentUser.id } : obj;
}

async function getRoutes() {
  return useSupabase ? sbFetch('routes?order=created_at.asc') : LS.routes;
}
async function addRouteDB(r) {
  if (useSupabase) return (await sbFetch('routes', { method: 'POST', body: JSON.stringify(withUser(r)) }))[0];
  const rows = LS.routes; rows.push({ ...r, id: Date.now().toString() }); LS.routes = rows; return rows[rows.length - 1];
}
async function delRouteDB(id) {
  if (useSupabase) return sbFetch('routes?id=eq.' + id, { method: 'DELETE' });
  LS.routes = LS.routes.filter(x => x.id !== id);
}

async function getReceipts() {
  return useSupabase ? sbFetch('receipts?order=num.asc') : LS.receipts;
}
async function addReceiptDB(r) {
  if (useSupabase) return (await sbFetch('receipts', { method: 'POST', body: JSON.stringify(withUser(r)) }))[0];
  const rows = LS.receipts; rows.push({ ...r, id: Date.now().toString() }); LS.receipts = rows; return rows[rows.length - 1];
}
async function delReceiptDB(id) {
  if (useSupabase) return sbFetch('receipts?id=eq.' + id, { method: 'DELETE' });
  LS.receipts = LS.receipts.filter(x => x.id !== id);
}
async function countReceipts() {
  if (useSupabase) { const r = await sbFetch('receipts?select=num&order=num.desc&limit=1'); return r.length ? r[0].num : 0; }
  return LS.receipts.length;
}

// ── 5. Utilidades de UI ───────────────────────────────────
function toast(msg, dur = 2400) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', dur);
}
function fmtDate(d) {
  if (!d) return '';
  const [y, m, da] = d.split('-'); return `${da}/${m}/${y}`;
}
function fmtCLP(n) { return '$' + Number(n).toLocaleString('es-CL'); }
function escapeHTML(v) {
  return String(v).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

// ── 6. Navegación ─────────────────────────────────────────
function nav(s) {
  document.querySelectorAll('.sec').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(x => x.classList.remove('active'));
  document.getElementById('s-' + s).classList.add('active');
  document.getElementById('nb-' + s).classList.add('active');
  if (s === 'recibos') renderReceipts();
  if (s === 'rutas')   renderRoutes();
  if (s === 'nuevo')   { initForm(); renderRouteSelect(); }
  if (s === 'config')  renderConfig();
}

// ── Vehículo ──────────────────────────────────────────────
function selVeh(v) {
  selVehicle = v;
  document.querySelectorAll('.vo').forEach(b => b.classList.remove('sel'));
  document.getElementById('v-' + v).classList.add('sel');
}

// ── Formulario nuevo recibo ───────────────────────────────
function initForm() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('f-fecha').value = today;
  selVehicle = '';
  document.querySelectorAll('.vo').forEach(b => b.classList.remove('sel'));
  ['f-desde','f-hasta','f-espera','f-detalle','f-total'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  renderCatalogControls();
  ['f-chofer','f-area','f-solicita','f-empresa','f-costo'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('f-ruta').value = '';
  document.getElementById('f-total').dataset.baseTotal = '';
  document.getElementById('f-paradas').value = 0;
  document.getElementById('f-hinicio').value = '';
  document.getElementById('f-fin').value = '';
}

async function renderRouteSelect() {
  const sel = document.getElementById('f-ruta');
  const routes = await getRoutes();
  sel.innerHTML = '<option value="">— Seleccionar ruta —</option>';
  routes.forEach((r, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${r.origen} → ${r.destino} (${fmtCLP(r.valor)})`;
    sel.appendChild(opt);
  });
  sel._routes = routes;
}

function applyRoute() {
  const sel = document.getElementById('f-ruta');
  const i = parseInt(sel.value);
  if (isNaN(i) || !sel._routes) return;
  const r = sel._routes[i]; if (!r) return;
  document.getElementById('f-desde').value = r.origen;
  document.getElementById('f-hasta').value = r.destino;
  document.getElementById('f-total').dataset.baseTotal = r.valor;
  updateReceiptTotal();
}

function getExtraStopValue() { return Number(LS.settings.extraStopValue || 0); }

function syncBaseTotalFromManual() {
  const total = document.getElementById('f-total');
  total.dataset.baseTotal = Number(total.value || 0);
}

function updateReceiptTotal() {
  const total = document.getElementById('f-total');
  const base  = Number(total.dataset.baseTotal || total.value || 0);
  const stops = Math.max(0, Number(document.getElementById('f-paradas').value || 0));
  total.value = base + (stops * getExtraStopValue());
}

// ── Rutas ─────────────────────────────────────────────────
async function addRoute() {
  const o = document.getElementById('r-origen').value.trim();
  const d = document.getElementById('r-destino').value.trim();
  const v = document.getElementById('r-valor').value;
  if (!o || !d || !v) { toast('Completa todos los campos.'); return; }
  try {
    await addRouteDB({ origen: o, destino: d, valor: Number(v) });
    document.getElementById('r-origen').value = '';
    document.getElementById('r-destino').value = '';
    document.getElementById('r-valor').value = '';
    toast('Ruta guardada ✓'); renderRoutes();
  } catch(e) { toast('Error: ' + e.message); }
}

async function renderRoutes() {
  const list = document.getElementById('routes-list');
  try {
    const routes = await getRoutes();
    if (!routes.length) { list.innerHTML = '<div class="empty"><i class="ti ti-map-pin"></i>Sin rutas aún</div>'; return; }
    list.innerHTML = routes.map(r => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:var(--border)">
        <div>
          <div style="font-size:13px;font-weight:600">${escapeHTML(r.origen)} → ${escapeHTML(r.destino)}</div>
          <div style="font-size:11px;color:var(--text2)">${fmtCLP(r.valor)}</div>
        </div>
        <button class="btn sm danger" onclick="delRoute('${r.id}')"><i class="ti ti-trash"></i></button>
      </div>
    `).join('');
  } catch(e) { list.innerHTML = '<div class="empty">Error al cargar rutas</div>'; }
}

async function delRoute(id) {
  if (!confirm('¿Eliminar esta ruta?')) return;
  await delRouteDB(id); toast('Ruta eliminada'); renderRoutes();
}

// ── Guardar recibo ────────────────────────────────────────
async function saveReceipt() {
  const fecha    = document.getElementById('f-fecha').value;
  const chofer   = document.getElementById('f-chofer').value.trim();
  const solicita = document.getElementById('f-solicita').value.trim();
  const total    = document.getElementById('f-total').value;
  if (!fecha || !chofer || !solicita || !total) { toast('Faltan campos obligatorios.'); return; }
  const paradas = Math.max(0, Number(document.getElementById('f-paradas').value || 0));
  const btn = document.getElementById('save-btn');
  btn.innerHTML = '<span class="spin"></span> Guardando...'; btn.disabled = true;
  try {
    const count = await countReceipts();
    await addReceiptDB({
      num: count + 1, vehiculo: selVehicle, fecha, chofer,
      area:               document.getElementById('f-area').value,
      solicita,
      empresa:            document.getElementById('f-empresa').value,
      costo:              document.getElementById('f-costo').value,
      desde:              document.getElementById('f-desde').value,
      hasta:              document.getElementById('f-hasta').value,
      hinicio:            document.getElementById('f-hinicio').value,
      espera:             document.getElementById('f-espera').value,
      fin:                document.getElementById('f-fin').value,
      detalle:            document.getElementById('f-detalle').value,
      paradas_adicionales: paradas,
      total:              Number(total)
    });
    toast('Recibo guardado ✓'); nav('recibos');
  } catch(e) { toast('Error: ' + e.message); }
  btn.innerHTML = '<i class="ti ti-check"></i> Guardar recibo'; btn.disabled = false;
}

// ── Listar recibos ────────────────────────────────────────
async function renderReceipts() {
  const list = document.getElementById('receipt-list');
  list.innerHTML = '<div class="empty"><i class="ti ti-refresh" style="opacity:.4;animation:spin .7s linear infinite"></i><br>Cargando...</div>';
  try {
    const receipts = (await getReceipts()).slice().reverse();
    if (!receipts.length) {
      list.innerHTML = '<div class="empty"><i class="ti ti-file-text"></i>Sin recibos aún.<br>Crea el primero en "Nuevo".</div>'; return;
    }
    list.innerHTML = '<div class="card">' + receipts.map(r => `
      <div class="ri" onclick="openReceipt('${r.id}')">
        <div class="rh">
          <div>
            <span class="rn">Recibo #${r.num}</span>
            ${r.vehiculo ? `<span class="tag ${r.vehiculo}" style="margin-left:5px">${r.vehiculo}</span>` : ''}
            <div class="rd">${fmtDate(r.fecha)}${r.desde && r.hasta ? ' · ' + r.desde + ' → ' + r.hasta : ''}</div>
            <div class="rw">${escapeHTML(r.solicita || '')}${r.empresa ? ' · ' + escapeHTML(r.empresa) : ''}</div>
          </div>
          <div class="rtot">${fmtCLP(r.total)}</div>
        </div>
      </div>
    `).join('') + '</div>';
  } catch(e) { list.innerHTML = '<div class="empty">Error al cargar recibos</div>'; }
}

// ── Ver detalle recibo ────────────────────────────────────
async function openReceipt(id) {
  const receipts = await getReceipts();
  const r = receipts.find(x => String(x.id) === String(id));
  if (!r) return;
  _curReceipt = r; curId = id;
  document.getElementById('modal-ttl').textContent = 'Recibo #' + r.num;
  const row = (l, v) => v ? `<tr><td style="color:var(--text2);padding:3px 0;font-size:12px;width:46%">${l}</td><td style="font-size:12px;padding:3px 0">${escapeHTML(String(v))}</td></tr>` : '';
  document.getElementById('modal-body').innerHTML = `
    <div style="margin-bottom:10px">
      ${r.vehiculo ? `<span class="tag ${r.vehiculo}">${r.vehiculo}</span> ` : ''}
      <span style="font-size:12px;color:var(--text2)">${fmtDate(r.fecha)}</span>
    </div>
    <table style="width:100%;border-collapse:collapse">
      ${row('Chofer', r.chofer)}${row('Área', r.area)}${row('Solicita', r.solicita)}
      ${row('Empresa', r.empresa)}${row('Centro costo', r.costo)}
      ${row('Desde', r.desde)}${row('Hasta', r.hasta)}
      ${row('H. Inicio', r.hinicio)}${row('Tdo. Espera', r.espera)}${row('Fin servicio', r.fin)}
      ${row('Paradas adicionales', r.paradas_adicionales)}
    </table>
    ${r.detalle ? `<div style="margin-top:8px;font-size:12px;color:var(--text2);border-top:var(--border);padding-top:6px">${escapeHTML(r.detalle)}</div>` : ''}
    <div style="margin-top:8px;border-top:var(--border);padding-top:8px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13px;font-weight:600">Total</span>
      <span style="font-size:18px;font-weight:700;color:#185FA5">${fmtCLP(r.total)}</span>
    </div>
  `;
  document.getElementById('detail-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('detail-modal').classList.remove('open');
  curId = null; _curReceipt = null;
}

async function deleteReceipt() {
  if (!confirm('¿Eliminar este recibo? Esta acción no se puede deshacer.')) return;
  await delReceiptDB(curId); closeModal(); toast('Recibo eliminado'); renderReceipts();
}

// ── 7. PDF recibo individual ──────────────────────────────
function exportPDF() {
  if (!_curReceipt) { toast('Sin recibo seleccionado'); return; }
  if (!jsPDF) { toast('jsPDF no cargó, intenta de nuevo'); return; }
  const r = _curReceipt;
  const doc = new jsPDF({ unit: 'mm', format: 'a5', orientation: 'portrait' });
  const W = 148, M = 14;

  doc.setFillColor(24, 95, 165); doc.rect(0, 0, W, 20, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(255, 255, 255);
  doc.text('RECIBO DE SERVICIO', W / 2, 11, { align: 'center' });
  doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.text('TransferLog · Traslado de Personal', W / 2, 16.5, { align: 'center' });

  let y = 27;
  const box = (label, val, x, cy) => {
    if (!val) return;
    doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(110, 110, 110);
    doc.text(label, x, cy);
    doc.setFontSize(9); doc.setTextColor(20, 20, 20);
    doc.text(String(val), x, cy + 5);
  };
  const hline = () => { doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.2); doc.line(M, y - 1, W - M, y - 1); };

  if (r.vehiculo) {
    doc.setFontSize(8); doc.setTextColor(24, 95, 165); doc.setFont('helvetica', 'bold');
    doc.text('● ' + r.vehiculo, M, y); y += 7;
  }
  box('Fecha', fmtDate(r.fecha), M, y);
  box('Chofer', r.chofer, M + 38, y);
  box('Área', r.area, M + 90, y);
  y += 11; hline(); y += 3;

  box('Solicita', r.solicita, M, y);
  box('Empresa', r.empresa, M + 65, y);
  y += 11; hline(); y += 3;

  box('Centro de costo', r.costo, M, y);
  y += 11; hline(); y += 3;

  box('Traslado desde', r.desde, M, y);
  box('Hasta', r.hasta, M + 65, y);
  y += 11; hline(); y += 3;

  box('H. Inicio', r.hinicio, M, y);
  box('Tdo. Espera', r.espera, M + 38, y);
  box('Fin servicio', r.fin, M + 78, y);
  y += 11; hline(); y += 3;

  if (Number(r.paradas_adicionales || 0) > 0) {
    box('Paradas adicionales', r.paradas_adicionales, M, y);
    y += 11; hline(); y += 3;
  }

  if (r.detalle) {
    doc.setFontSize(7); doc.setTextColor(110, 110, 110); doc.setFont('helvetica', 'normal');
    doc.text('Detalle del servicio', M, y); y += 4;
    doc.setFontSize(8); doc.setTextColor(20, 20, 20);
    const lines = doc.splitTextToSize(r.detalle, W - 2 * M);
    doc.text(lines, M, y); y += lines.length * 4 + 5;
    hline(); y += 3;
  }

  doc.setFillColor(230, 241, 251); doc.roundedRect(M, y, W - 2 * M, 15, 2, 2, 'F');
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(24, 95, 165);
  doc.text('TOTAL', M + 4, y + 6);
  doc.setFontSize(14); doc.setFont('helvetica', 'bold');
  doc.text(fmtCLP(r.total), W - M - 4, y + 10, { align: 'right' });
  y += 20;

  doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.3);
  doc.line(M, y + 8, M + 55, y + 8);
  doc.setFontSize(7); doc.setTextColor(150, 150, 150); doc.setFont('helvetica', 'normal');
  doc.text('Firma', M, y + 12);
  doc.text('Recibo #' + r.num + ' · ' + new Date().toLocaleDateString('es-CL'), W - M, y + 12, { align: 'right' });

  doc.save('recibo-' + r.num + '-' + r.fecha + '.pdf');
  toast('PDF descargado ✓');
}

// ── Resumen ───────────────────────────────────────────────
function toggleChip(btn, val) {
  document.querySelectorAll('#veh-filter .chip').forEach(c => c.classList.remove('on'));
  btn.classList.add('on'); vehFilter = val;
}

async function calcSummary() {
  const from = document.getElementById('sum-from').value;
  const to   = document.getElementById('sum-to').value;
  let receipts = await getReceipts();
  if (from) receipts = receipts.filter(r => r.fecha >= from);
  if (to)   receipts = receipts.filter(r => r.fecha <= to);
  if (vehFilter !== 'todos') receipts = receipts.filter(r => r.vehiculo === vehFilter);
  const total = receipts.reduce((a, r) => a + Number(r.total), 0);
  const byVeh = {};
  receipts.forEach(r => { const v = r.vehiculo || 'Sin tipo'; byVeh[v] = (byVeh[v] || 0) + Number(r.total); });
  const cont = document.getElementById('summary-results');
  if (!receipts.length) { cont.innerHTML = '<div class="card"><div class="empty" style="padding:14px">Sin resultados para ese período</div></div>'; return; }
  cont.innerHTML = `
    <div class="sg">
      <div class="st"><div class="sl">Total recibos</div><div class="sv">${receipts.length}</div></div>
      <div class="st"><div class="sl">Total ($)</div><div class="sv blue">${fmtCLP(total)}</div></div>
    </div>
    <div class="card">
      <div class="ct">Por tipo de vehículo</div>
      ${Object.entries(byVeh).map(([v,t]) => `<div class="tr"><span style="font-size:12px">${v}</span><span style="font-size:13px;font-weight:600">${fmtCLP(t)}</span></div>`).join('<div class="hr"></div>')}
    </div>
    <div class="card">
      <div class="ct">Recibos del período</div>
      ${receipts.slice().reverse().map(r => `
        <div class="ri" onclick="openReceipt('${r.id}')">
          <div class="rh">
            <div>
              <span class="rn">#${r.num}</span>
              <span class="rd" style="margin-left:5px">${fmtDate(r.fecha)}</span>
              <div class="rd">${escapeHTML(r.solicita || '')}${r.empresa ? ' · ' + escapeHTML(r.empresa) : ''}</div>
            </div>
            <div style="font-size:13px;font-weight:600">${fmtCLP(r.total)}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ── PDF resumen ───────────────────────────────────────────
async function exportSummaryPDF() {
  if (!jsPDF) { toast('jsPDF no disponible'); return; }
  const from = document.getElementById('sum-from').value;
  const to   = document.getElementById('sum-to').value;
  let receipts = await getReceipts();
  if (from) receipts = receipts.filter(r => r.fecha >= from);
  if (to)   receipts = receipts.filter(r => r.fecha <= to);
  if (vehFilter !== 'todos') receipts = receipts.filter(r => r.vehiculo === vehFilter);
  if (!receipts.length) { toast('Sin datos para exportar'); return; }
  const total = receipts.reduce((a, r) => a + Number(r.total), 0);

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 14;

  doc.setFillColor(24, 95, 165); doc.rect(0, 0, W, 22, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(255, 255, 255);
  doc.text('RESUMEN DE SERVICIOS DE TRANSPORTE', W / 2, 13, { align: 'center' });
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text(`Período: ${from ? fmtDate(from) : 'inicio'} — ${to ? fmtDate(to) : 'hoy'}`, W / 2, 18.5, { align: 'center' });

  let y = 30;
  doc.setFillColor(230, 241, 251); doc.roundedRect(M, y, 87, 16, 2, 2, 'F');
  doc.setFontSize(8); doc.setTextColor(24, 95, 165); doc.text('Total recibos', M + 4, y + 6);
  doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.text(String(receipts.length), M + 4, y + 13);

  doc.setFillColor(225, 245, 238); doc.roundedRect(M + 92, y, 90, 16, 2, 2, 'F');
  doc.setFontSize(8); doc.setTextColor(15, 110, 86); doc.text('Monto total', M + 96, y + 6);
  doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 110, 86);
  doc.text(fmtCLP(total), M + 96, y + 13);
  y += 24;

  const cols = ['#', 'Fecha', 'Solicita', 'Empresa', 'Vehículo', 'Desde', 'Hasta', 'Total'];
  const xs   = [M, M+10, M+24, M+68, M+104, M+126, M+150, M+170];
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(80, 80, 80);
  cols.forEach((h, i) => doc.text(h, xs[i], y));
  y += 2; doc.setDrawColor(24, 95, 165); doc.setLineWidth(0.5); doc.line(M, y, W - M, y); y += 4;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setLineWidth(0.2);
  receipts.forEach((r, idx) => {
    if (idx % 2 === 0) { doc.setFillColor(248, 249, 250); doc.rect(M, y - 3, W - 2 * M, 7, 'F'); }
    doc.setTextColor(30, 30, 30);
    const vals = [
      String(r.num), fmtDate(r.fecha),
      (r.solicita || '').substring(0, 18),
      (r.empresa  || '').substring(0, 18),
      (r.vehiculo || ''),
      (r.desde    || '').substring(0, 12),
      (r.hasta    || '').substring(0, 12),
      fmtCLP(r.total)
    ];
    vals.forEach((v, i) => doc.text(v, xs[i], y + 1));
    y += 7;
    if (y > 272) { doc.addPage(); y = 20; }
  });

  doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); y += 5;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(24, 95, 165);
  doc.text('TOTAL: ' + fmtCLP(total), W - M, y, { align: 'right' });
  y += 10;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(160, 160, 160);
  doc.text('Generado el ' + new Date().toLocaleDateString('es-CL') + ' · TransferLog', W / 2, y, { align: 'center' });

  doc.save('resumen-transferlog-' + new Date().toISOString().split('T')[0] + '.pdf');
  toast('PDF resumen descargado ✓');
}

// ── 8. Configuración ──────────────────────────────────────
function renderConfig() {
  document.getElementById('cfg-stop-value').value = getExtraStopValue() || '';
  renderCatalogControls();
  renderCatalogs();
}

function saveExtraStopValue() {
  LS.settings = { ...LS.settings, extraStopValue: Number(document.getElementById('cfg-stop-value').value || 0) };
  updateReceiptTotal();
  toast('Valor por parada guardado ✓');
}

function renderCatalogControls() {
  const catalogs = LS.catalogs;
  const selectMap = {
    choferes:     { id: 'f-chofer',   placeholder: 'Seleccionar chofer' },
    areas:        { id: 'f-area',     placeholder: 'Seleccionar área' },
    solicitantes: { id: 'f-solicita', placeholder: 'Seleccionar solicitante' },
    empresas:     { id: 'f-empresa',  placeholder: 'Seleccionar empresa' },
    costos:       { id: 'f-costo',    placeholder: 'Seleccionar centro de costo' }
  };
  Object.entries(selectMap).forEach(([key, cfg]) => {
    const select = document.getElementById(cfg.id); if (!select) return;
    const current = select.value;
    const options = (catalogs[key] || []).map(v => `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join('');
    select.innerHTML = `<option value="">— ${cfg.placeholder} —</option>${options}`;
    if ((catalogs[key] || []).includes(current)) select.value = current;
  });
}

function addCatalogItem() {
  const type  = document.getElementById('cfg-catalog-type').value;
  const input = document.getElementById('cfg-catalog-value');
  const value = input.value.trim();
  if (!value) { toast('Escribe un dato para guardar'); return; }
  const catalogs = LS.catalogs;
  const exists = (catalogs[type] || []).some(x => x.toLowerCase() === value.toLowerCase());
  if (!exists) catalogs[type] = [...(catalogs[type] || []), value].sort((a, b) => a.localeCompare(b, 'es'));
  LS.catalogs = catalogs;
  input.value = '';
  renderCatalogControls();
  renderCatalogs();
  toast(exists ? 'Ese dato ya estaba guardado' : 'Dato guardado ✓');
}

function deleteCatalogItem(type, value) {
  const catalogs = LS.catalogs;
  catalogs[type] = (catalogs[type] || []).filter(x => x !== value);
  LS.catalogs = catalogs;
  renderCatalogControls();
  renderCatalogs();
  toast('Dato eliminado');
}

function renderCatalogs() {
  const cont = document.getElementById('catalogs-list');
  const catalogs = LS.catalogs;
  const html = Object.entries(CATALOG_LABELS).map(([key, label]) => {
    const values = catalogs[key] || [];
    const body = values.length
      ? values.map(v => `
          <div class="catalog-row">
            <span>${escapeHTML(v)}</span>
            <button class="btn sm danger" onclick="deleteCatalogItem('${key}', decodeURIComponent('${encodeURIComponent(v)}'))"><i class="ti ti-trash"></i></button>
          </div>
        `).join('')
      : '<div class="empty compact">Sin datos guardados</div>';
    return `<div class="catalog-group"><div class="catalog-title">${label}</div>${body}</div>`;
  }).join('');
  cont.innerHTML = html;
}

function clearLocal() {
  if (!confirm('¿Eliminar todos los datos locales? No se puede deshacer.')) return;
  localStorage.removeItem('tl_r'); localStorage.removeItem('tl_p');
  localStorage.removeItem('tl_catalogs'); localStorage.removeItem('tl_settings');
  toast('Datos locales eliminados'); renderReceipts();
}

// ── Cerrar modal al tocar fondo ───────────────────────────
document.getElementById('detail-modal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

// ── 9. Init ───────────────────────────────────────────────
const today = new Date().toISOString().split('T')[0];
document.getElementById('sum-from').value = today.substring(0, 8) + '01';
document.getElementById('sum-to').value   = today;

async function initAppData() {
  renderCatalogControls();
  initForm();
  renderReceipts();
}

// Arrancar auth listener (muestra login o app según sesión)
setupAuthListener();

// SQL para Supabase con user_id y RLS por usuario
const SQL_SETUP = `-- Agregar user_id a tablas existentes (si no lo tienen):
alter table routes   add column if not exists user_id uuid references auth.users(id);
alter table receipts add column if not exists user_id uuid references auth.users(id);

-- Habilitar RLS
alter table routes   enable row level security;
alter table receipts enable row level security;

-- Políticas: cada usuario solo ve sus propios datos
drop policy if exists "user_routes"   on routes;
drop policy if exists "user_receipts" on receipts;

create policy "user_routes"   on routes   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_receipts" on receipts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);`;