const SURL = 'https://vmzjliweaepogktddagh.supabase.co';
const SKEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtempsaXdlYWVwb2drdGRkYWdoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NjYyNDgsImV4cCI6MjA4ODA0MjI0OH0.zdbeHj7QTB7svRqdYqd2ymfpyLKa8CFI0XSEA8Nbbok';
const sb = supabase.createClient(SURL, SKEY);

async function hashPin(p) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(p));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
}

let usuario = null, vehiculos = [], offQ = JSON.parse(localStorage.getItem('oq') || '[]'), isOnline = navigator.onLine;
let flotaOpen = false, pinVisible = false, filtroTipo = 'todo', trazaPagina = 1;
const TRAZA_POR_PAG = 30;

const TIPOS_MANT = [
  'Cambio de aceite y filtro', 'Cambio de filtro de aire', 'Cambio de filtro de combustible',
  'Cambio de filtro de habitáculo', 'Revisión y cambio de llantas', 'Revisión y ajuste de frenos',
  'Cambio de pastillas de freno', 'Cambio de discos de freno', 'Revisión de líquido de frenos',
  'Revisión de suspensión', 'Cambio de amortiguadores', 'Alineación y balanceo',
  'Revisión de dirección', 'Revisión de transmisión', 'Cambio de líquido de transmisión',
  'Revisión de diferencial', 'Revisión sistema eléctrico', 'Cambio de batería',
  'Revisión de alternador', 'Revisión de motor de arranque', 'Revisión sistema de refrigeración',
  'Cambio de líquido refrigerante', 'Revisión de radiador', 'Revisión sistema de escape',
  'Revisión de bujías', 'Cambio de bujías', 'Revisión correa de distribución',
  'Cambio correa de distribución', 'Revisión correa de accesorios', 'Revisión clutch / embrague',
  'Revisión de caja de cambios', 'Revisión sistema A/C', 'Carga de gas A/C',
  'Revisión de luces', 'Revisión de limpiabrisas', 'Cambio de limpiabrisas',
  'Revisión general preventiva', 'Revisión técnico-mecánica', 'Diagnóstico electrónico (OBD)',
  'Pintura y carrocería', 'Revisión vidrios y espejos', 'Otro (ver descripción)'
];

let tiposSeleccionados = [];

/* NAVEGACIÓN EXTRA */
function abrirEstadoFlota() {
  ir('seccionEstadoFlota');
  cargarFlota();
}

function abrirProgramarMant() {
  ir('seccionProgramarMant');
  poblarSelects(vehiculos); // Re-usa la lista de vehículos
  document.getElementById('pmVehiculo').value = '';
  document.getElementById('pmRazonWrap').style.display = 'none';
  document.getElementById('pmFallaWrap').style.display = 'none';
  document.getElementById('pmFechaWrap').style.display = 'none';
  document.getElementById('pmDescWrap').style.display = 'none';
  document.getElementById('btnGuardarPm').style.display = 'none';
  cargarPmFallasBanner();
}

async function cargarPmFallasBanner() {
  const banner = document.getElementById('pmFallasBanner');
  const bannerList = document.getElementById('pmFallasBannerList');
  const bannerTitle = document.getElementById('pmFallasBannerTitle');

  // Get all pending faults
  const { data: fallas } = await sb.from('fault_reports')
    .select('*,vehicles(unit_code,plate,brand,model),users(full_name)')
    .eq('is_active', true)
    .in('status', ['pendiente', 'en_revision'])
    .order('created_at', { ascending: false });

  // Get work orders that have a fault_report linked (programado)
  const { data: wos } = await sb.from('work_orders')
    .select('fault_report_id')
    .eq('is_active', true)
    .eq('status', 'programado')
    .not('fault_report_id', 'is', null);

  const programadasIds = new Set((wos || []).map(w => w.fault_report_id));
  const sinProgramar = (fallas || []).filter(f => !programadasIds.has(f.id));

  if (sinProgramar.length === 0) {
    banner.classList.remove('show');
    return;
  }

  banner.classList.add('show');
  bannerTitle.innerHTML = `<i class="fi fi-sr-engine-warning"></i> ${sinProgramar.length} falla(s) sin programar — Selecciona una falla para asignarle fecha`;

  const sevColor = { critico: '#7b0000', urgente: 'var(--rojo)', moderado: 'var(--naranja)', leve: 'var(--verde)' };
  const sevLabel = { critico: 'Crítico', urgente: 'Urgente', moderado: 'Moderado', leve: 'Leve' };
  bannerList.innerHTML = sinProgramar.map(f => `
        <div class="pm-falla-item" onclick="preseleccionarFalla('${f.vehicle_id}','${f.id}')">
          <span class="pm-falla-item-chip" style="background:${sevColor[f.severity] || '#e74c3c'}22;color:${sevColor[f.severity] || '#e74c3c'};border:1px solid ${sevColor[f.severity] || '#e74c3c'}44">${sevLabel[f.severity] || f.severity}</span>
          <div class="pm-falla-item-body">
            <div class="pm-falla-item-unit">${f.vehicles?.unit_code} — ${f.vehicles?.brand} ${f.vehicles?.model}</div>
            <div class="pm-falla-item-desc">${f.description?.substring(0, 80)}${f.description?.length > 80 ? '...' : ''}</div>
            <div class="pm-falla-item-meta">${fmtDate(f.created_at)} · ${f.vehicles?.plate} · <b>Reportó: ${f.users?.full_name || 'Desconocido'}</b></div>
          </div>
          <div style="font-size:11px;color:var(--azul);font-weight:700;flex-shrink:0;padding-top:2px">Programar →</div>
        </div>
      `).join('');
}

async function preseleccionarFalla(vehicleId, fallaId) {
  // Pre-select vehicle, type = correctivo, and the fault
  const pmVeh = document.getElementById('pmVehiculo');
  pmVeh.value = vehicleId;
  await onPmVehiculoChange();
  const pmTipo = document.getElementById('pmTipo');
  pmTipo.value = 'correctivo';
  await onPmTipoChange();
  // Wait for faults to load then select
  setTimeout(() => {
    const pmFalla = document.getElementById('pmFalla');
    pmFalla.value = fallaId;
    onPmFallaChange();
    // Scroll to form
    document.querySelector('#seccionProgramarMant .form-card').scrollIntoView({ behavior: 'smooth' });
  }, 700);
}

/* OFFLINE */
window.addEventListener('online', async () => { isOnline = true; document.getElementById('offlineBar').classList.remove('show'); await syncOffline(); });
window.addEventListener('offline', () => { isOnline = false; document.getElementById('offlineBar').classList.add('show'); });
async function syncOffline() {
  if (!offQ.length) return; toast('Sincronizando...', '');
  const q = [...offQ]; offQ = []; localStorage.setItem('oq', '[]');
  for (const i of q) {
    try {
      if (i.t === 'km') { await sb.from('km_logs').insert(i.d); await sb.from('vehicles').update({ km_current: i.d.km_recorded }).eq('id', i.d.vehicle_id); }
      else if (i.t === 'mant') { await sb.from('maintenance_logs').insert(i.d); }
    } catch (e) { console.error(e); }
  }
  toast('✅ Datos sincronizados', 'ok'); cargarFlota();
}

function ir(id) {
  document.querySelectorAll('.seccion-app,.subpagina').forEach(s => s.classList.remove('activa'));
  document.getElementById(id)?.classList.add('activa');
  window.scrollTo(0, 0);
}
function tab(id, btn) {
  const p = document.getElementById(id).closest('.subpagina');
  p.querySelectorAll('.tab-panel').forEach(t => t.classList.remove('activo'));
  p.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('activo'));
  document.getElementById(id).classList.add('activo'); btn?.classList.add('activo');
  if (id === 'tUsers') cargarUsers();
  if (id === 'tVehs') cargarVehsAdmin();
  if (id === 'tRegKm') cargarAdminKm();
  if (id === 'tRegMant') cargarAdminMant();
  if (id === 'tFallas') cargarAdminFallas();
  if (id === 'tChecklists') { poblarMesesAdminCheck(); cargarAdminChecklists(); }
  if (id === 'tRep') cargarStats();
}
function abrirModal(id) { document.getElementById(id).classList.add('open'); }
function cerrarModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-bg').forEach(o => o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); }));
function toast(msg, tipo = '') { const t = document.getElementById('toast'); t.textContent = msg; t.className = 'toast show ' + tipo; setTimeout(() => t.className = 'toast', 3200); }
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function fmtKm(n) { return parseInt(n || 0).toLocaleString('es'); }
function fmtDate(d) {
  if (!d) return '—';
  // Si es solo fecha YYYY-MM-DD, forzamos interpretación local
  if (typeof d === 'string' && d.includes('-') && d.length <= 10) {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  return new Date(d).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ═══════ MULTISELECT MANTENIMIENTO ═══════ */
function initMantDropdown() {
  renderMantOptions('');
}
function renderMantOptions(filtro) {
  const lista = document.getElementById('mantOptionsList');
  const f = filtro.toLowerCase();
  const items = TIPOS_MANT.filter(t => t.toLowerCase().includes(f));
  lista.innerHTML = items.map(t => {
    const sel = tiposSeleccionados.includes(t);
    return `<div class="mant-option${sel ? ' selected' : ''}" onclick="toggleTipo('${t.replace(/'/g, "\\'")}')">
      <input type="checkbox" ${sel ? 'checked' : ''} onclick="event.stopPropagation()"> ${t}
    </div>`;
  }).join('');
}
function filtrarActividades(val) { renderMantOptions(val); }
function toggleTipo(tipo) {
  const idx = tiposSeleccionados.indexOf(tipo);
  if (idx >= 0) tiposSeleccionados.splice(idx, 1);
  else tiposSeleccionados.push(tipo);
  renderMantOptions(document.getElementById('mantSearchInput').value);
  renderMantTags();
  actualizarLabelDropdown();
}
function renderMantTags() {
  const el = document.getElementById('mantSelectedTags');
  el.innerHTML = tiposSeleccionados.map(t =>
    `<div class="mant-tag">${t}<span class="mant-tag-x" onclick="toggleTipo('${t.replace(/'/g, "\\'")}')">×</span></div>`
  ).join('');
}
function actualizarLabelDropdown() {
  const lbl = document.getElementById('mantDropLabel');
  const btn = document.getElementById('mantDropBtn');
  if (tiposSeleccionados.length === 0) { lbl.textContent = 'Selecciona las actividades...'; }
  else { lbl.innerHTML = `${tiposSeleccionados.length} actividad${tiposSeleccionados.length > 1 ? 'es' : ''} seleccionada${tiposSeleccionados.length > 1 ? 's' : ''} <span class="mant-count-badge">${tiposSeleccionados.length}</span>`; }
}
function toggleMantDropdown() {
  const panel = document.getElementById('mantDropPanel');
  const btn = document.getElementById('mantDropBtn');
  const isOpen = panel.classList.contains('open');
  panel.classList.toggle('open', !isOpen);
  btn.classList.toggle('open', !isOpen);
  if (!isOpen) document.getElementById('mantSearchInput').focus();
}
// Cerrar dropdown al click fuera
document.addEventListener('click', e => {
  const wrap = document.querySelector('.mant-multiselect-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('mantDropPanel')?.classList.remove('open');
    document.getElementById('mantDropBtn')?.classList.remove('open');
  }
});
function limpiarMantDropdown() {
  tiposSeleccionados = [];
  renderMantOptions(''); renderMantTags(); actualizarLabelDropdown();
  document.getElementById('mantSearchInput').value = '';
  document.getElementById('mantDropPanel').classList.remove('open');
  document.getElementById('mantDropBtn').classList.remove('open');
}

/* ═══════ LOGIN ═══════ */
async function iniciarSesion() {
  const ced = document.getElementById('loginCedula').value.trim();
  const pin = document.getElementById('loginPin').value;
  const err = document.getElementById('errorLogin');
  const btn = document.getElementById('btnEntrar');
  err.textContent = '';
  if (!ced || !pin) { err.textContent = 'Ingresa tu cédula y PIN'; return; }
  btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Verificando...';
  try {
    const ph = await hashPin(pin);
    // Usar maybeSingle() en lugar de single() para evitar error 406 cuando no hay coincidencia
    const { data, error } = await sb.from('users').select('*,vehicles(*)').eq('cedula', ced).eq('pin_hash', ph).eq('is_active', true).maybeSingle();
    btn.disabled = false; btn.textContent = 'Iniciar Sesión';
    if (error) { console.error('Error de login:', error); err.textContent = 'Error de conexión. Intenta nuevamente.'; return; }
    if (!data) { err.textContent = 'Cédula o PIN incorrecto. Contacta al administrador.'; return; }
    usuario = data;
    localStorage.setItem('sesion', JSON.stringify({ id: data.id, ts: Date.now() }));
    entrar();
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Iniciar Sesión';
    err.textContent = 'Error de conexión. Verifica tu internet e intenta nuevamente.';
    console.error('Error en iniciarSesion:', e);
  }
}
async function cerrarSesion() {
  cerrarModal('mSalir');
  localStorage.removeItem('sesion'); usuario = null; location.reload();
}
(async () => {
  const s = localStorage.getItem('sesion');
  if (s) {
    try {
      const j = JSON.parse(s);
      if (Date.now() - j.ts < 8 * 60 * 60 * 1000) {
        // Usar maybeSingle() para evitar 406 si el usuario fue eliminado
        const { data } = await sb.from('users').select('*,vehicles(*)').eq('id', j.id).eq('is_active', true).maybeSingle();
        if (data) { usuario = data; entrar(); return; }
      }
    } catch (e) { console.error('Error al restaurar sesión:', e); }
    localStorage.removeItem('sesion');
  }
})();

/* ═══════ CLOUDINARY ═══════ */
const CLOUD_NAME = 'dbpcwzgka';
const UPLOAD_PRESET = 'Flota GS';

async function subirFotoCloudinary(file, onProgress) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', UPLOAD_PRESET);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`);
    xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / e.total * 100)); };
    xhr.onload = () => {
      const r = JSON.parse(xhr.responseText);
      if (r.secure_url) resolve(r.secure_url);
      else reject(new Error('Upload failed'));
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(fd);
  });
}

/* ═══════ ENTRAR ═══════ */
async function entrar() {
  document.body.classList.add('app-mode');
  document.getElementById('seccionLogin').style.display = 'none';
  document.getElementById('headerApp').classList.remove('hidden');
  document.getElementById('footer').classList.remove('login');
  document.getElementById('hNombre').textContent = usuario.full_name;
  document.getElementById('hRol').textContent = cap(usuario.role);
  document.getElementById('mSalirNombre').textContent = usuario.full_name;
  if (usuario.vehicles) {
    document.getElementById('hUnidad').textContent = `🚛 ${usuario.vehicles.unit_code} · ${usuario.vehicles.brand} ${usuario.vehicles.model}`;
  } else {
    document.getElementById('hUnidad').textContent = 'Sin unidad asignada';
  }

  initMantDropdown();

  const rol = usuario.role;
  const sublabels = {
    conductor: 'Selecciona una opción para continuar.',
    mecanico: 'Gestiona los servicios técnicos de la flota.',
    administrador: 'Tienes acceso completo al sistema.'
  };
  document.getElementById('dashSubLabel').textContent = sublabels[rol] || '¿Qué vas a gestionar hoy?';

  let cards = '';
  if (rol === 'conductor') {
    cards += `<div class="menu-card" onclick="abrirKm()"><i class="fi fi-sr-tachometer-alt-fastest"></i><div class="mc-titulo">Kilometraje</div><p>Registra el Kilometraje actual de tu unidad.</p></div>`;
    cards += `<div class="menu-card" onclick="abrirChecklist()"><i class="fi fi-sr-clipboard-list"></i><div class="mc-titulo">Inspecci&#243;n</div><p>Inspección rápida de tu unidad antes de salir.</p></div>`;
    cards += `<div class="menu-card" onclick="abrirFalla()"><i class="fi fi-sr-triangle-warning"></i><div class="mc-titulo">Reportar Falla</div><p>Notifica un problema o daño en tu unidad.</p></div>`;
    cards += `<div class="menu-card" onclick="abrirTraza()"><i class="fi fi-sr-rectangle-list"></i><div class="mc-titulo">Trazabilidad</div><p>Historial unificado de KM y servicios.</p></div>`;
    document.getElementById('contenedorMenuEstandar').style.display = 'block';
    document.getElementById('menuGridEstandar').innerHTML = cards;
  }
  if (rol === 'mecanico') {
    cards += `<div class="menu-card" onclick="abrirMant()"><i class="fi fi-br-tools"></i><div class="mc-titulo">Mantenimiento</div><p>Registra servicios técnicos realizados.</p></div>`;
    cards += `<div class="menu-card" onclick="abrirTraza()"><i class="fi fi-sr-rectangle-list"></i><div class="mc-titulo">Trazabilidad</div><p>Consulta el historial de servicios.</p></div>`;
    document.getElementById('contenedorMenuEstandar').style.display = 'block';
    document.getElementById('menuGridEstandar').innerHTML = cards;
  }
  // Show work order search card for both mecanico and administrador
  const woCard = document.getElementById('woSearchCard');
  if (woCard) woCard.style.display = (rol === 'mecanico' || rol === 'administrador') ? 'block' : 'none';
  if (rol === 'administrador') {
    let cardsEstandar = '';
    cardsEstandar += `<div class="menu-card" onclick="abrirChecklist()"><i class="fi fi-sr-clipboard-list"></i><div class="mc-titulo">Inspecci&#243;n</div><p>Inspección rápida de unidad antes de salir.</p></div>`;
    cardsEstandar += `<div class="menu-card" onclick="abrirKm()"><i class="fi fi-sr-tachometer-alt-fastest"></i><div class="mc-titulo">Kilometraje</div><p>Registra el Kilometraje actual de tu unidad.</p></div>`;
    cardsEstandar += `<div class="menu-card" onclick="abrirFalla()"><i class="fi fi-sr-triangle-warning"></i><div class="mc-titulo">Reportar Falla</div><p>Notifica un problema o daño en una unidad.</p></div>`;
    cardsEstandar += `<div class="menu-card" onclick="abrirMant()"><i class="fi fi-br-tools"></i><div class="mc-titulo">Mantenimiento</div><p>Registra servicios técnicos realizados.</p></div>`;
    cardsEstandar += `<div class="menu-card" onclick="abrirTraza()"><i class="fi fi-sr-rectangle-list"></i><div class="mc-titulo">Trazabilidad</div><p>Historial unificado de KM y servicios.</p></div>`;

    let cardsAdmin = '';
    cardsAdmin += `<div class="menu-card" onclick="abrirAdmin()"><i class="fi fi-sr-settings"></i><div class="mc-titulo">Administración</div><p>Usuarios, vehículos, fallas y reportes.</p></div>`;
    cardsAdmin += `<div class="menu-card" onclick="abrirEstadoFlota()"><i class="fi fi-sr-car-alt"></i><div class="mc-titulo">Estado de Flota</div><p>Vista general y mantenimientos pendientes.</p></div>`;
    cardsAdmin += `<div class="menu-card" onclick="abrirProgramarMant()"><i class="fi fi-sr-calendar-clock"></i><div class="mc-titulo">Programar Mantenimiento</div><p>Atender fallas y mantenimientos preventivos.</p></div>`;
    cardsAdmin += `<div class="menu-card" onclick="abrirWorkOrders()"><i class="fi fi-sr-clipboard-list-check"></i><div class="mc-titulo">Órdenes de Trabajo</div><p>Gestionar y generar reportes PDF.</p></div>`;

    document.getElementById('contenedorMenuEstandar').style.display = 'block';
    document.getElementById('menuGridEstandar').innerHTML = cardsEstandar;
    document.getElementById('contenedorMenuAdmin').style.display = 'block';
    document.getElementById('menuGridAdmin').innerHTML = cardsAdmin;
  }

  // Ocultar el antiguo menúGrid genérico por seguridad
  const genericGrid = document.getElementById('menuGrid');
  if (genericGrid) genericGrid.style.display = 'none';

  ir('seccionDashboard');
  await cargarFlota();

  // AVISOS INTELIGENTES EN EL HEADER
  await actualizarAvisosHeader();
}

/* ═══════ AVISOS HEADER ═══════ */
async function actualizarAvisosHeader() {
  const centro = document.getElementById('headerNotifyCenter');
  if (!centro) return;
  centro.innerHTML = '';
  centro.style.display = 'flex';
  const rol = usuario?.role;

  if (rol === 'administrador') {
    // Consultar fallas pendientes (no programadas aún: status pendiente, sin work_order asociada)
    const { data: fallasAll } = await sb.from('fault_reports')
      .select('id, status')
      .eq('is_active', true)
      .eq('status', 'pendiente');
    // Work orders activas
    const { data: wos } = await sb.from('work_orders').select('fault_report_id').eq('is_active', true).eq('status', 'programado');
    const woFallaIds = new Set((wos || []).map(w => w.fault_report_id).filter(Boolean));
    const fallasSinProg = (fallasAll || []).filter(f => !woFallaIds.has(f.id));

    if (fallasSinProg.length > 0) {
      const badge = document.createElement('div');
      badge.className = 'header-notice-badge danger';
      badge.innerHTML = `<i class="fi fi-sr-engine-warning"></i> ${fallasSinProg.length} falla${fallasSinProg.length > 1 ? 's' : ''} pendiente${fallasSinProg.length > 1 ? 's' : ''} por programar`;
      badge.onclick = () => abrirProgramarMant();
      centro.appendChild(badge);
    }

    // Vehículos urgentes
    const urgentes = vehiculos.filter(v => pct(v) >= 90).length;
    if (urgentes > 0) {
      const badge2 = document.createElement('div');
      badge2.className = 'header-notice-badge warn';
      badge2.innerHTML = `<i class="fi fi-sr-triangle-warning"></i> ${urgentes} unidad${urgentes > 1 ? 'es' : ''} requiere${urgentes > 1 ? 'n' : ''} mantenimiento`;
      badge2.onclick = () => abrirEstadoFlota();
      centro.appendChild(badge2);
    }

    if (fallasSinProg.length === 0 && urgentes === 0) {
      const badge3 = document.createElement('div');
      badge3.className = 'header-notice-badge ok';
      badge3.innerHTML = `<i class="fi fi-sr-badge-check"></i> Flota al día · Todo en orden`;
      centro.appendChild(badge3);
    }

  } else if (rol === 'mecanico') {
    // Órdenes de trabajo programadas para el mecánico
    const { data: wos } = await sb.from('work_orders').select('id, scheduled_date, vehicles(unit_code)').eq('is_active', true).eq('status', 'programado').order('scheduled_date', { ascending: true }).limit(3);
    if (wos && wos.length > 0) {
      const badge = document.createElement('div');
      badge.className = 'header-notice-badge info';
      badge.innerHTML = `<i class="fi fi-sr-calendar-clock"></i> ${wos.length} orden${wos.length > 1 ? 'es' : ''} de trabajo pendiente${wos.length > 1 ? 's' : ''}`;
      badge.onclick = () => abrirMant();
      centro.appendChild(badge);
    } else {
      const badge = document.createElement('div');
      badge.className = 'header-notice-badge ok';
      badge.innerHTML = `<i class="fi fi-sr-badge-check"></i> Sin órdenes pendientes`;
      centro.appendChild(badge);
    }

  } else if (rol === 'conductor') {
    if (usuario.vehicle_id) {
      const { data: wo } = await sb.from('work_orders').select('id,scheduled_date,type,description').eq('vehicle_id', usuario.vehicle_id).eq('is_active', true).eq('status', 'programado').order('scheduled_date', { ascending: true }).limit(1).maybeSingle();
      if (wo) {
        const badge = document.createElement('div');
        badge.className = 'header-notice-badge amber';
        badge.style.fontSize = '14px';
        badge.innerHTML = `<i class="fi fi-sr-calendar-clock"></i> Mantenimiento Próximo: ${fmtDate(wo.scheduled_date)}`;
        badge.onclick = () => verDetalleMant(wo.id);
        centro.appendChild(badge);
      } else {
        const badge = document.createElement('div');
        badge.className = 'header-notice-badge ok';
        badge.innerHTML = `<i class="fi fi-sr-badge-check"></i> Unidad al día · Sin mantenimientos programados`;
        centro.appendChild(badge);
      }
    }
  }
}

async function verDetalleMant(woId) {
  const { data: wo, error } = await sb.from('work_orders').select('*, vehicles(unit_code)').eq('id', woId).eq('is_active', true).maybeSingle();
  if (error || !wo) return toast('No se encontró información de la orden', 'err');

  document.getElementById('mWoDetalleId').textContent = `WO-${wo.id.substring(0, 4).toUpperCase()}`;
  document.getElementById('mWoDetalleFecha').textContent = fmtDate(wo.scheduled_date);
  document.getElementById('mWoDetalleTipo').textContent = cap(wo.type);
  document.getElementById('mWoDetalleDesc').textContent = wo.description || 'El administrador no dejó instrucciones adicionales.';

  abrirModal('mWoDetalle');
}

/* ═══════ FLOTA ═══════ */
function pct(v) {
  if (!v.km_interval || v.km_interval === 0) return 0;
  return Math.min(100, Math.max(0, Math.round(((v.km_current - v.km_last_maintenance) / v.km_interval) * 100)));
}
function kmFalta(v) { return Math.max(0, (v.km_last_maintenance + v.km_interval) - v.km_current); }
function colorBarra(p) { return p >= 90 ? 'var(--rojo)' : p >= 75 ? 'var(--naranja)' : 'var(--azul)'; }

/* STATUS sin "OK" — más formales (modificado para ocultar óptimos) */
function statusChip(p) {
  if (p >= 90) return '<span class="chip c-urgente">🔴 Mantenimiento Urgente</span>';
  if (p >= 75) return '<span class="chip c-proximo">🟡 Próximo Mantenimiento</span>';
  return '';
}

function toggleFlota() {
  flotaOpen = !flotaOpen;
  document.getElementById('flotaBody').classList.toggle('open', flotaOpen);
  document.getElementById('flotaChevron').classList.toggle('open', flotaOpen);
}

async function cargarFlota() {
  // Pedimos los vehiculos y solo el ÚLTIMO log de KM para cada uno
  const { data } = await sb.from('vehicles').select('*, km_logs(recorded_at)').eq('is_active', true).eq('km_logs.is_active', true).order('recorded_at', { referencedTable: 'km_logs', ascending: false });
  if (!data) return;

  // Simplificar el array anidado km_logs para quedarnos con el más reciente
  data.forEach(v => {
    if (v.km_logs && v.km_logs.length > 0) {
      // Ya viene ordenado descendente, tomamos el [0]
      v.last_km_date = new Date(v.km_logs[0].recorded_at);
    } else {
      v.last_km_date = null;
    }
  });

  vehiculos = data;
  poblarSelects(data);

  const rol = usuario.role;
  document.getElementById('zonaConductor').style.display = 'none';

  if (rol === 'conductor') {
    if (usuario.vehicle_id) {
      document.getElementById('zonaConductor').style.display = 'block';
      const v = data.find(x => x.id === usuario.vehicle_id) || usuario.vehicles;
      if (v) renderBarraConductor(v);

      // Buscar mantenimientos programados para este conductor
      const { data: woData } = await sb.from('work_orders')
        .select('*')
        .eq('vehicle_id', usuario.vehicle_id)
        .eq('status', 'programado')
        .order('scheduled_date', { ascending: true });
      if (woData && woData.length > 0) {
        const wo = woData[0];
        const condAlert = document.getElementById('alertaMantConductor');
        const condTitle = document.getElementById('alertaMantCondTitle');
        const condSub = document.getElementById('alertaMantCondSub');
        const condBadge = document.getElementById('alertaMantCondBadge');
        if (condTitle) condTitle.textContent = 'Mantenimiento Programado';
        if (condSub) condSub.textContent = `Tu unidad tiene un servicio agendado · ${wo.description ? wo.description.substring(0, 60) : cap(wo.type)}`;
        if (condBadge) condBadge.textContent = fmtDate(wo.scheduled_date);
        if (condAlert) condAlert.classList.add('show');
      } else {
        const condAlert = document.getElementById('alertaMantConductor');
        if (condAlert) condAlert.classList.remove('show');
      }
    }
  } else if (rol === 'administrador') {
    // Prepare data for the distinct 'seccionEstadoFlota' subpage
    const sorted = [...data].sort((a, b) => kmFalta(a) - kmFalta(b));
    renderFlotaChips(sorted);
    renderFlotaBody(sorted);
  }
  // Mecánico: no ve flota, solo menú
}

function renderBarraConductor(v) {
  const p = pct(v);
  document.getElementById('buLabel').textContent = `${v.unit_code} — ${v.plate}`;
  document.getElementById('buKm').textContent = `${fmtKm(v.km_current)} KM`;
  const b = document.getElementById('buBarra');
  b.style.width = p + '%'; b.style.backgroundColor = colorBarra(p);
  document.getElementById('buUltimo').textContent = fmtKm(v.km_last_maintenance);
  document.getElementById('buProximo').textContent = fmtKm(v.km_last_maintenance + v.km_interval);
}

function renderFlotaChips(data) {
  const total = data.length;
  const urgentes = data.filter(v => pct(v) >= 90).length;
  const proximos = data.filter(v => pct(v) >= 75 && pct(v) < 90).length;
  const ok = data.filter(v => pct(v) < 75).length;
  document.getElementById('flotaChips').innerHTML = `
    <div class="flota-chip total"><i class="fi fi-sr-car-alt"></i> ${total} Unidades</div>
    ${urgentes > 0 ? `<div class="flota-chip urgente"><i class="fi fi-sr-triangle-warning"></i> ${urgentes} Urgentes</div>` : ''}
    ${proximos > 0 ? `<div class="flota-chip proximo"><i class="fi fi-sr-clock"></i> ${proximos} Próximos</div>` : ''}
    <div class="flota-chip ok"><i class="fi fi-sr-badge-check"></i> ${ok} Óptimos</div>`;
}

function renderFlotaBody(data) {
  const el = document.getElementById('flotaBody');
  if (!data.length) { el.innerHTML = '<div class="empty"><i class="fi fi-sr-car-alt"></i><p>Sin vehículos registrados</p></div>'; return; }

  const ahora = new Date();
  el.innerHTML = data.map(v => {
    const p = pct(v), falta = kmFalta(v), col = colorBarra(p);

    let kmStatus = '';
    if (v.last_km_date) {
      const diasVencido = Math.floor((ahora - v.last_km_date) / (1000 * 60 * 60 * 24));
      if (diasVencido > 15) {
        kmStatus = `<span style="display:inline-block;background:#334155;color:#f8fafc;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:700;margin-top:4px"><i class="fi fi-sr-triangle-warning"></i> KM DESACTUALIZADO (+15d)</span>`;
      }
    } else {
      kmStatus = `<span style="display:inline-block;background:#334155;color:#f8fafc;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:700;margin-top:4px"><i class="fi fi-sr-triangle-warning"></i> SIN REGISTRO KM</span>`;
    }

    return `<div class="flota-unidad-row">
      <div class="flota-unidad-top">
        <div>
          <div class="flota-unidad-nombre">${v.unit_code} — ${v.plate}</div>
          <div class="flota-unidad-sub">${v.brand} ${v.model}${v.year ? ' (' + v.year + ')' : ''}</div>
          ${kmStatus}
        </div>
        <div style="text-align:right">
          <div class="flota-unidad-km" style="color:${col}">${fmtKm(v.km_current)} km</div>
          <div style="margin-top:4px">${statusChip(p)}</div>
        </div>
      </div>
      <div class="barra-wrap" style="height:14px"><div class="barra-fill" style="width:${p}%;background:${col}"></div></div>
      <div class="barra-labels" style="margin-top:6px">
        <span>Últ. Mant.: <b>${fmtKm(v.km_last_maintenance)}</b> km</span>
        <span>${falta > 0 ? `Faltan <b>${fmtKm(falta)}</b> km` : '<b style="color:var(--rojo)">MANT. REQUERIDO</b>'}</span>
      </div>
    </div>`;
  }).join('');
}

function poblarSelects(vs) {
  const opts = vs.map(v => `<option value="${v.id}" data-km="${v.km_current}" data-last="${v.km_last_maintenance}" data-interval="${v.km_interval}" data-code="${v.unit_code}" data-plate="${v.plate}" data-brand="${v.brand}" data-model="${v.model}">${v.unit_code} – ${v.plate} (${v.brand} ${v.model})</option>`).join('');

  // Selectores de admin/mecánico (todos los vehículos)
  ['mantVeh', 'trazaFiltro', 'adminKmFiltro', 'adminMantFiltro', 'adminFallaFiltro', 'adminCheckFiltro', 'pmVehiculo'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    const f = el.options[0].outerHTML; el.innerHTML = f + opts;
  });

  // PUNTO 3: Conductor solo ve su vehículo en km, trazabilidad, checklist y falla
  if (usuario.role === 'conductor' && usuario.vehicle_id) {
    const myV = vs.find(v => v.id === usuario.vehicle_id);
    if (myV) {
      const soloOpt = `<option value="${myV.id}" data-km="${myV.km_current}" data-last="${myV.km_last_maintenance}" data-interval="${myV.km_interval}" data-code="${myV.unit_code}" data-plate="${myV.plate}" data-brand="${myV.brand}" data-model="${myV.model}">${myV.unit_code} – ${myV.plate} (${myV.brand} ${myV.model})</option>`;
      ['kmVeh', 'trazaFiltro', 'checkVeh', 'fallaVeh'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = soloOpt; });
      // Ocultar selector de vehículo para conductor en checklist y falla (ya predefinido)
      const cw = document.getElementById('checklistVehWrap'); if (cw) cw.style.display = 'none';
      const fw = document.getElementById('fallaVehWrap'); if (fw) fw.style.display = 'none';
    }
  } else {
    // Admin: checklistVehWrap y fallaVehWrap visibles, poblar checkVeh y fallaVeh
    const cw = document.getElementById('checklistVehWrap'); if (cw) cw.style.display = 'block';
    const fw = document.getElementById('fallaVehWrap'); if (fw) fw.style.display = 'block';
    ['checkVeh', 'fallaVeh'].forEach(id => {
      const el = document.getElementById(id); if (!el) return;
      const f = el.options[0].outerHTML; el.innerHTML = f + opts;
    });
    const el = document.getElementById('kmVeh'); if (!el) return;
    const f = el.options[0].outerHTML; el.innerHTML = f + opts;
  }
}

/* ═══════ PROGRAMAR MANTENIMIENTO ═══════ */
let pmFallasPendientes = [];

async function onPmVehiculoChange() {
  const vId = document.getElementById('pmVehiculo').value;
  const wrapRazon = document.getElementById('pmRazonWrap');
  if (!vId) {
    wrapRazon.style.display = 'none';
    document.getElementById('pmTipo').value = '';
    onPmTipoChange();
    return;
  }
  wrapRazon.style.display = 'block';
}

async function onPmTipoChange() {
  const tipo = document.getElementById('pmTipo').value;
  const wrapFalla = document.getElementById('pmFallaWrap');
  const wrapFecha = document.getElementById('pmFechaWrap');
  const wrapDesc = document.getElementById('pmDescWrap');
  const btnGuardar = document.getElementById('btnGuardarPm');

  // Resetear estados previos
  document.getElementById('pmFalla').value = '';
  onPmFallaChange();

  if (!tipo) {
    wrapFalla.style.display = 'none';
    wrapFecha.style.display = 'none';
    wrapDesc.style.display = 'none';
    btnGuardar.style.display = 'none';
    return;
  }

  // Mostrar campos comunes de inmediato
  wrapFecha.style.display = 'block';
  wrapDesc.style.display = 'block';
  btnGuardar.style.display = 'block';

  if (tipo === 'correctivo') {
    wrapFalla.style.display = 'block';
    const vId = document.getElementById('pmVehiculo').value;
    const selFalla = document.getElementById('pmFalla');

    if (!vId) {
      selFalla.innerHTML = '<option value="">— Selecciona primero una unidad —</option>';
      return;
    }

    selFalla.innerHTML = '<option value="">Cargando fallas...</option>';
    try {
      const { data, error } = await sb.from('fault_reports')
        .select('*')
        .eq('vehicle_id', vId)
        .in('status', ['pendiente', 'en_revision']);

      if (error) throw error;

      pmFallasPendientes = data || [];
      let opts = '<option value="">— Selecciona la falla pendiente —</option>';
      if (pmFallasPendientes.length === 0) {
        opts = '<option value="">No hay fallas pendientes para esta unidad</option>';
      } else {
        opts += pmFallasPendientes.map(f => `<option value="${f.id}">${fmtDate(f.created_at)} - ${f.description.substring(0, 40)}...</option>`).join('');
      }
      selFalla.innerHTML = opts;
    } catch (e) {
      console.error("Error al cargar fallas:", e);
      selFalla.innerHTML = '<option value="">Error al cargar fallas. Intenta de nuevo.</option>';
      toast('Error al obtener reportes de falla', 'err');
    }
  } else {
    wrapFalla.style.display = 'none';
  }
}

function onPmFallaChange() {
  const fId = document.getElementById('pmFalla').value;
  const det = document.getElementById('pmFallaDetalle');
  if (!fId) {
    det.style.display = 'none';
    return;
  }
  const falla = pmFallasPendientes.find(x => x.id === fId);
  if (falla) {
    det.style.display = 'block';
    det.innerHTML = `<b>Descripción del Conductor:</b><br>${falla.description}<br>
                         ${falla.photo_url ? `<a href="${falla.photo_url}" target="_blank" style="color:var(--azul);text-decoration:underline;margin-top:5px;display:inline-block">Ver Foto Adjunta</a>` : ''}`;
  }
}

async function guardarProgramacionMant(e) {
  const btn = (e && e.currentTarget) || event.currentTarget || event.target || document.getElementById('btnGuardarPm') || document.activeElement;
  const originalText = btn.innerHTML;
  const vId = document.getElementById('pmVehiculo').value;
  const tipo = document.getElementById('pmTipo').value;
  const fallaId = document.getElementById('pmFalla').value || null;
  const fecha = document.getElementById('pmFecha').value;
  const desc = document.getElementById('pmDesc').value.trim();

  if (!vId) return toast('Selecciona unidad', 'err');
  if (!tipo) return toast('Selecciona tipo', 'err');
  if (tipo === 'correctivo' && !fallaId) return toast('Selecciona la falla a atender', 'err');
  if (!fecha) return toast('Indica la fecha estimada', 'err');

  btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Guardando...';

  const payload = {
    vehicle_id: vId,
    fault_report_id: fallaId, // puede ser null
    type: tipo,
    description: desc,
    scheduled_date: fecha,
    status: 'programado',
    created_by: usuario.id
  };

  const { error } = await sb.from('work_orders').insert(payload);
  if (error) {
    toast('Error al guardar', 'err');
    console.error(error);
    btn.disabled = false; btn.innerHTML = '<i class="fi fi-sr-calendar-plus"></i> Guardar Programación';
    return;
  }

  if (fallaId) {
    // Actualizar estado de falla a en_revision para que no salga doble
    await sb.from('fault_reports').update({ status: 'en_revision' }).eq('id', fallaId);
  }

  abrirModal('mExito');
  document.getElementById('mExitoMsg').textContent = 'Mantenimiento programado correctamente.';
  btn.disabled = false; btn.innerHTML = '<i class="fi fi-sr-calendar-plus"></i> Guardar Programación';

  // Limpiar form y recargar listado
  actualizarAvisosHeader();
  abrirProgramarMant();
}

async function cargarPmProgramados() {
  const lista = document.getElementById('listPmProgramados');
  lista.innerHTML = '<div style="font-size:13px;color:#ccc">Cargando...</div>';

  const { data } = await sb.from('work_orders')
    .select('*,vehicles(unit_code,plate,brand,model),fault_reports(id,description,severity)')
    .eq('status', 'programado')
    .order('created_at', { ascending: false });

  if (!data || data.length === 0) {
    lista.innerHTML = '<div style="font-size:13px;color:#ccc">No hay programaciones.</div>';
    return;
  }

  const sevColor = { critico: '#7b0000', urgente: 'var(--rojo)', moderado: 'var(--naranja)', leve: 'var(--verde)' };
  const statusCol = { programado: 'var(--naranja)', completado: 'var(--verde)', cancelado: '#aaa' };

  lista.innerHTML = data.map(r => {
    const woId = `WO-${r.id.substring(0, 4).toUpperCase()}`;
    const falla = r.fault_reports;
    const fallaHtml = falla ? `<div style="font-size:11px;margin-top:5px;padding:6px 10px;background:rgba(231,76,60,0.06);border-radius:8px;border-left:3px solid ${sevColor[falla.severity] || 'var(--rojo)'}">
          <b style="font-size:10px;color:#aaa;text-transform:uppercase">Falla asociada:</b><br>
          <span style="font-size:12px;color:#444">${falla.description?.substring(0, 80)}...</span>
        </div>` : '';
    return `
        <div class="tl-item" style="padding:14px 16px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
            <div>
              <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px">
                <span style="font-size:10px;font-weight:700;background:var(--azul);color:#fff;padding:2px 9px;border-radius:10px;font-family:'Segoe UI Semibold','Segoe UI',sans-serif">${woId}</span>
                <span style="font-size:10px;font-weight:700;padding:2px 9px;border-radius:10px;background:${statusCol[r.status] || '#ddd'}22;color:${statusCol[r.status] || '#888'};border:1px solid ${statusCol[r.status] || '#ddd'}44">${cap(r.status)}</span>
              </div>
              <div style="font-weight:700;font-size:14px;color:var(--azul)">${r.vehicles?.unit_code} — ${r.vehicles?.brand} ${r.vehicles?.model}</div>
              <div style="font-size:12px;color:#888">${r.vehicles?.plate} · ${cap(r.type)}</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:13px;font-weight:700;color:#333">📅 ${fmtDate(r.scheduled_date)}</div>
            </div>
          </div>
          ${r.description ? `<div style="font-size:12px;color:#666;margin-bottom:6px;font-style:italic">${r.description}</div>` : ''}
          ${fallaHtml}
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
            <button class="btn sec sm" style="margin-top:0;padding:6px 12px;font-size:12px" onclick="editarProgramacion('${r.id}','${r.scheduled_date}',\`${(r.description || '').replace(/`/g, "'")}\`)">
              <i class="fi fi-rr-edit"></i> Editar
            </button>
            <button class="btn rojo sm" style="margin-top:0;padding:6px 10px;min-width:auto" onclick="eliminarProgramacion('${r.id}')">
              <i class="fi fi-rr-trash"></i>
            </button>
          </div>
        </div>`;
  }).join('');
}

async function eliminarProgramacion(id) {
  if (!confirm('¿Eliminar esta programación de mantenimiento?')) return;
  // Revertir estado de falla si la tiene
  const { data: wo } = await sb.from('work_orders').select('fault_report_id').eq('id', id).eq('is_active', true).maybeSingle();
  if (wo?.fault_report_id) {
    await sb.from('fault_reports').update({ status: 'pendiente' }).eq('id', wo.fault_report_id);
  }
  await sb.from('work_orders').update({ is_active: false }).eq('id', id);
  toast('Programación eliminada', '');
  cargarWorkOrders(false);
  actualizarAvisosHeader();
  cargarPmFallasBanner();
}

async function marcarProgramacionCompletada(id) {
  await sb.from('work_orders').update({ status: 'completado' }).eq('id', id);
  toast('✅ Marcado como completado', 'ok');
  cargarPmProgramados();
  actualizarAvisosHeader();
}

function editarProgramacion(id, fechaActual, descActual) {
  // Simple inline edit via prompt
  const nuevaFecha = prompt('Nueva fecha estimada (YYYY-MM-DD):', fechaActual);
  if (!nuevaFecha) return;
  const nuevaDesc = prompt('Descripción / Instrucciones:', descActual);
  sb.from('work_orders').update({ scheduled_date: nuevaFecha, description: nuevaDesc || null }).eq('id', id).then(({ error }) => {
    if (error) { toast('Error al actualizar', 'err'); return; }
    toast('✅ Programación actualizada', 'ok');
    cargarWorkOrders(false);
  });
}

/* ═══════ WORK ORDER LOOKUP (Mecánico) ═══════ */
let woActual = null;

async function buscarWorkOrder() {
  const woId = document.getElementById('woSelect').value;
  const infoCard = document.getElementById('woInfoCard');
  const formContainer = document.getElementById('mantFormContainer');
  const lockOverlay = document.getElementById('mantLockOverlay');

  if (!woId) {
    infoCard.classList.remove('show');
    formContainer.style.display = 'none';
    woActual = null;
    limpiarMant();
    return;
  }

  const { data } = await sb.from('work_orders')
    .select('*,vehicles(id,unit_code,plate,brand,model,km_current,km_last_maintenance,km_interval),fault_reports(id,description,severity)')
    .eq('id', woId)
    .eq('is_active', true)
    .maybeSingle();

  if (!data) {
    infoCard.classList.remove('show');
    toast('Orden no encontrada', 'err');
    return;
  }
  const wo = data;
  woActual = wo;

  document.getElementById('woIdBadgeText').textContent = `WO-${wo.id.substring(0, 4).toUpperCase()}`;
  document.getElementById('woDetailVeh').textContent = `${wo.vehicles?.unit_code} — ${wo.vehicles?.brand} ${wo.vehicles?.model}`;
  document.getElementById('woDetailTipo').textContent = cap(wo.type);
  document.getElementById('woDetailFecha').textContent = fmtDate(wo.scheduled_date);
  document.getElementById('woDetailDesc').textContent = wo.description || 'Sin descripción adicional en la orden.';

  infoCard.classList.add('show');
  formContainer.style.display = 'block';

  // Auto-fill the maintenance form
  const mantVeh = document.getElementById('mantVeh');
  mantVeh.value = wo.vehicle_id;
  mantVeh.dispatchEvent(new Event('change'));

  const tipoSel = document.getElementById('mantTipoRealizado');
  tipoSel.value = wo.type || 'preventivo';
  await onMantRealizadoChange();

  // No sobreescribimos la descripción de la falla en el campo de reporte del mecánico
  document.getElementById('mantDesc').value = '';
  document.getElementById('mantDesc').placeholder = 'Describe aquí el trabajo realizado (reparaciones, cambios, etc.)...';

  // Auto KM
  if (wo.vehicles?.km_current) {
    document.getElementById('mantKm').value = wo.vehicles.km_current;
  }

  // Habilitar solo lo que el mecánico debe llenar
  document.getElementById('mantDropBtn').disabled = false;
  document.getElementById('mantDesc').disabled = false;

  // Mantener bloqueado lo que viene de la WO (según requerimiento previo)
  document.getElementById('mantVeh').disabled = true;
  document.getElementById('mantTipoRealizado').disabled = true;
  document.getElementById('mantKm').disabled = true;

  toast('✅ Orden de trabajo cargada', 'ok');
}

async function cargarWorkOrdersDisponibles() {
  const sel = document.getElementById('woSelect');
  sel.innerHTML = '<option value="">Cargando órdenes...</option>';

  const { data, error } = await sb.from('work_orders')
    .select('id, type, vehicles(unit_code)')
    .eq('status', 'programado')
    .eq('is_active', true)
    .order('scheduled_date', { ascending: true });

  if (error || !data) {
    sel.innerHTML = '<option value="">Error al cargar órdenes</option>';
    return;
  }

  if (data.length === 0) {
    sel.innerHTML = '<option value="">Sin órdenes de mantenimiento pendientes</option>';
  } else {
    sel.innerHTML = '<option value="">— Selecciona la orden de mantenimiento —</option>' +
      data.map(wo => `<option value="${wo.id}">[WO-${wo.id.substring(0, 4).toUpperCase()}] ${esc(wo.vehicles?.unit_code) || 'N/A'} — ${cap(esc(wo.type))}</option>`).join('');
  }
}

function abrirWorkOrders() {
  ir('secWorkOrders');
  poblarMesesFilterWo();
  poblarUnidadesFilterWo();

  const tabActiva = document.querySelector('#secWorkOrders .tabs-bar .tab-btn.activo');
  if (tabActiva && tabActiva.id === 'btnTabWoComp') {
    cargarWorkOrders(true);
  } else {
    tab('tWoProg', document.getElementById('btnTabWoProg'));
    cargarWorkOrders(false);
  }
}

function poblarMesesFilterWo() {
  const sel = document.getElementById('woMonthFilter');
  if (!sel) return;
  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const hoy = new Date();
  let opts = '<option value="">Todos</option>';
  for (let i = 0; i < 12; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = `${meses[d.getMonth()]} ${d.getFullYear()}`;
    opts += `<option value="${val}">${label}</option>`;
  }
  sel.innerHTML = opts;
}

async function poblarUnidadesFilterWo() {
  const sel = document.getElementById('woUnitFilter');
  if (!sel) return;

  const { data: vehs, error } = await sb.from('vehicles').select('unit_code').eq('is_active', true).order('unit_code');
  if (error) return;

  let opts = '<option value="">Todas</option>';
  vehs.forEach(v => {
    opts += `<option value="${v.unit_code}">${v.unit_code}</option>`;
  });
  sel.innerHTML = opts;
}

function actualizarListaOrdenesConFiltro() {
  const tabActiva = document.querySelector('#secWorkOrders .tabs-bar .tab-btn.activo');
  const isCompleted = tabActiva && tabActiva.id === 'btnTabWoComp';
  cargarWorkOrders(isCompleted);
}

function toggleWoCard(id) {
  const card = document.getElementById(`card-wo-${id}`);
  if (card) card.classList.toggle('expanded');
}

async function cargarWorkOrders(isCompleted = false) {
  const containerId = isCompleted ? 'listaWoComp' : 'listaWoProg';
  const container = document.getElementById(containerId);
  const fMes = document.getElementById('woMonthFilter')?.value || '';
  const fUnit = document.getElementById('woUnitFilter')?.value || '';

  container.innerHTML = '<div style="font-size:13px;color:#ccc;padding:20px;text-align:center;">Analizando registros...</div>';

  const statuses = isCompleted ? ['completado'] : ['programado'];

  let q = sb.from('work_orders')
    .select(`
          *,
          vehicles!inner(
            unit_code,plate,brand,model,
            users(full_name)
          ),
          fault_reports(description,severity)
        `)
    .eq('is_active', true)
    .in('status', statuses);

  if (fMes) {
    const [y, m] = fMes.split('-').map(Number);
    const desde = new Date(y, m - 1, 1).toISOString();
    const hasta = new Date(y, m, 0, 23, 59, 59).toISOString();
    q = q.gte('scheduled_date', desde).lte('scheduled_date', hasta);
  }

  if (fUnit) {
    q = q.eq('vehicles.unit_code', fUnit);
  }

  const { data, error } = await q.order('scheduled_date', { ascending: !isCompleted });

  if (error) {
    container.innerHTML = `<div class="empty"><i class="fi fi-sr-triangle-warning"></i><p>Error: ${error.message}</p></div>`;
    return;
  }

  if (!data || data.length === 0) {
    container.innerHTML = '<div class="empty"><i class="fi fi-sr-clipboard-list-check"></i><p>Sin registros en este período.</p></div>';
    return;
  }

  const statusMap = { 'programado': { label: 'Programada', col: 'var(--naranja)' }, 'completado': { label: 'Completada', col: 'var(--verde)' } };

  let logsMap = {};
  if (isCompleted && data.length > 0) {
    // Defensive check: only valid UUID strings
    const woIds = data.map(wo => wo.id).filter(id => id && typeof id === 'string' && id.length > 20);
    if (woIds.length > 0) {
      try {
        // Match logs to WOs by description tag (no work_order_id column)
        const woTags = woIds.map(id => `[WO-${id.substring(0, 4).toUpperCase()}]`);
        const { data: logs, error: lerr } = await sb.from('maintenance_logs')
          .select('description, km_at_maintenance, performed_at')
          .order('performed_at', { ascending: false });
        if (lerr) console.warn('Note: logs fetch issue', lerr);
        if (logs) {
          woIds.forEach(woId => {
            const tag = `[WO-${woId.substring(0, 4).toUpperCase()}]`;
            const match = logs.find(l => l.description && l.description.includes(tag));
            if (match) logsMap[woId] = match;
          });
        }
      } catch (e) { console.error('Error fetching logs', e); }
    }
  }

  container.innerHTML = data.map(wo => {
    const log = logsMap[wo.id];
    let displayDate = wo.scheduled_date;
    let dateLabel = 'Programada';

    if (isCompleted && log && log.performed_at) {
      displayDate = log.performed_at;
      dateLabel = 'Completada';
    }

    const idStr = `WO-${String(wo.id).substring(0, 4).toUpperCase()}`;
    const vehName = `${wo.vehicles?.brand} ${wo.vehicles?.model}`;
    const drivers = wo.vehicles?.users || [];
    const driversHtml = drivers.length > 0
      ? `<div class="wo-drivers-ribbon">
                <i class="fi fi-sr-steering-wheel"></i>
                <div class="wo-drivers-list">
                  ${drivers.map(d => `<span class="wo-driver-tag">${d.full_name}</span>`).join('')}
                </div>
              </div>`
      : '';

    let fallaHtml = '';
    if (wo.fault_reports) {
      fallaHtml = `<div class="wo-desc-container" style="margin-top:10px; background:rgba(255,152,0,0.05); color:#a35e00;">
              <b style="font-size:9px; text-transform:uppercase; margin-bottom:4px; display:block;">Reporte de Falla:</b>
              ${esc(wo.fault_reports.description)}
           </div>`;
    }

    let infoMecanico = '';
    if (isCompleted && log) {
      infoMecanico = `<div class="wo-desc-container" style="margin-top:10px; background:rgba(76,175,80,0.05); color:#2e7d32;">
                 <b style="font-size:9px; text-transform:uppercase; margin-bottom:4px; display:block;">Notas del Mecánico:</b>
                 ${esc(log.description) || 'Sin notas adicionales'}
              </div>`;
    }

    const typeLabel = wo.type === 'preventivo' ? 'Preventivo' : 'Correctivo';

    return `
        <div class="wo-card ${wo.status}" id="card-wo-${wo.id}" onclick="toggleWoCard('${wo.id}')">
          <div class="wo-status-line"></div>
          <div class="wo-collapsed-header">
             <div class="wo-main-info">
                <div class="wo-id-label" style="color:#0a0a0a !important">${idStr}</div>
                <div class="wo-unit-pill" style="font-weight:800 !important">
                  ${esc(wo.vehicles?.unit_code)}
                  <div class="wo-type-indicator ${wo.type}">${typeLabel}</div>
                </div>
                <div style="font-size:11px; color:#555; font-weight:600; display:flex; align-items:center; gap:4px; margin-left:4px; background:#f0f0f0; padding:2px 8px; border-radius:12px;" title="${dateLabel}: ${fmtDate(displayDate)}">
                  <i class="fi fi-rr-calendar" style="font-size:10px; margin-top:1px"></i> ${fmtDate(displayDate)}
                </div>
             </div>
             <div style="font-size:16px; color:#ddd;"><i class="fi fi-rr-angle-small-down"></i></div>
          </div>
          
          <div class="wo-expanded-body">
             <div class="wo-veh-title">${esc(vehName)} <span style="font-weight:400; color:#888; font-size:12px;">(${esc(wo.vehicles?.plate)})</span></div>
             
             <div class="wo-details-grid">
                <div class="wo-detail-item">
                   <label style="color:#0a0a0a !important">${isCompleted ? 'Fecha Completada' : 'Fecha Programada'}</label>
                   <span>${fmtDate(displayDate)}</span>
                </div>
                <div class="wo-detail-item">
                   <label style="color:#0a0a0a !important">Tipo de Orden</label>
                   <span class="wo-tipo-chip ${wo.type}" style="display:inline-block">${cap(wo.type)}</span>
                </div>
             </div>

             ${wo.description ? `<div class="wo-desc-container"><b style="font-size:9px; text-transform:uppercase; margin-bottom:4px; display:block;">Instrucciones:</b> ${wo.description}</div>` : ''}
             ${fallaHtml}
             ${infoMecanico}
             ${driversHtml}

             <div class="wo-action-footer">
                ${isCompleted ?
        `<button class="wo-btn-pdf" onclick="event.stopPropagation(); generarReportePDF('${wo.id}')"><i class="fi fi-sr-file-pdf"></i> Imprimir Reporte</button>` :
        `<button class="wo-btn-delete" onclick="event.stopPropagation(); eliminarProgramacion('${wo.id}')"><i class="fi fi-rr-trash"></i> Eliminar</button>`
      }
             </div>
          </div>
        </div>`;
  }).join('');
}

async function irMantenimientoDesdeWo(woId) {
  abrirMant();
  // Esperar a que el buscador cargue las órdenes
  let attempts = 0;
  const maxAttempts = 15;
  const interval = setInterval(() => {
    const sel = document.getElementById('woSelect');
    const exists = Array.from(sel.options).some(opt => opt.value === woId);
    if (exists) {
      sel.value = woId;
      buscarWorkOrder();
      clearInterval(interval);
    } else if (++attempts >= maxAttempts) {
      clearInterval(interval);
      toast('Selecciona la orden manualmente', 'info');
    }
  }, 300);
}

async function generarReportePDF(woId) {
  toast('Generando PDF, por favor espera...', 'ok');

  // Obtener datos de la Orden de Trabajo
  const { data: wo, error: woErr } = await sb.from('work_orders')
    .select('*, vehicles(unit_code,plate,brand,model,km_current,km_interval,km_last_maintenance, users(full_name)), fault_reports(description,severity, users(full_name))')
    .eq('id', woId)
    .eq('is_active', true)
    .maybeSingle();

  if (woErr || !wo) return toast('Error al obtener datos de la orden', 'err');

  // Intentar obtener el log de mantenimiento asociado
  const woTag = `[WO-${wo.id.substring(0, 4).toUpperCase()}]`;
  const { data: logs, error: logErr } = await sb.from('maintenance_logs')
    .select('*, mechanics:users!mechanic_id(full_name)')
    .eq('is_active', true)
    .ilike('description', `%${woTag}%`)
    .order('performed_at', { ascending: false });

  const mantLog = logs && logs.length > 0 ? logs[0] : null;

  document.getElementById('pdfFecha').textContent = fmtDate(new Date());
  document.getElementById('pdfTipo').textContent = wo.type;
  document.getElementById('pdfUnidad').textContent = wo.vehicles?.unit_code || '---';
  document.getElementById('pdfVehDesc').textContent = `${wo.vehicles?.brand || ''} ${wo.vehicles?.model || ''} (${wo.vehicles?.plate || ''})`;

  document.getElementById('pdfKm').textContent = mantLog ? fmtKm(mantLog.km_at_maintenance) + ' KM' : '---';

  const conductores = wo.vehicles?.users?.map(u => u.full_name).join(', ') || 'No asignado';
  document.getElementById('pdfMecanico').textContent = conductores;

  // POBLAR TIMELINE (NUEVO)
  if (wo.type === 'correctivo' && wo.fault_reports) {
    document.getElementById('pdfTimelineFalla').style.display = 'block';
    document.getElementById('pdfTimelineFallaPor').textContent = wo.fault_reports.users?.full_name || 'No registrado';
  } else {
    document.getElementById('pdfTimelineFalla').style.display = 'none';
  }

  document.getElementById('pdfTimelineMantPor').textContent = mantLog?.mechanics?.full_name || 'No especificado';
  document.getElementById('pdfTimelineMantFecha').textContent = mantLog ? fmtDateTime(mantLog.performed_at || mantLog.created_at) : '---';

  document.getElementById('pdfTimelineVerifPor').textContent = usuario.full_name;
  document.getElementById('pdfTimelineVerifFecha').textContent = fmtDateTime(new Date());

  // Nuevos campos del PDF rediseñado
  document.getElementById('pdfWoRow').textContent = `WO-${wo.id.substring(0, 4).toUpperCase()}`;
  const baseKm = mantLog ? (mantLog.km_at_maintenance || 0) : (wo.vehicles?.km_last_maintenance || wo.vehicles?.km_current || 0);
  const intervalo = wo.vehicles?.km_interval || 5000;
  const proxMantKm = wo.vehicles ? baseKm + intervalo : null;
  document.getElementById('pdfProxMant').textContent = proxMantKm ? fmtKm(proxMantKm) + ' KM' : '---';

  if (wo.fault_reports) {
    document.getElementById('pdfFallaBox').style.display = 'block';
    document.getElementById('pdfFallaReporte').textContent = wo.fault_reports.description;
  } else {
    document.getElementById('pdfFallaBox').style.display = 'none';
  }

  if (mantLog) {
    document.getElementById('pdfActividades').innerHTML = (mantLog.maintenance_types || []).map(t => `<span style="display:inline-block; border:1px solid #ccc; background:#fafafa; border-radius:4px; padding:3px 8px; margin-right:5px; margin-bottom:5px;">${t}</span>`).join('');

    // Limpiar descripción de prefijos técnicos para el reporte
    let descLimpia = mantLog.description || 'Sin observaciones adicionales.';
    descLimpia = descLimpia.replace(/\[WO-[A-Z0-9]+\]\s*/g, '');
    descLimpia = descLimpia.replace(/\[Falla Atendida\]\s*/g, '');
    descLimpia = descLimpia.replace(/\[Preventivo\]\s*/g, '');
    document.getElementById('pdfAccionesMecanico').textContent = descLimpia;
  } else {
    document.getElementById('pdfActividades').textContent = '---';
    document.getElementById('pdfAccionesMecanico').textContent = 'El mantenimiento no registra acciones adicionales.';
  }

  const element = document.getElementById('pdfTemplate');
  element.style.display = 'block';

  const opt = {
    margin: [0.1, 0.1, 0.1, 0.1], // Margen mínimo para maximizar espacio horizontal
    filename: `${wo.vehicles?.unit_code || 'UNIT'}_WO-${wo.id.substring(0, 4).toUpperCase()}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, scrollY: 0, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  html2pdf().set(opt).from(element).save().then(() => {
    element.style.display = 'none';
    toast('✅ PDF Descargado', 'ok');
  });
}

/* ═══════ KILOMETRAJE ═══════ */
function abrirKm() {
  ir('seccionKm');
  if (usuario.role === 'conductor' && usuario.vehicle_id) {
    setTimeout(() => { document.getElementById('kmVeh').value = usuario.vehicle_id; onKmVehChange(); }, 100);
  }
}
function verFoto(input) {
  if (input.files && input.files[0]) {
    const r = new FileReader();
    r.onload = e => { document.getElementById('previewImg').src = e.target.result; document.getElementById('previewImg').style.display = 'block'; };
    r.readAsDataURL(input.files[0]);
  }
}
function onKmVehChange() {
  const sel = document.getElementById('kmVeh');
  const o = sel.options[sel.selectedIndex];
  document.getElementById('kmErrorMsg').style.display = 'none';
  document.getElementById('btnKm').disabled = false;
  if (!sel.value) { document.getElementById('kmVehInfo').style.display = 'none'; document.getElementById('histKmLista').innerHTML = '<div style="font-size:13px;color:#ccc">Selecciona un vehículo...</div>'; return; }
  const km = parseInt(o.dataset.km), last = parseInt(o.dataset.last), interval = parseInt(o.dataset.interval);
  const proxMant = last + interval;
  const p = Math.min(100, Math.max(0, Math.round(((km - last) / interval) * 100)));
  const falta = Math.max(0, proxMant - km);
  document.getElementById('kmVehInfo').style.display = 'block';
  document.getElementById('kmVehInfoTit').textContent = `${o.dataset.code} — ${o.dataset.brand} ${o.dataset.model} (${o.dataset.plate})`;
  document.getElementById('kmVehInfoSub').textContent = `KM actual: ${fmtKm(km)} · Faltan: ${falta > 0 ? fmtKm(falta) + ' km' : '⚠️ MANT. REQUERIDO'}`;
  const b = document.getElementById('kmVehBarra'); b.style.width = p + '%'; b.style.backgroundColor = colorBarra(p);
  document.getElementById('kmValor').value = km;
  cargarHistKm(sel.value);
}
function validarKmInput() {
  const sel = document.getElementById('kmVeh');
  if (!sel.value) return;
  const kmAnterior = parseInt(sel.options[sel.selectedIndex].dataset.km);
  const kmNuevo = parseInt(document.getElementById('kmValor').value);
  const errEl = document.getElementById('kmErrorMsg');
  const btn = document.getElementById('btnKm');
  if (kmNuevo < kmAnterior) {
    errEl.textContent = `⚠️ El KM (${fmtKm(kmNuevo)}) es menor al registrado (${fmtKm(kmAnterior)}). No se puede guardar.`;
    errEl.style.display = 'block'; btn.disabled = true;
  } else {
    errEl.style.display = 'none'; btn.disabled = false;
  }
}
async function cargarHistKm(vId) {
  const lista = document.getElementById('histKmLista');
  lista.innerHTML = '<div style="font-size:13px;color:#ccc">Cargando...</div>';
  const { data } = await sb.from('km_logs').select('*,users(full_name)').eq('vehicle_id', vId).eq('is_active', true).order('recorded_at', { ascending: false }).limit(5);
  if (!data?.length) { lista.innerHTML = '<div style="font-size:13px;color:#ccc">Sin registros aún.</div>'; return; }
  lista.innerHTML = data.map(r => `
    <div class="tl-item">
      <b>${fmtKm(r.km_recorded)} KM ${r.is_initial ? '<span class="tl-tag km">Inicial</span>' : ''}</b>
      <div class="tl-fecha">${fmtDateTime(r.recorded_at)}</div>
      <div class="tl-quien"><i class="fi fi-rr-user"></i>${r.users?.full_name || 'N/A'}</div>
      ${r.notes ? `<div style="font-size:12px;color:#aaa;margin-top:3px;font-style:italic">"${r.notes}"</div>` : ''}
      ${r.photo_url ? `<a class="foto-link" href="${r.photo_url}" target="_blank"><i class="fi fi-rr-camera"></i> Ver foto tacómetro</a>` : ''}
    </div>`).join('');
}
async function guardarKm() {
  const vId = document.getElementById('kmVeh').value;
  const km = parseInt(document.getElementById('kmValor').value);
  const notas = document.getElementById('kmNotas').value;
  if (!vId || !km) { toast('Selecciona un vehículo e ingresa el KM', 'err'); return; }
  const v = vehiculos.find(x => x.id === vId);
  if (v && km < v.km_current) { toast(`KM menor al registrado (${fmtKm(v.km_current)})`, 'err'); return; }
  const btn = document.getElementById('btnKm');
  btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Guardando...';

  // Subir foto a Cloudinary si hay imagen
  let photoUrl = null;
  const fotoFile = document.getElementById('kmFoto').files[0];
  if (fotoFile) {
    try {
      btn.innerHTML = '<span class="loader"></span> Subiendo foto...';
      photoUrl = await subirFotoCloudinary(fotoFile);
    } catch (e) { toast('Error al subir foto, guardando sin imagen', 'err'); }
  }

  const payload = { vehicle_id: vId, user_id: usuario.id, km_recorded: km, notes: notas || null, is_initial: false, photo_url: photoUrl };
  if (!isOnline) {
    offQ.push({ t: 'km', d: payload }); localStorage.setItem('oq', JSON.stringify(offQ));
    toast('✅ Guardado offline', 'ok'); btn.disabled = false; btn.innerHTML = '<i class="fi fi-sr-disk"></i> Registrar'; return;
  }
  await sb.from('km_logs').insert(payload);
  await sb.from('vehicles').update({ km_current: km }).eq('id', vId);
  document.getElementById('mExitoMsg').textContent = 'El kilometraje ha sido registrado correctamente.';
  abrirModal('mExito');

  // Limpiar solo los campos de entrada, no el vehículo ni el historial
  document.getElementById('kmValor').value = '';
  document.getElementById('kmNotas').value = '';
  document.getElementById('previewImg').style.display = 'none';
  document.getElementById('kmErrorMsg').style.display = 'none';
  document.getElementById('kmFoto').value = '';

  // Recargar datos y refrescar vista para el vehículo actual
  await cargarFlota();
  document.getElementById('kmVeh').value = vId;
  onKmVehChange();
  btn.disabled = false; btn.innerHTML = '<i class="fi fi-sr-disk"></i> Registrar';
}

/* ═══════ MANTENIMIENTO ═══════ */
async function onMantRealizadoChange() {
  // Esta función ya no necesita cargar fallas en esta vista porque vienen por WO
}
document.getElementById('mantVeh').addEventListener('change', onMantRealizadoChange);

function abrirMant() {
  limpiarMant();
  ir('seccionMant');
  cargarWorkOrdersDisponibles();
}
async function guardarMant() {
  const btn = event.currentTarget || event.target || document.activeElement;
  const originalText = btn.innerHTML;
  const vId = document.getElementById('mantVeh').value;
  const clases = tiposSeleccionados;
  const km = parseInt(document.getElementById('mantKm').value);
  const descForm = document.getElementById('mantDesc').value;
  const tipo = document.getElementById('mantTipoRealizado').value;

  if (!woActual) { toast('⚠️ Debes seleccionar una Orden de Trabajo primero', 'err'); return; }
  if (!vId || !clases.length || !km) { toast('Selecciona vehículo, al menos una actividad y el KM', 'err'); return; }

  btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Guardando...';

  let finalDesc = descForm || '';
  if (tipo === 'correctivo' && woActual.fault_report_id) {
    finalDesc = `[Falla Atendida] ${finalDesc}`;
  } else if (tipo === 'preventivo') {
    finalDesc = `[Preventivo] ${finalDesc}`;
  }

  if (woActual) {
    finalDesc = `[WO-${woActual.id.substring(0, 4).toUpperCase()}] ${finalDesc}`;
  }

  const payload = {
    vehicle_id: vId,
    mechanic_id: usuario.id,
    maintenance_types: clases,
    description: finalDesc.trim() || null,
    km_at_maintenance: km
  };
  if (!isOnline) { offQ.push({ t: 'mant', d: payload }); localStorage.setItem('oq', JSON.stringify(offQ)); toast('✅ Guardado offline', 'ok'); limpiarMant(); return; }

  const { error: mantErr } = await sb.from('maintenance_logs').insert(payload);
  if (mantErr) {
    console.error('Error insertando mantenimiento:', mantErr);
    btn.disabled = false; btn.innerHTML = originalText;
    return toast('Error al registrar mantenimiento en la base de datos', 'err');
  }

  await sb.from('vehicles').update({ km_current: km, km_last_maintenance: km }).eq('id', vId);

  if (woActual) {
    await sb.from('work_orders').update({ status: 'completado' }).eq('id', woActual.id);
  }

  if (woActual.type === 'correctivo' && woActual.fault_report_id) {
    await sb.from('fault_reports').update({ status: 'resuelto' }).eq('id', woActual.fault_report_id);
  }

  document.getElementById('mExitoMsg').textContent = 'El mantenimiento ha sido registrado correctamente.';
  abrirModal('mExito');

  btn.disabled = false; btn.innerHTML = originalText;

  // Actualizar UI: Header, Flota y Banners de Programación
  actualizarAvisosHeader();
  cargarPmFallasBanner();
  cargarWorkOrders(false);
  cargarWorkOrders(true);
  cargarFlota();
  limpiarMant();
}
function limpiarMant() {
  document.getElementById('mantVeh').value = '';
  document.getElementById('mantKm').value = '';
  document.getElementById('mantDesc').value = '';
  document.getElementById('mantTipoRealizado').value = 'preventivo';

  // Ocultar formulario
  document.getElementById('mantFormContainer').style.display = 'none';
  document.getElementById('woInfoCard').classList.remove('show');
  document.getElementById('woSelect').value = '';
  woActual = null;

  // Deshabilitar físicamente todos los campos hasta que se cargue una WO
  document.getElementById('mantVeh').disabled = true;
  document.getElementById('mantTipoRealizado').disabled = true;
  document.getElementById('mantKm').disabled = true;
  document.getElementById('mantDesc').disabled = true;
  document.getElementById('mantDropBtn').disabled = true;

  limpiarMantDropdown();
}

/* ═══════ TRAZABILIDAD UNIFICADA ═══════ */

function abrirTraza() {
  ir('seccionTraza');
  setFiltroTipo('todo');
  poblarMesesFiltro();
}

function poblarMesesFiltro() {
  const sel = document.getElementById('trazaMes');
  if (!sel) return;
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const hoy = new Date();
  let opts = '<option value="">Todos los meses</option>';
  for (let i = 0; i < 12; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = `${meses[d.getMonth()]} ${d.getFullYear()}`;
    opts += `<option value="${val}"${i === 0 ? ' selected' : ''}>${label}</option>`;
  }
  sel.innerHTML = opts;
}

function setFiltroTipo(tipo) {
  filtroTipo = tipo;
  trazaPagina = 1;
  ['btnFiltroTodo', 'btnFiltroKm', 'btnFiltroMant', 'btnFiltroFalla'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    const activo = (tipo === 'todo' && id === 'btnFiltroTodo') || (tipo === 'km' && id === 'btnFiltroKm') || (tipo === 'mant' && id === 'btnFiltroMant') || (tipo === 'falla' && id === 'btnFiltroFalla');
    el.className = `btn${activo ? '' : ' sec'} sm`;
  });
  cargarTrazaUnificada();
}

async function cargarTrazaUnificada() {
  const fVeh = document.getElementById('trazaFiltro').value;
  const fMes = document.getElementById('trazaMes')?.value || '';
  const lista = document.getElementById('trazaUnificadaLista');
  lista.innerHTML = '<div style="font-size:13px;color:#ccc;padding:20px 0">Cargando...</div>';

  const vehFiltro = usuario.role === 'conductor' && usuario.vehicle_id ? usuario.vehicle_id : fVeh;

  // Rango de fechas por mes
  let desde = null, hasta = null;
  if (fMes) {
    const [y, m] = fMes.split('-').map(Number);
    desde = new Date(y, m - 1, 1).toISOString();
    hasta = new Date(y, m, 0, 23, 59, 59).toISOString();
  }

  let eventos = [];

  // KM
  if (filtroTipo === 'todo' || filtroTipo === 'km') {
    let q = sb.from('km_logs').select('id,km_recorded,recorded_at,notes,is_initial,photo_url,vehicle_id,vehicles(unit_code,plate),users(full_name)').eq('is_active', true).order('recorded_at', { ascending: false }).limit(200);
    if (vehFiltro) q = q.eq('vehicle_id', vehFiltro);
    if (desde) q = q.gte('recorded_at', desde);
    if (hasta) q = q.lte('recorded_at', hasta);
    const { data } = await q;
    if (data) eventos.push(...data.map(r => ({ ...r, _tipo: 'km', _fecha: new Date(r.recorded_at) })));
  }

  // MANTENIMIENTOS
  if (filtroTipo === 'todo' || filtroTipo === 'mant') {
    let q = sb.from('maintenance_logs').select('*,vehicles(unit_code,plate),mechanics:users!mechanic_id(full_name)').eq('is_active', true).order('performed_at', { ascending: false }).limit(200);
    if (vehFiltro) q = q.eq('vehicle_id', vehFiltro);
    if (desde) q = q.gte('performed_at', desde);
    if (hasta) q = q.lte('performed_at', hasta);
    const { data } = await q;
    if (data) eventos.push(...data.map(r => ({ ...r, users: r.mechanics, _tipo: 'mant', _fecha: new Date(r.performed_at) })));
  }

  // FALLAS
  if (filtroTipo === 'todo' || filtroTipo === 'falla') {
    let q = sb.from('fault_reports').select('*,vehicles(unit_code,plate),users(full_name)').eq('is_active', true).order('created_at', { ascending: false }).limit(200);
    if (vehFiltro) q = q.eq('vehicle_id', vehFiltro);
    if (desde) q = q.gte('created_at', desde);
    if (hasta) q = q.lte('created_at', hasta);
    const { data } = await q;
    if (data) eventos.push(...data.map(r => ({ ...r, _tipo: 'falla', _fecha: new Date(r.created_at) })));
  }

  eventos.sort((a, b) => b._fecha - a._fecha);

  if (!eventos.length) {
    lista.innerHTML = '<div class="empty"><i class="fi fi-sr-rectangle-list"></i><p>Sin registros para este período</p></div>';
    document.getElementById('trazaContador').textContent = '';
    document.getElementById('trazaVerMas').style.display = 'none';
    return;
  }

  // Para detectar si una falla fue "atendida": hay un mant posterior en la misma unidad
  // Construimos set de vehicle_id -> km máximo de mantenimiento
  const mantPorVeh = {};
  eventos.filter(e => e._tipo === 'mant').forEach(e => {
    if (!mantPorVeh[e.vehicle_id] || e.km_at_maintenance > mantPorVeh[e.vehicle_id])
      mantPorVeh[e.vehicle_id] = e.km_at_maintenance;
  });

  const total = eventos.length;
  const pagActual = trazaPagina;
  const slice = eventos.slice(0, pagActual * TRAZA_POR_PAG);
  const hayMas = total > slice.length;

  document.getElementById('trazaContador').textContent = `${slice.length} de ${total} registros`;
  document.getElementById('trazaVerMas').style.display = hayMas ? 'block' : 'none';
  if (hayMas) {
    document.getElementById('btnVerMasTraza').onclick = () => { trazaPagina++; cargarTrazaUnificada(); };
  }

  lista.innerHTML = slice.map(r => {
    if (r._tipo === 'km') {
      const hora = r._fecha.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
      const fecha = fmtDate(r._fecha);
      const fotoHtml = r.photo_url ? (' · <a class="foto-link" href="' + esc(r.photo_url) + '" target="_blank" rel="noopener noreferrer" style="font-size:11px;padding:1px 6px"><i class="fi fi-rr-camera"></i> foto</a>') : '';
      const notaHtml = r.notes ? (' · "' + esc(r.notes) + '"') : '';
      return '<div class="tl-item-compact">'
        + '<span class="tl-km">' + fmtKm(r.km_recorded) + ' km</span>'
        + '<span class="tl-info">' + esc(r.vehicles?.unit_code || '') + ' · ' + esc(r.users?.full_name || 'N/A') + notaHtml + fotoHtml + '</span>'
        + '<span class="tl-hora">' + fecha + '<br>' + hora + '</span>'
        + '</div>';
    } else if (r._tipo === 'mant') {
      const tipos = (r.maintenance_types || []).map(t => '<span class="tl-tipo-tag">' + t + '</span>').join('');
      const desc = r.description ? '<div style="font-size:12px;color:#aaa;margin-top:3px;font-style:italic">"' + esc(r.description) + '"</div>' : '';

      let woInfo = '';
      const woMatch = r.description?.match(/\[WO-([A-Z0-9]+)\]/);
      if (woMatch) {
        woInfo = `<span style="font-size:10px;font-weight:700;background:var(--azul);color:#fff;padding:1px 6px;border-radius:4px;margin-right:6px">WO-${esc(woMatch[1])}</span>`;
      }

      return '<div class="tl-item tl-mant">'
        + '<b>🔧 Mantenimiento ' + woInfo + ' · ' + fmtKm(r.km_at_maintenance) + ' km</b>'
        + '<div class="tl-fecha">' + fmtDate(r._fecha) + ' · ' + r._fecha.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) + '</div>'
        + '<div class="tl-quien"><i class="fi fi-rr-user"></i>' + esc(r.users?.full_name || 'N/A') + ' · ' + esc(r.vehicles?.unit_code || '') + '</div>'
        + '<div class="tl-tipos">' + tipos + '</div>'
        + desc
        + '</div>';
    } else {
      const esGrave = r.severity === 'critico' || r.severity === 'urgente';
      const kmMantVeh = mantPorVeh[r.vehicle_id] || 0;
      const atendida = r.km_at_fault && kmMantVeh >= r.km_at_fault;
      const atendidaPorFecha = !r.km_at_fault && eventos.some(e => e._tipo === 'mant' && e.vehicle_id === r.vehicle_id && e._fecha > r._fecha);
      const fueAtendida = atendida || atendidaPorFecha;
      const sevLabel = { critico: '🔴 Crítico', urgente: '🟠 Urgente', moderado: '🟡 Moderado', leve: '🟢 Leve' };
      const claseChip = 'chip c-' + (r.severity === 'urgente' ? 'urgente-f' : r.severity);
      const kmMeta = r.km_at_fault ? ('KM al reportar: <b>' + fmtKm(r.km_at_fault) + '</b> · ') : '';
      const fotoFalla = r.photo_url ? '<a class="foto-link" href="' + esc(r.photo_url) + '" target="_blank" rel="noopener noreferrer" style="margin-top:6px;display:inline-flex"><i class="fi fi-rr-camera"></i> Ver foto del problema</a>' : '';
      const atendidoBadge = fueAtendida ? '<span class="tl-falla-atendido">✅ Atendida</span>' : '';
      return '<div class="tl-item-falla' + (esGrave ? '' : ' falla-moderado') + '">'
        + '<div class="tl-falla-header">'
        + '<span class="tl-falla-titulo">⚠️ Falla · ' + esc(r.vehicles?.unit_code || '') + '</span>'
        + atendidoBadge
        + '</div>'
        + '<div style="margin-bottom:5px"><span class="' + claseChip + '" style="font-size:10px">' + (sevLabel[r.severity] || r.severity) + '</span></div>'
        + '<div class="tl-falla-desc">' + esc(r.description) + '</div>'
        + '<div class="tl-falla-meta">' + kmMeta + '<i class="fi fi-rr-user"></i> ' + esc(r.users?.full_name || 'N/A') + ' · ' + fmtDate(r._fecha) + ' ' + r._fecha.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) + '</div>'
        + fotoFalla
        + '</div>';
    }
  }).join('');
}

/* ═══════ ADMIN ═══════ */
function abrirAdmin() { ir('seccionAdmin'); cargarUsers(); }

/* PUNTO 2: ver/resetear PIN desde admin */
function toggleVerPin() {
  pinVisible = !pinVisible;
  const el = document.getElementById('euPinMostrado');
  const btn = document.getElementById('btnVerPin');
  if (pinVisible) {
    el.textContent = '[Encriptado — asigna uno nuevo abajo]';
    el.style.fontSize = '12px'; el.style.letterSpacing = '0';
    btn.textContent = 'OK';
  } else {
    el.textContent = '••••••'; el.style.fontSize = '20px'; el.style.letterSpacing = '4px';
    btn.textContent = 'Ver PIN';
  }
}

async function cargarUsers() {
  const { data } = await sb.from('users').select('*,vehicles(unit_code,plate)').eq('is_active', true).order('full_name');
  const tb = document.getElementById('tbUsers');
  if (!data?.length) { tb.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#bbb;padding:24px">Sin usuarios</td></tr>'; return; }
  tb.innerHTML = data.map(u => `<tr>
    <td><b>${esc(u.full_name)}</b></td><td>${u.cedula}</td>
    <td><span class="chip c-${u.role}">${cap(u.role)}</span></td>
    <td>${u.vehicles ? esc(u.vehicles.unit_code) + ' · ' + esc(u.vehicles.plate) : '<span style="color:#ccc">Sin unidad</span>'}</td>
    <td style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn sec sm" onclick="abrirEditUser('${u.id}','${u.full_name}','${u.role}','${u.vehicle_id || ''}')"><i class="fi fi-rr-pencil"></i></button>
      <button class="btn rojo sm" onclick="eliminarUser('${u.id}','${u.full_name}')"><i class="fi fi-rr-trash"></i></button>
    </td>
  </tr>`).join('');
}

async function cargarVehsEnModal(selectId) {
  const { data } = await sb.from('vehicles').select('id,unit_code,plate').eq('is_active', true);
  const sel = document.getElementById(selectId); if (!data || !sel) return;
  const f = sel.options[0].outerHTML;
  sel.innerHTML = f + data.map(v => `<option value="${v.id}">${esc(v.unit_code)} — ${esc(v.plate)}</option>`).join('');
}

async function crearUsuario() {
  const btn = event.currentTarget || event.target || document.activeElement;
  const originalText = btn.innerHTML;
  const ced = document.getElementById('uCedula').value.trim();
  const nom = document.getElementById('uNombre').value.trim();
  const pin = document.getElementById('uPin').value;
  const rol = document.getElementById('uRol').value;
  const vId = document.getElementById('uVehiculo').value || null;
  const err = document.getElementById('eUsuario'); err.style.display = 'none';
  if (!ced || !nom || !pin || !rol) { err.textContent = 'Completa todos los campos'; err.style.display = 'block'; return; }
  if (pin.length < 4) { err.textContent = 'El PIN debe tener al menos 4 dígitos'; err.style.display = 'block'; return; }

  btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Creando...';
  const ph = await hashPin(pin);

  const { error } = await sb.from('users').insert({ cedula: ced, full_name: nom, role: rol, pin_hash: ph, vehicle_id: vId });

  btn.disabled = false; btn.innerHTML = originalText;

  if (error) { err.textContent = error.code === '23505' ? 'Esa cédula ya está registrada' : error.message; err.style.display = 'block'; return; }
  cerrarModal('mUsuario'); toast('✅ Usuario creado', 'ok');
  ['uCedula', 'uNombre', 'uPin'].forEach(id => document.getElementById(id).value = '');
  cargarUsers();
}

function abrirEditUser(id, nombre, rol, vId) {
  document.getElementById('euId').value = id;
  document.getElementById('euNombre').value = nombre;
  document.getElementById('euRol').value = rol;
  document.getElementById('euPin').value = '';
  // Reset PIN display
  pinVisible = false;
  document.getElementById('euPinMostrado').textContent = '••••••';
  document.getElementById('euPinMostrado').style.fontSize = '20px';
  document.getElementById('euPinMostrado').style.letterSpacing = '4px';
  document.getElementById('btnVerPin').textContent = 'Ver PIN';
  cargarVehsEnModal('euVehiculo').then(() => { if (vId) document.getElementById('euVehiculo').value = vId; });
  abrirModal('mEditUser');
}
async function guardarEditUser() {
  const btn = event.currentTarget || event.target || document.activeElement;
  const originalText = btn.innerHTML;
  const id = document.getElementById('euId').value;
  const nom = document.getElementById('euNombre').value.trim();
  const rol = document.getElementById('euRol').value;
  const pin = document.getElementById('euPin').value;
  const vId = document.getElementById('euVehiculo').value || null;
  const updates = { full_name: nom, role: rol, vehicle_id: vId };

  btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Guardando...';
  if (pin.length >= 4) updates.pin_hash = await hashPin(pin);

  await sb.from('users').update(updates).eq('id', id);

  btn.disabled = false; btn.innerHTML = originalText;
  cerrarModal('mEditUser'); toast('✅ Usuario actualizado', 'ok'); cargarUsers();
}
async function eliminarUser(id, nombre) {
  if (!confirm(`¿Eliminar a ${nombre}?`)) return;
  await sb.from('users').update({ is_active: false }).eq('id', id);
  toast('Usuario eliminado', ''); cargarUsers();
}

/* VEHÍCULOS ADMIN */
async function cargarVehsAdmin() {
  const { data } = await sb.from('vehicles').select('*').eq('is_active', true).order('unit_code');
  const tb = document.getElementById('tbVehs');
  if (!data?.length) { tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#bbb;padding:24px">Sin vehículos</td></tr>'; return; }
  tb.innerHTML = data.map(v => {
    return `<tr>
      <td><b>${v.unit_code}</b></td><td>${v.plate}</td><td>${v.brand} ${v.model}</td>
      <td>${fmtKm(v.km_current)} km</td>
      <td style="display:flex;gap:6px">
        <button class="btn sec sm" onclick="abrirEditVeh('${v.id}',${v.km_interval},${v.km_last_maintenance},${v.km_current})"><i class="fi fi-rr-pencil"></i></button>
        <button class="btn rojo sm" onclick="eliminarVehiculo('${v.id}','${v.unit_code}')"><i class="fi fi-rr-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}
async function crearVehiculo() {
  const btn = event.currentTarget || event.target || document.activeElement;
  const originalText = btn.innerHTML;
  const code = document.getElementById('vCode').value.trim(), plate = document.getElementById('vPlate').value.trim().toUpperCase(), brand = document.getElementById('vBrand').value.trim(), model = document.getElementById('vModel').value.trim(), year = parseInt(document.getElementById('vYear').value) || null, kmActual = parseInt(document.getElementById('vKmActual').value) || 0, interval = parseInt(document.getElementById('vInterval').value) || 5000, kmLastMaint = parseInt(document.getElementById('vKmLastMaint').value) || 0;
  const err = document.getElementById('eVehiculo'); err.style.display = 'none';
  if (!code || !plate || !brand || !model) { err.textContent = 'Completa los campos obligatorios'; err.style.display = 'block'; return; }

  btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Creando...';

  const { data, error } = await sb.from('vehicles').insert({ unit_code: code, plate, brand, model, year, km_current: kmActual, km_interval: interval, km_last_maintenance: kmLastMaint }).select().single();
  if (error) {
    btn.disabled = false; btn.innerHTML = originalText;
    err.textContent = error.code === '23505' ? 'Esa placa o código ya existe' : error.message; err.style.display = 'block'; return;
  }
  if (data) { await sb.from('km_logs').insert({ vehicle_id: data.id, user_id: usuario.id, km_recorded: kmActual, notes: 'Registro inicial del vehículo', is_initial: true }); }

  btn.disabled = false; btn.innerHTML = originalText;
  cerrarModal('mVehiculo'); toast('✅ Vehículo creado', 'ok');
  ['vCode', 'vPlate', 'vBrand', 'vModel', 'vYear', 'vKmActual', 'vInterval', 'vKmLastMaint'].forEach(id => document.getElementById(id).value = '');
  cargarVehsAdmin(); cargarFlota();
}
function abrirEditVeh(id, interval, lastMaint, km) {
  document.getElementById('evId').value = id; document.getElementById('evInterval').value = interval;
  document.getElementById('evLastMaint').value = lastMaint; document.getElementById('evKm').value = km;
  abrirModal('mEditVeh');
}
async function actualizarVehiculo() {
  const btn = event.currentTarget || event.target || document.activeElement;
  const originalText = btn.innerHTML;
  const id = document.getElementById('evId').value;

  await sb.from('vehicles').update({ km_interval: parseInt(document.getElementById('evInterval').value), km_last_maintenance: parseInt(document.getElementById('evLastMaint').value), km_current: parseInt(document.getElementById('evKm').value) }).eq('id', id);

  btn.disabled = false; btn.innerHTML = originalText;
  cerrarModal('mEditVeh'); toast('✅ Vehículo actualizado', 'ok'); cargarVehsAdmin(); cargarFlota();
}
async function eliminarVehiculo(id, code) {
  if (!confirm(`¿Eliminar vehículo ${code}? Se ocultarán también todos sus registros relacionados.`)) return;
  await sb.from('km_logs').update({ is_active: false }).eq('vehicle_id', id);
  await sb.from('maintenance_logs').update({ is_active: false }).eq('vehicle_id', id);
  await sb.from('vehicles').update({ is_active: false }).eq('id', id);
  toast('Vehículo eliminado', ''); cargarVehsAdmin(); cargarFlota();
}

/* ADMIN KM */
async function cargarAdminKm() {
  const f = document.getElementById('adminKmFiltro').value;
  let q = sb.from('km_logs').select('*,vehicles(unit_code,plate),users(full_name)').eq('is_active', true).order('recorded_at', { ascending: false }).limit(80);
  if (f) q = q.eq('vehicle_id', f);
  const { data } = await q;
  const lista = document.getElementById('adminKmLista');
  if (!data?.length) { lista.innerHTML = '<div class="empty"><i class="fi fi-sr-road"></i><p>Sin registros</p></div>'; return; }
  lista.innerHTML = data.map(r => `
    <div class="tl-item" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <b>${esc(r.vehicles?.unit_code)} — ${esc(r.vehicles?.plate)}</b>
          <div class="tl-fecha">${fmtDate(r.recorded_at)}</div>
          <div class="tl-quien"><i class="fi fi-rr-user"></i>${esc(r.users?.full_name) || 'N/A'}</div>
          <span class="tl-tag km">📍 ${fmtKm(r.km_recorded)} km${r.is_initial ? ' · INICIAL' : ''}</span>
          ${r.notes ? `<div style="font-size:12px;color:#bbb;margin-top:4px">"${esc(r.notes)}"</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;margin-left:10px">
          ${!r.is_initial ? `<button class="btn sec sm" onclick="abrirEditKm('${r.id}',${r.km_recorded},'${(r.notes || '').replace(/'/g, "\\'")}')"><i class="fi fi-rr-pencil"></i></button>` : ''}
          <button class="btn rojo sm" onclick="eliminarKmAdmin('${r.id}','${r.vehicle_id}')"><i class="fi fi-rr-trash"></i></button>
        </div>
      </div>
    </div>`).join('');
}
function abrirEditKm(id, km, notas) {
  document.getElementById('ekId').value = id; document.getElementById('ekKm').value = km; document.getElementById('ekNotas').value = notas;
  abrirModal('mEditKm');
}
async function guardarEditKm() {
  const btn = event.currentTarget || event.target || document.activeElement;
  const originalText = btn.innerHTML;
  const id = document.getElementById('ekId').value;

  await sb.from('km_logs').update({ km_recorded: parseInt(document.getElementById('ekKm').value), notes: document.getElementById('ekNotas').value || null }).eq('id', id);

  btn.disabled = false; btn.innerHTML = originalText;
  cerrarModal('mEditKm'); toast('✅ Registro actualizado', 'ok'); cargarAdminKm();
}

/* PUNTO BUG FIX: al eliminar KM, recalcular km_current desde el registro más reciente */
async function eliminarKmAdmin(id, vehicleId) {
  if (!confirm('¿Eliminar este registro de KM?')) return;
  await sb.from('km_logs').update({ is_active: false }).eq('id', id);
  // Recalcular km_current del vehículo desde el log más reciente
  const { data: logs } = await sb.from('km_logs').select('km_recorded').eq('vehicle_id', vehicleId).eq('is_active', true).order('recorded_at', { ascending: false }).limit(1);
  if (logs && logs.length > 0) {
    await sb.from('vehicles').update({ km_current: logs[0].km_recorded }).eq('id', vehicleId);
  }
  toast('Registro eliminado y KM recalculado', 'ok');
  cargarAdminKm();
  cargarFlota();
}

/* ADMIN MANT */
async function cargarAdminMant() {
  const f = document.getElementById('adminMantFiltro').value;
  let q = sb.from('maintenance_logs').select('*,vehicles(unit_code,plate),mechanics:users!mechanic_id(full_name)').eq('is_active', true).order('performed_at', { ascending: false }).limit(80);
  if (f) q = q.eq('vehicle_id', f);
  const { data } = await q;
  const lista = document.getElementById('adminMantLista');
  if (!data?.length) { lista.innerHTML = '<div class="empty"><i class="fi fi-sr-wrench"></i><p>Sin registros</p></div>'; return; }
  lista.innerHTML = data.map(r => {
    const mecNombre = r.mechanics?.full_name || r.users?.full_name || 'N/A'; return `
    <div class="tl-item tl-mant" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="flex:1">
          <b>${r.vehicles?.unit_code} — ${r.vehicles?.plate}</b>
          <div class="tl-fecha">${fmtDate(r.performed_at)}</div>
          <div class="tl-quien"><i class="fi fi-rr-user"></i>${mecNombre}</div>
          <span class="tl-tag mant">🔧 ${fmtKm(r.km_at_maintenance)} km</span>
          <div class="tl-tipos">${(r.maintenance_types || []).map(t => `<span class="tl-tipo-tag">${t}</span>`).join('')}</div>
          ${r.description ? `<div style="font-size:12px;color:#bbb;margin-top:4px;font-style:italic">"${r.description}"</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;margin-left:10px">
          <button class="btn sec sm" onclick="abrirEditMant('${r.id}',${r.km_at_maintenance},'${(r.description || '').replace(/'/g, "\\'")}')"><i class="fi fi-rr-pencil"></i></button>
          <button class="btn rojo sm" onclick="eliminarMant('${r.id}')"><i class="fi fi-rr-trash"></i></button>
        </div>
      </div>
    </div>`;
  }).join('');
}
function abrirEditMant(id, km, desc) {
  document.getElementById('emId').value = id; document.getElementById('emKm').value = km; document.getElementById('emDesc').value = desc;
  abrirModal('mEditMant');
}
async function guardarEditMant() {
  const btn = event.currentTarget || event.target || document.activeElement;
  const originalText = btn.innerHTML;
  const id = document.getElementById('emId').value;

  await sb.from('maintenance_logs').update({ km_at_maintenance: parseInt(document.getElementById('emKm').value), description: document.getElementById('emDesc').value || null }).eq('id', id);

  btn.disabled = false; btn.innerHTML = originalText;
  cerrarModal('mEditMant'); toast('✅ Mantenimiento actualizado', 'ok'); cargarAdminMant();
}
async function eliminarMant(id) {
  if (!confirm('¿Eliminar este registro de mantenimiento?')) return;
  await sb.from('maintenance_logs').update({ is_active: false }).eq('id', id); toast('Registro eliminado', ''); cargarAdminMant();
}

/* REPORTES */
async function cargarStats() {
  const [{ data: vs }, { data: kl }, { data: ml }] = await Promise.all([
    sb.from('vehicles').select('*').eq('is_active', true),
    sb.from('km_logs').select('id').eq('is_initial', false).eq('is_active', true),
    sb.from('maintenance_logs').select('id').eq('is_active', true)
  ]);
  const urgentes = vs?.filter(v => pct(v) >= 90).length || 0;
  document.getElementById('statsPanel').innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-n">${vs?.length || 0}</div><div class="stat-l">Vehículos</div></div>
      <div class="stat-card ${urgentes > 0 ? 'r' : 'g'}"><div class="stat-n">${urgentes}</div><div class="stat-l">Urgentes</div></div>
      <div class="stat-card"><div class="stat-n">${kl?.length || 0}</div><div class="stat-l">Reg. KM</div></div>
      <div class="stat-card g"><div class="stat-n">${ml?.length || 0}</div><div class="stat-l">Mantenimientos</div></div>
    </div>`;
}
async function exportKm() {
  const { data } = await sb.from('km_logs').select('*,vehicles(unit_code,plate,brand,model),users(full_name)').eq('is_active', true).order('recorded_at', { ascending: false });
  if (!data?.length) { toast('Sin datos', 'err'); return; }
  xlsxExport(data.map(r => ({ 'Fecha': fmtDate(r.recorded_at), 'Unidad': r.vehicles?.unit_code, 'Placa': r.vehicles?.plate, 'Vehículo': `${r.vehicles?.brand} ${r.vehicles?.model}`, 'KM': r.km_recorded, 'Tipo': r.is_initial ? 'Registro Inicial' : 'Normal', 'Registrado por': r.users?.full_name, 'Notas': r.notes || '' })), 'Reporte_KM_Serex');
}
async function exportMant() {
  const { data } = await sb.from('maintenance_logs').select('*,vehicles(unit_code,plate,brand,model),mechanics:users!mechanic_id(full_name)').eq('is_active', true).order('performed_at', { ascending: false });
  if (!data?.length) { toast('Sin datos', 'err'); return; }
  xlsxExport(data.map(r => ({ 'Fecha': fmtDate(r.performed_at), 'Unidad': r.vehicles?.unit_code, 'Placa': r.vehicles?.plate, 'Vehículo': `${r.vehicles?.brand} ${r.vehicles?.model}`, 'Actividades': (r.maintenance_types || []).join(' | '), 'KM': r.km_at_maintenance, 'Mecánico': r.mechanics?.full_name || 'N/A', 'Descripción': r.description || '' })), 'Reporte_Mantenimientos_Serex');
}
function xlsxExport(data, name) {
  const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Reporte'); XLSX.writeFile(wb, `${name}.xlsx`);
  toast('✅ Excel descargado', 'ok');
}


/* ═══════ CHECKLIST DIARIO ═══════ */
function autoRellenarKmChecklist() {
  const sel = document.getElementById('checkVeh');
  if (!sel || !sel.value) return;
  const opt = sel.options[sel.selectedIndex];
  const km = opt.dataset.km || '';
  document.getElementById('checkKm').value = km;
}
function autoRellenarKmFalla() {
  const sel = document.getElementById('fallaVeh');
  if (!sel || !sel.value) return;
  const opt = sel.options[sel.selectedIndex];
  const km = opt.dataset.km || '';
  document.getElementById('fallaKm').value = km;
}
function abrirChecklist() {
  ir('seccionChecklist');
  if (usuario.role === 'conductor' && usuario.vehicle_id) {
    setTimeout(() => {
      const el = document.getElementById('checkVeh');
      if (el) { el.value = usuario.vehicle_id; autoRellenarKmChecklist(); }
    }, 100);
  }
  document.querySelectorAll('#seccionChecklist input[type=checkbox]').forEach(cb => {
    cb.checked = false;
    cb.closest('.check-row')?.classList.remove('checked');
  });
  document.getElementById('checkObs').value = '';
  actualizarProgresoCheck();
}
function toggleCheckRow(row, id) {
  const cb = document.getElementById(id);
  if (event.target === cb) return; // el click directo al checkbox lo maneja el browser
  cb.checked = !cb.checked;
  row.classList.toggle('checked', cb.checked);
  actualizarProgresoCheck();
}
document.addEventListener('change', function (e) {
  if (e.target.type === 'checkbox' && e.target.closest('.check-row')) {
    e.target.closest('.check-row').classList.toggle('checked', e.target.checked);
    actualizarProgresoCheck();
  }
});
function actualizarProgresoCheck() {
  const total = document.querySelectorAll('#seccionChecklist input[type=checkbox]').length;
  const checked = document.querySelectorAll('#seccionChecklist input[type=checkbox]:checked').length;
  const el = document.getElementById('checkProgreso');
  if (el) el.textContent = `${checked} de ${total} ítems verificados`;
}
async function guardarChecklist(e) {
  const btn = (e && e.currentTarget) || event.currentTarget || event.target || document.activeElement;
  const originalText = btn.innerHTML;
  const vId = document.getElementById('checkVeh').value;
  if (!vId) { toast('Selecciona una unidad', 'err'); return; }
  const km = parseInt(document.getElementById('checkKm').value) || null;
  const obs = document.getElementById('checkObs').value || null;
  const campos = ['nivel_aceite', 'nivel_refrigerante', 'nivel_liquido_frenos', 'presion_neumaticos', 'caucho_repuesto', 'extintor', 'luces_delanteras', 'documentos_vehiculo'];
  const payload = { vehicle_id: vId, user_id: usuario.id, km_checklist: km, observaciones: obs };
  campos.forEach(c => { payload[c] = document.getElementById(c)?.checked || false; });

  btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Guardando...';
  const { error } = await sb.from('daily_checklists').insert(payload);

  if (error) {
    btn.disabled = false; btn.innerHTML = originalText;
    toast('Error al guardar checklist', 'err'); console.error(error); return;
  }
  btn.disabled = false; btn.innerHTML = originalText;
  document.getElementById('mExitoMsg').textContent = 'Checklist del día guardado correctamente.';
  abrirModal('mExito');
  ir('seccionDashboard');
}

/* ═══════ REPORTE DE FALLA ═══════ */
function abrirFalla() {
  ir('seccionFalla');
  if (usuario.role === 'conductor' && usuario.vehicle_id) {
    setTimeout(() => {
      const el = document.getElementById('fallaVeh');
      if (el) { el.value = usuario.vehicle_id; autoRellenarKmFalla(); }
    }, 100);
  }
  document.getElementById('fallaDesc').value = '';
  document.getElementById('fallaSeverity').value = '';
  document.getElementById('fallaKm').value = '';
  document.getElementById('fallaFotoInput').value = '';
  document.getElementById('fallaPreview').style.display = 'none';
  document.getElementById('fallaProgress').style.display = 'none';
}
function prevFallaFoto(input) {
  if (input.files && input.files[0]) {
    const r = new FileReader();
    r.onload = e => {
      const p = document.getElementById('fallaPreview');
      p.src = e.target.result; p.style.display = 'block';
    };
    r.readAsDataURL(input.files[0]);
  }
}
async function guardarFalla(e) {
  const btn = (e && e.currentTarget) || document.querySelector('#seccionFalla .btn.rojo');
  const vId = document.getElementById('fallaVeh').value;
  const severity = document.getElementById('fallaSeverity').value;
  const desc = document.getElementById('fallaDesc').value.trim();
  const kmFalla = parseInt(document.getElementById('fallaKm').value) || null;
  if (!vId) { toast('Selecciona una unidad', 'err'); return; }
  if (!severity) { toast('Selecciona el nivel de importancia', 'err'); return; }
  if (!desc) { toast('Agrega una descripción del problema', 'err'); return; }
  btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Enviando...';

  let photoUrl = null;
  const fotoFile = document.getElementById('fallaFotoInput').files[0];
  if (fotoFile) {
    const progBar = document.getElementById('fallaProgress');
    const fill = document.getElementById('fallaProgressFill');
    progBar.style.display = 'block';
    try {
      photoUrl = await subirFotoCloudinary(fotoFile, p => { fill.style.width = p + '%'; });
    } catch (e) { toast('Error al subir foto, guardando sin imagen', 'err'); }
    progBar.style.display = 'none';
  }

  const payload = { vehicle_id: vId, user_id: usuario.id, severity, description: desc, photo_url: photoUrl, status: 'pendiente' };
  const { error } = await sb.from('fault_reports').insert(payload);
  if (error) {
    toast('Error al enviar reporte: ' + error.message, 'err');
    console.error("Error al insertar falla:", error);
    btn.disabled = false;
    btn.innerHTML = '<i class="fi fi-sr-triangle-warning"></i> Enviar Reporte';
    return;
  }
  document.getElementById('mExitoMsg').textContent = 'Falla reportada. El equipo técnico será notificado.';
  abrirModal('mExito');
  btn.disabled = false; btn.innerHTML = '<i class="fi fi-sr-triangle-warning"></i> Enviar Reporte';
  document.getElementById('fallaKm').value = '';
  ir('seccionDashboard');
}

/* ═══════ ADMIN: VER FALLAS ═══════ */
async function cargarAdminFallas() {
  const lista = document.getElementById('adminFallaLista');
  lista.innerHTML = '<div style="font-size:13px;color:#aaa">Cargando...</div>';
  let q = sb.from('fault_reports').select('*,vehicles(unit_code,plate,brand,model),users(full_name)').eq('is_active', true).order('created_at', { ascending: false });
  const fV = document.getElementById('adminFallaFiltro')?.value;
  const fE = document.getElementById('adminFallaEstado')?.value;
  if (fV) q = q.eq('vehicle_id', fV);
  if (fE) q = q.eq('status', fE);
  const { data } = await q;
  if (!data?.length) { lista.innerHTML = '<div class="empty"><i class="fi fi-sr-triangle-warning"></i><p>Sin reportes de falla</p></div>'; return; }
  const sevLabel = { critico: 'Crítico', urgente: 'Urgente', moderado: 'Moderado', leve: 'Leve' };
  lista.innerHTML = data.map(r => `
    <div class="fault-card ${r.severity}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">
        <div>
          <div style="font-weight:700;font-size:15px">${esc(r.vehicles?.unit_code) || '—'} · ${esc(r.vehicles?.brand)} ${esc(r.vehicles?.model)}</div>
          <div style="font-size:12px;color:#aaa">${esc(r.vehicles?.plate)}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <span class="chip c-${r.severity === 'urgente' ? 'urgente-f' : r.severity}">${sevLabel[r.severity] || r.severity}</span>
        </div>
      </div>
      <div style="font-size:14px;color:#444;margin-bottom:8px">${esc(r.description)}</div>
      <div style="font-size:12px;color:#aaa;margin-bottom:6px">
        ${esc(r.users?.full_name) || 'N/A'} · ${fmtDateTime(r.created_at)}
      </div>
      ${r.photo_url ? `<a class="foto-link" href="${esc(r.photo_url)}" target="_blank" rel="noopener noreferrer">Ver foto del problema</a>` : ''}
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn rojo sm" style="padding:6px;min-width:auto" onclick="eliminarFalla('${r.id}')" title="Eliminar"><i class="fi fi-rr-trash"></i></button>
      </div>
    </div>`).join('');
}
async function cambiarEstadoFalla(id, status) {
  await sb.from('fault_reports').update({ status }).eq('id', id);
  toast('✅ Estado actualizado', 'ok'); cargarAdminFallas();
}
async function eliminarFalla(id) {
  if (!confirm('¿Eliminar este reporte de falla?')) return;
  await sb.from('fault_reports').update({ is_active: false }).eq('id', id);
  toast('Reporte eliminado', ''); cargarAdminFallas();
}

/* ═══════ ADMIN: VER CHECKLISTS ═══════ */
function poblarMesesAdminCheck() {
  const sel = document.getElementById('adminCheckMes');
  if (!sel || sel.options.length > 1) return;
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const hoy = new Date();
  let opts = '<option value="">Todos los meses</option>';
  for (let i = 0; i < 12; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const val = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    opts += '<option value="' + val + '"' + (i === 0 ? ' selected' : '') + '>' + meses[d.getMonth()] + ' ' + d.getFullYear() + '</option>';
  }
  sel.innerHTML = opts;
}
async function cargarAdminChecklists() {
  poblarMesesAdminCheck();
  const lista = document.getElementById('adminCheckLista');
  lista.innerHTML = '<div style="font-size:13px;color:#aaa">Cargando...</div>';
  const fV = document.getElementById('adminCheckFiltro')?.value;
  const fMes = document.getElementById('adminCheckMes')?.value || '';
  let q = sb.from('daily_checklists').select('*,vehicles(unit_code,plate,brand,model),users(full_name)').eq('is_active', true).order('created_at', { ascending: false }).limit(200);
  if (fV) q = q.eq('vehicle_id', fV);
  if (fMes) {
    const [y, m] = fMes.split('-').map(Number);
    q = q.gte('created_at', new Date(y, m - 1, 1).toISOString()).lte('created_at', new Date(y, m, 0, 23, 59, 59).toISOString());
  }
  const { data } = await q;
  if (!data?.length) { lista.innerHTML = '<div class="empty"><i class="fi fi-sr-clipboard-list"></i><p>Sin checklists registrados</p></div>'; return; }

  const campos = [
    { k: 'nivel_aceite', l: 'Aceite' }, { k: 'nivel_refrigerante', l: 'Refrigerante' },
    { k: 'nivel_liquido_frenos', l: 'Liq. Frenos' }, { k: 'presion_neumaticos', l: 'Presión Neum.' },
    { k: 'caucho_repuesto', l: 'Caucho Rep.' }, { k: 'extintor', l: 'Extintor' },
    { k: 'luces_delanteras', l: 'Luces Del.' }, { k: 'documentos_vehiculo', l: 'Documentos' }
  ];

  lista.innerHTML = data.map(r => {
    const total = campos.length;
    const ok = campos.filter(c => r[c.k]).length;
    const pct = Math.round(ok / total * 100);
    const col = pct === 100 ? 'var(--verde)' : pct >= 70 ? 'var(--naranja)' : 'var(--rojo)';
    const okItems = campos.filter(c => r[c.k]).map(c => '<span style="font-size:10px;background:rgba(39,174,96,0.1);color:#1e8449;padding:2px 6px;border-radius:6px;display:inline-block;margin:1px">✓ ' + c.l + '</span>').join('');
    const nokItems = campos.filter(c => !r[c.k]).map(c => '<span style="font-size:10px;background:rgba(231,76,60,0.08);color:var(--rojo);padding:2px 6px;border-radius:6px;display:inline-block;margin:1px">✗ ' + c.l + '</span>').join('');
    return '<div style="background:#fff;border-radius:10px;padding:10px 14px;margin-bottom:8px;box-shadow:0 1px 4px rgba(0,0,0,0.06);border-left:4px solid ' + col + '">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
      + '<div><span style="font-weight:700;font-size:14px">' + esc(r.vehicles?.unit_code || '—') + '</span>'
      + ' <span style="font-size:12px;color:#aaa">' + esc(r.users?.full_name || 'N/A') + ' · ' + fmtDate(r.created_at) + '</span></div>'
      + '<div style="display:flex;align-items:center;gap:12px"><span style="font-size:18px;font-weight:700;color:' + col + '">' + pct + '%</span>'
      + '<button class="btn rojo sm" style="padding:4px;min-width:auto" onclick="eliminarChecklist(\'' + r.id + '\')"><i class="fi fi-rr-trash"></i></button></div>'
      + '</div>'
      + '<div style="height:4px;background:#eee;border-radius:4px;margin-bottom:8px">'
      + '<div style="width:' + pct + '%;height:100%;background:' + col + ';border-radius:4px"></div></div>'
      + (r.km_checklist ? '<div style="font-size:11px;color:#888;margin-bottom:5px">KM: <b>' + fmtKm(r.km_checklist) + '</b></div>' : '')
      + (okItems ? '<div style="margin-bottom:4px">' + okItems + '</div>' : '')
      + (nokItems ? '<div>' + nokItems + '</div>' : '')
      + (r.observaciones ? '<div style="font-size:11px;color:#aaa;margin-top:5px;font-style:italic">"' + esc(r.observaciones) + '"</div>' : '')
      + '</div>';
  }).join('');
}

async function eliminarChecklist(id) {
  if (!confirm('¿Eliminar esta inspección diaria?')) return;
  await sb.from('daily_checklists').update({ is_active: false }).eq('id', id);
  toast('Inspección eliminada', ''); cargarAdminChecklists();
}

document.addEventListener('keydown', e => { if (e.key === 'Enter' && !document.body.classList.contains('app-mode')) iniciarSesion(); });

if ('serviceWorker' in navigator) {
  const sw = `const C='serex-v8';self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.add('/'))));self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).catch(()=>r))))`;
  navigator.serviceWorker.register(URL.createObjectURL(new Blob([sw], { type: 'application/javascript' }))).catch(() => { });
}
