const fs = require('fs');

function minutosCorte() {
  try {
    return parseInt(fs.readFileSync('/etc/cafeteria/cutoff_minutes', 'utf8'), 10);
  } catch {
    return parseInt(process.env.CUTOFF_MINUTES || '10', 10);
  }
}

function horariosRecreos() {
  let txt = process.env.RECREOS || '10:15,12:00,15:30';
  try { txt = fs.readFileSync('/etc/cafeteria/recreos', 'utf8'); } catch {}
  return txt.split(',').map(h => h.trim()).filter(Boolean);
}

function minutosAhora(fecha = new Date()) {
  return ((fecha.getUTCHours() * 60 + fecha.getUTCMinutes() - 180) % 1440 + 1440) % 1440;
}

function hoy() {
  return new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
}

const aMin = hora => { const [h, m] = hora.split(':').map(Number); return h * 60 + m; };
const aHora = min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function estadoRecreo(recreo, corte = minutosCorte(), ahora = minutosAhora()) {
  const cierre = aMin(recreo.hora) - corte;
  return {
    id: recreo.id,
    hora: recreo.hora,
    cierre: aHora(cierre),
    corte,
    abierto: ahora < cierre,
    faltan: Math.max(0, cierre - ahora),
  };
}

module.exports = { estadoRecreo, minutosCorte, horariosRecreos, minutosAhora, hoy };
