const button = document.querySelector('#check-in');
let step = 0;
button.addEventListener('click', () => {
  step = (step + 1) % 3;
  const states = [
    { clock: '09:00', status: 'Todo listo para comenzar', button: 'Registrar entrada', title: 'Comienza tu día', description: 'Tu registro aparecerá aquí', time: '—', feedback: 'Demo reiniciada. Los datos son ficticios y no se guardan.' },
    { clock: '09:00', status: 'Jornada en curso', button: 'Registrar salida', title: 'Entrada registrada', description: 'Registro de ejemplo · Inicio de jornada', time: '09:00', feedback: 'Entrada de ejemplo registrada. Prueba ahora registrar la salida.' },
    { clock: '17:00', status: 'Jornada completada · 8 h de ejemplo', button: 'Reiniciar demostración', title: 'Salida registrada', description: 'Entrada 09:00 · Salida 17:00', time: '17:00', feedback: 'Completaste la jornada de ejemplo. No se guardó ningún dato.' }
  ];
  const state = states[step];
  document.querySelector('#demo-clock').innerHTML = `${state.clock}<span>:00</span>`;
  document.querySelector('#clock-status').innerHTML = `<span class="dot"></span> ${state.status}`;
  button.innerHTML = `${state.button} <span aria-hidden="true">${step === 2 ? '↻' : '→'}</span>`;
  document.querySelector('#activity-title').textContent = state.title;
  document.querySelector('#activity-description').textContent = state.description;
  document.querySelector('#activity-time').textContent = state.time;
  document.querySelector('#demo-feedback').textContent = state.feedback;
});
document.querySelector('#year').textContent = new Date().getFullYear();
