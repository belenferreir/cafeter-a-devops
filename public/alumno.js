const $app = document.getElementById('app');
let alumno = localStorage.getItem('alumno');
let pedidoId = localStorage.getItem('pedido');
let recreos = [], productos = [], recreoId = null, carrito = {}, timer = null;

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const api = (url, opts = {}) => fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts })
  .then(async r => ({ ok: r.ok, status: r.status, data: await r.json() }));
const programar = (fn, ms) => { clearTimeout(timer); timer = setTimeout(fn, ms); };
const total = () => productos.reduce((s, p) => s + (carrito[p.id] || 0) * p.precio, 0);
const cantidad = () => Object.values(carrito).reduce((a, b) => a + b, 0);
const on = (sel, fn) => $app.querySelectorAll(sel).forEach(el => el.onclick = e => { e.preventDefault(); fn(el); });

async function cargar() {
  const [r, p] = await Promise.all([api('/api/recreos'), api('/api/productos')]);
  recreos = r.data;
  productos = p.data;
  if (!recreos.some(r => r.id === recreoId)) recreoId = (recreos.find(r => r.abierto) || recreos[0]).id;
}

function vistaNombre() {
  clearTimeout(timer);
  $app.innerHTML = `<h1>¿Cómo te llamás?</h1>
    <input id="nombre" placeholder="Ej: Sofía M. · 4ºB">
    <button class="primario" id="ok">Entrar</button>`;
  on('#ok', () => {
    const v = document.getElementById('nombre').value.trim();
    if (!v) return;
    alumno = v;
    localStorage.setItem('alumno', v);
    inicio();
  });
}

function pills() {
  return `<div class="pills">${recreos.map(r =>
    `<button class="pill ${r.id === recreoId ? 'activa' : ''} ${r.abierto ? '' : 'cerrada'}" data-r="${r.id}">${r.hora}${r.abierto ? '' : ' · cerrado'}</button>`
  ).join('')}</div>`;
}

function vistaCatalogo() {
  const r = recreos.find(r => r.id === recreoId);
  let cuerpo;
  if (!r.abierto) {
    const prox = recreos.find(x => x.abierto);
    cuerpo = `<div class="card centro"><div class="candado">🔒</div>
      <h2>Ya no se puede pedir para las ${r.hora}</h2>
      <p class="gris">Los pedidos para este recreo cerraron a las ${r.cierre}, ${r.corte} minutos antes.${prox ? ' Podés pedir para el próximo.' : ''}</p></div>
      ${prox ? `<button class="primario fijo" style="justify-content:center" data-r="${prox.id}">Pedir para las ${prox.hora}</button>` : ''}`;
  } else {
    cuerpo = `<div class="aviso">🕒 Pedidos hasta las <b>${r.cierre}</b> · faltan ${r.faltan} min</div>
      ${productos.map(p => `<div class="card prod ${p.agotado ? 'agotado' : ''}">
        <div class="ini">${esc(p.nombre[0])}</div>
        <div class="info"><div>${esc(p.nombre)}</div><div class="gris">${esc(p.descripcion || '')}</div><b>$${p.precio}</b></div>
        ${p.agotado ? '<span class="gris">Agotado</span>'
          : carrito[p.id] ? `<div class="cant"><button class="redondo" data-menos="${p.id}">−</button>${carrito[p.id]}<button class="redondo lleno" data-mas="${p.id}">+</button></div>`
          : `<button class="sec" data-mas="${p.id}">Agregar</button>`}
      </div>`).join('')}
      ${cantidad() ? `<button class="primario fijo" id="ver"><span>${cantidad()} productos</span><span>Ver pedido · $${total()}</span></button>` : ''}`;
  }
  $app.innerHTML = `<p class="gris">Hola, ${esc(alumno)}</p><h1>¿Qué vas a pedir?</h1><p class="gris">Recreo</p>${pills()}${cuerpo}`;
  on('[data-r]', b => { recreoId = +b.dataset.r; vistaCatalogo(); });
  on('[data-mas]', b => { carrito[b.dataset.mas] = (carrito[b.dataset.mas] || 0) + 1; vistaCatalogo(); });
  on('[data-menos]', b => { if (!--carrito[b.dataset.menos]) delete carrito[b.dataset.menos]; vistaCatalogo(); });
  on('#ver', () => vistaResumen());
  programar(async () => { await cargar(); vistaCatalogo(); }, 30000);
}

function vistaResumen(error) {
  clearTimeout(timer);
  const r = recreos.find(r => r.id === recreoId);
  const items = productos.filter(p => carrito[p.id]);
  $app.innerHTML = `<h1><button class="atras" id="atras">‹</button>Tu pedido</h1>
    <div class="card"><p class="gris">Retirás en el recreo de las</p><h2>${r.hora}</h2><p class="naranja">Podés confirmar hasta las ${r.cierre}</p></div>
    <div class="card">${items.map(p => `<div class="fila"><span>${carrito[p.id]}× ${esc(p.nombre)}</span><span>$${carrito[p.id] * p.precio}</span></div>`).join('')}</div>
    <a href="#" id="editar">Editar productos</a>
    ${error ? `<div class="aviso" style="margin-top:16px">${esc(error)}</div>` : ''}
    <div class="fijo-abajo"><div class="fila"><span class="gris">Total</span><b>$${total()}</b></div><button class="primario" id="confirmar">Confirmar pedido</button></div>`;
  on('#atras, #editar', vistaCatalogo);
  on('#confirmar', async () => {
    const res = await api('/api/pedidos', {
      method: 'POST',
      body: JSON.stringify({ alumno, recreo_id: recreoId, items: items.map(p => ({ producto_id: p.id, cantidad: carrito[p.id] })) }),
    });
    if (res.status === 409) { await cargar(); return vistaCatalogo(); }
    if (!res.ok) return vistaResumen(res.data.error);
    carrito = {};
    pedidoId = res.data.id;
    localStorage.setItem('pedido', pedidoId);
    vistaSeguimiento();
  });
}

async function vistaSeguimiento() {
  const res = await api(`/api/pedidos/${pedidoId}`);
  if (!res.ok) return nuevoPedido();
  const p = res.data;
  const pasos = [['recibido', 'Recibido'], ['listo', 'Listo para retirar'], ['entregado', 'Entregado']];
  const idx = pasos.findIndex(x => x[0] === p.estado);
  const textos = {
    recibido: 'La cafetería lo va a tener pronto para tu recreo.',
    listo: 'Ya podés pasar a retirarlo.',
    entregado: '¡Que lo disfrutes!',
  };
  $app.innerHTML = `<h1><button class="atras" id="atras">‹</button>Pedido #${p.codigo}</h1>
    <div class="card verde"><p>Recreo de las ${p.hora}</p><h2>${pasos[idx][1]}</h2><p>${textos[p.estado]}</p></div>
    <div class="card">${pasos.map((s, i) => `<div class="paso ${i <= idx ? 'hecho' : ''}"><span class="punto">${i <= idx ? '✓' : ''}</span>
      <div><b>${s[1]}</b><div class="gris">${i === 0 ? p.hora_recibido : i <= idx ? '' : 'Pendiente'}</div></div></div>`).join('')}</div>
    <div class="card">${p.items.map(i => `<div class="fila"><span>${i.cantidad}× ${esc(i.nombre)}</span><span>$${i.cantidad * i.precio}</span></div>`).join('')}
      <div class="fila"><b>Total</b><b>$${p.total}</b></div></div>
    <button class="sec ancho" id="otro">Hacer otro pedido</button>`;
  on('#atras, #otro', nuevoPedido);
  if (p.estado !== 'entregado') programar(vistaSeguimiento, 5000);
}

function nuevoPedido() {
  pedidoId = null;
  localStorage.removeItem('pedido');
  inicio();
}

async function inicio() {
  clearTimeout(timer);
  if (!alumno) return vistaNombre();
  if (pedidoId) return vistaSeguimiento();
  await cargar();
  vistaCatalogo();
}

inicio();
