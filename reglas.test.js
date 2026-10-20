const test = require('node:test');
const assert = require('node:assert');
const { estadoRecreo } = require('./reglas');

const recreo = { id: 1, hora: '10:15' };

test('acepta pedidos antes del corte', () => {
  assert.strictEqual(estadoRecreo(recreo, 10, 9 * 60 + 50).abierto, true);
});

test('rechaza pedidos justo en el corte', () => {
  assert.strictEqual(estadoRecreo(recreo, 10, 10 * 60 + 5).abierto, false);
});

test('el corte depende de X', () => {
  assert.strictEqual(estadoRecreo(recreo, 20, 10 * 60).abierto, false);
  assert.strictEqual(estadoRecreo(recreo, 5, 10 * 60).abierto, true);
});
