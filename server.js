const express = require('express');
const { Pool } = require('pg');
const { estadoRecreo, minutosCorte, horariosRecreos, hoy } = require('./reglas');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'cafeteria',
  password: process.env.DB_PASSWORD || 'cafeteria',
  database: process.env.DB_NAME || 'cafeteria',
});

const app = express();
app.use(express.json());
app.use(express.static('public'));

const codigo = id => 'A-' + String(id).padStart(3, '0');

async function iniciarDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS productos (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, descripcion TEXT, precio INT NOT NULL, agotado BOOLEAN DEFAULT false);
    CREATE TABLE IF NOT EXISTS recreos (id SERIAL PRIMARY KEY, hora TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS pedidos (id SERIAL PRIMARY KEY, alumno TEXT NOT NULL, recreo_id INT REFERENCES recreos(id), estado TEXT NOT NULL DEFAULT 'recibido', fecha TEXT NOT NULL, creado TIMESTAMPTZ DEFAULT now());
    CREATE TABLE IF NOT EXISTS items_pedido (pedido_id INT REFERENCES pedidos(id), producto_id INT REFERENCES productos(id), cantidad INT NOT NULL, precio INT NOT NULL);
  `);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM productos');
  if (rows[0].n === 0) {
    await pool.query(`
      INSERT INTO productos (nombre, descripcion, precio) VALUES
        ('Medialuna', 'Dulce, recién horneada', 45),
        ('Café con leche', 'Chico · 200 ml', 80),
        ('Tostado jamón y queso', 'Pan de molde', 120),
        ('Jugo de naranja', 'Natural · 300 ml', 90),
        ('Alfajor de maicena', 'Casero', 50),
        ('Empanada de carne', 'Al horno', 85),
        ('Agua sin gas', '500 ml', 40),
        ('Fruta de estación', 'Según el día', 35);
    `);
  }
}

async function recreos() {
  const horas = horariosRecreos();
  await pool.query('INSERT INTO recreos (hora) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING', [horas]);
  const { rows } = await pool.query('SELECT id, hora FROM recreos WHERE hora = ANY($1) ORDER BY hora', [horas]);
  const corte = minutosCorte();
  return rows.map(r => estadoRecreo(r, corte));
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/productos', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM productos ORDER BY id');
  res.json(rows);
});

app.patch('/api/productos/:id', async (req, res) => {
  await pool.query('UPDATE productos SET agotado = $1 WHERE id = $2', [!!req.body.agotado, req.params.id]);
  res.json({ ok: true });
});

app.get('/api/recreos', async (req, res) => res.json(await recreos()));

app.post('/api/pedidos', async (req, res) => {
  const { alumno, recreo_id, items } = req.body;
  if (!alumno || !recreo_id || !items?.length) return res.status(400).json({ error: 'Faltan datos del pedido' });

  const recreo = (await recreos()).find(r => r.id === recreo_id);
  if (!recreo) return res.status(404).json({ error: 'Recreo inexistente' });
  if (!recreo.abierto) {
    return res.status(409).json({ error: `Los pedidos para las ${recreo.hora} cerraron a las ${recreo.cierre}` });
  }

  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows: [pedido] } = await cliente.query(
      'INSERT INTO pedidos (alumno, recreo_id, fecha) VALUES ($1, $2, $3) RETURNING id',
      [alumno, recreo_id, hoy()]
    );
    for (const { producto_id, cantidad } of items) {
      const { rows: [p] } = await cliente.query('SELECT precio, agotado, nombre FROM productos WHERE id = $1', [producto_id]);
      if (!p || p.agotado || cantidad < 1) throw new Error(p ? `${p.nombre} está agotado` : 'Producto inválido');
      await cliente.query(
        'INSERT INTO items_pedido (pedido_id, producto_id, cantidad, precio) VALUES ($1, $2, $3, $4)',
        [pedido.id, producto_id, cantidad, p.precio]
      );
    }
    await cliente.query('COMMIT');
    res.status(201).json({ id: pedido.id, codigo: codigo(pedido.id) });
  } catch (e) {
    await cliente.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    cliente.release();
  }
});

app.get('/api/pedidos/:id', async (req, res) => {
  const { rows: [p] } = await pool.query(
    `SELECT p.*, r.hora, to_char(p.creado AT TIME ZONE 'America/Montevideo', 'HH24:MI') AS hora_recibido
     FROM pedidos p JOIN recreos r ON r.id = p.recreo_id WHERE p.id = $1`,
    [req.params.id]
  );
  if (!p) return res.status(404).json({ error: 'Pedido no encontrado' });
  const { rows: items } = await pool.query(
    'SELECT pr.nombre, i.cantidad, i.precio FROM items_pedido i JOIN productos pr ON pr.id = i.producto_id WHERE i.pedido_id = $1',
    [p.id]
  );
  res.json({ ...p, codigo: codigo(p.id), items, total: items.reduce((s, i) => s + i.cantidad * i.precio, 0) });
});

app.patch('/api/pedidos/:id', async (req, res) => {
  if (!['listo', 'entregado'].includes(req.body.estado)) return res.status(400).json({ error: 'Estado inválido' });
  await pool.query('UPDATE pedidos SET estado = $1 WHERE id = $2', [req.body.estado, req.params.id]);
  res.json({ ok: true });
});

app.get('/api/cafeteria/:recreoId', async (req, res) => {
  const fecha = hoy();
  const { rows } = await pool.query(
    `SELECT p.id, p.alumno, p.estado, pr.nombre, i.cantidad
     FROM pedidos p JOIN items_pedido i ON i.pedido_id = p.id JOIN productos pr ON pr.id = i.producto_id
     WHERE p.recreo_id = $1 AND p.fecha = $2 AND p.estado <> 'entregado' ORDER BY p.id`,
    [req.params.recreoId, fecha]
  );
  const pedidos = {};
  const totales = {};
  for (const r of rows) {
    pedidos[r.id] ??= { id: r.id, codigo: codigo(r.id), alumno: r.alumno, estado: r.estado, items: [] };
    pedidos[r.id].items.push({ nombre: r.nombre, cantidad: r.cantidad });
    if (r.estado === 'recibido') totales[r.nombre] = (totales[r.nombre] || 0) + r.cantidad;
  }
  const { rows: conteos } = await pool.query(
    `SELECT recreo_id, count(*)::int AS n FROM pedidos WHERE fecha = $1 AND estado = 'recibido' GROUP BY recreo_id`,
    [fecha]
  );
  const { rows: [{ n: entregados }] } = await pool.query(
    `SELECT count(*)::int AS n FROM pedidos WHERE fecha = $1 AND estado = 'entregado'`,
    [fecha]
  );
  res.json({
    pedidos: Object.values(pedidos),
    totales: Object.entries(totales).sort((a, b) => b[1] - a[1]),
    conteos: Object.fromEntries(conteos.map(c => [c.recreo_id, c.n])),
    entregados,
  });
});

app.get('/api/ventas', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT pr.nombre, sum(i.cantidad)::int AS cantidad, sum(i.cantidad * i.precio)::int AS total
     FROM pedidos p JOIN items_pedido i ON i.pedido_id = p.id JOIN productos pr ON pr.id = i.producto_id
     WHERE p.fecha = $1 GROUP BY pr.nombre ORDER BY total DESC`,
    [hoy()]
  );
  res.json({ productos: rows, total: rows.reduce((s, r) => s + r.total, 0) });
});

async function arrancar() {
  for (let i = 0; ; i++) {
    try {
      await iniciarDB();
      break;
    } catch (e) {
      if (i > 30) throw e;
      console.log('Esperando la base de datos...');
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  app.listen(3000, () => console.log('Escuchando en :3000'));
}

arrancar();
