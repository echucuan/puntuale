const button = document.querySelector('#check-in');
const filters = [...document.querySelectorAll('[data-filter]')];
const records = [...document.querySelectorAll('[data-record]')];
let step = 0;
let selectedFilter = 'all';

const states = [
  { clock: '09:00', status: 'Todo listo para comenzar', button: 'Registrar entrada', title: 'Comienza tu día', description: 'Tu registro aparecerá aquí', time: '—', feedback: 'Demo reiniciada. Los datos son ficticios y no se guardan.', entry: '—', exit: '—', duration: '—', record: 'pending', label: 'Sin registros' },
  { clock: '09:00', status: 'Jornada en curso', button: 'Registrar salida', title: 'Entrada registrada', description: 'Registro de ejemplo · Inicio de jornada', time: '09:00', feedback: 'Entrada de ejemplo registrada. La fila del miércoles cambió en la vista del periodo. Prueba registrar la salida.', entry: '09:00', exit: '—', duration: '—', record: 'pending', label: 'En curso' },
  { clock: '17:00', status: 'Jornada completada · 8 h de ejemplo', button: 'Reiniciar demostración', title: 'Salida registrada', description: 'Entrada 09:00 · Salida 17:00', time: '17:00', feedback: 'Jornada de ejemplo completada. La vista del periodo ahora muestra entrada y salida. No se guardó ningún dato.', entry: '09:00', exit: '17:00', duration: '8 h', record: 'complete', label: 'Completo' }
];

function updateFilter() {
  let visible = 0;
  for (const row of records) {
    row.hidden = selectedFilter === 'pending' && row.dataset.record !== 'pending';
    if (!row.hidden) visible += 1;
  }
  for (const filter of filters) {
    const active = filter.dataset.filter === selectedFilter;
    filter.classList.toggle('active', active);
    filter.setAttribute('aria-pressed', String(active));
  }
  document.querySelector('#filter-summary').textContent = selectedFilter === 'all'
    ? `${visible} jornadas de ejemplo`
    : `${visible} ${visible === 1 ? 'jornada por revisar' : 'jornadas por revisar'}`;
}

button.addEventListener('click', () => {
  step = (step + 1) % states.length;
  const state = states[step];
  document.querySelector('#demo-clock').innerHTML = `${state.clock}<span>:00</span>`;
  document.querySelector('#clock-status').innerHTML = `<span class="dot"></span> ${state.status}`;
  button.innerHTML = `${state.button} <span aria-hidden="true">${step === 2 ? '↻' : '→'}</span>`;
  document.querySelector('#activity-title').textContent = state.title;
  document.querySelector('#activity-description').textContent = state.description;
  document.querySelector('#activity-time').textContent = state.time;
  document.querySelector('#demo-feedback').textContent = state.feedback;
  document.querySelector('#period-entry').textContent = state.entry;
  document.querySelector('#period-exit').textContent = state.exit;
  document.querySelector('#period-duration').textContent = state.duration;
  const status = document.querySelector('#period-status');
  status.textContent = state.label;
  status.className = `record-status ${state.record}`;
  document.querySelector('#linked-record').dataset.record = state.record;
  updateFilter();
});

for (const filter of filters) {
  filter.addEventListener('click', () => {
    selectedFilter = filter.dataset.filter;
    updateFilter();
  });
}

document.querySelector('#year').textContent = new Date().getFullYear();
