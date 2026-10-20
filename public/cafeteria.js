const $app = document.getElementById('app');
let recreoId = null, timer = null;

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const get = url => fetch(url).then(r => r.json());
const send = (url, body) => fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function render() {
  clearTimeout(timer);
  const recreos = await get('/api/recreos');
  if (!recreos.some(r => r.id === recreoId)) recreoId = (recreos.find(r => r.abierto) || recreos[recreos.length - 1]).id;
  const [d, ventas, productos] = await Promise.all([get(`/api/cafeteria/${recreoId}`), get('/api/ventas'), get('/api/productos')]);
  const r = recreos.find(r => r.id === recreoId);
  const porPreparar = d.pedidos.filter(p => p.estado === 'recibido');
  const listos = d.pedidos.filter(p => p.estado === 'listo');

  $app.innerHTML = `
    <div class="cabecera">
      <div><p class="gris" style="margin:0">Cafetería</p><h1 style="margin:0">Recreo de las ${r.hora}</h1></div>
      <div class="pills">${recreos.map(x => `<button class="pill ${x.id === recreoId ? 'activa' : ''}" data-r="${x.id}">${x.hora}${x.id !== recreoId && d.conteos[x.id] ? ' · ' + d.conteos[x.id] : ''}</button>`).join('')}</div>
      <div class="aviso estado-corte">${r.abierto ? `Pedidos hasta las ${r.cierre}` : `🔒 Pedidos cerrados a las ${r.cierre}`}</div>
    </div>
    <div class="columnas">
      <section>
        <h3>Por preparar · ${porPreparar.length}</h3>
        <div class="grilla">${porPreparar.map(p => `<div class="card pedido">
          <h3>${p.codigo} <span class="gris">${esc(p.alumno)}</span></h3>
          ${p.items.map(i => `<p>${i.cantidad}× ${esc(i.nombre)}</p>`).join('')}
          <button class="primario" data-listo="${p.id}">Marcar listo</button></div>`).join('') || '<p class="gris">No hay pedidos pendientes.</p>'}</div>
      </section>
      <section>
        <h3>Listos para retirar · ${listos.length}</h3>
        ${listos.map(p => `<div class="card listo"><div><b>${p.codigo}</b><div class="gris">${esc(p.alumno)}</div></div>
          <button class="sec" data-entregado="${p.id}">Entregado</button></div>`).join('')}
      </section>
      <section>
        <div class="card"><h3>Total a preparar</h3>
          ${d.totales.map(([n, c]) => `<div class="fila"><span>${esc(n)}</span><b>${c}</b></div>`).join('') || '<p class="gris">Nada por ahora.</p>'}
          <p class="gris">Entregados hoy: ${d.entregados}</p></div>
        <div class="card"><h3>Ventas del día</h3>
          ${ventas.productos.map(v => `<div class="fila"><span>${v.cantidad}× ${esc(v.nombre)}</span><span>$${v.total}</span></div>`).join('')}
          <div class="fila"><b>Total</b><b>$${ventas.total}</b></div></div>
        <div class="card"><h3>Productos</h3>
          ${productos.map(p => `<label class="toggle"><span>${esc(p.nombre)}</span>
            <span class="gris"><input type="checkbox" style="width:auto;margin:0" data-agotado="${p.id}" ${p.agotado ? 'checked' : ''}> agotado</span></label>`).join('')}</div>
      </section>
    </div>`;

  $app.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { recreoId = +b.dataset.r; render(); });
  $app.querySelectorAll('[data-listo]').forEach(b => b.onclick = async () => { await send(`/api/pedidos/${b.dataset.listo}`, { estado: 'listo' }); render(); });
  $app.querySelectorAll('[data-entregado]').forEach(b => b.onclick = async () => { await send(`/api/pedidos/${b.dataset.entregado}`, { estado: 'entregado' }); render(); });
  $app.querySelectorAll('[data-agotado]').forEach(c => c.onchange = async () => { await send(`/api/productos/${c.dataset.agotado}`, { agotado: c.checked }); render(); });
  timer = setTimeout(render, 5000);
}

render();
