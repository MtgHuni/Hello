const form = document.getElementById('task-form');
const input = document.getElementById('task-input');
const list = document.getElementById('task-list');
const counter = document.getElementById('counter');
const errorBox = document.getElementById('error');

let tasks = [];

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Erreur ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

function render() {
  list.replaceChildren();
  for (const task of tasks) {
    const li = document.createElement('li');
    li.classList.toggle('done', task.done);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.done;
    checkbox.addEventListener('change', () => toggleTask(task, checkbox.checked));

    const title = document.createElement('span');
    title.textContent = task.title;

    const del = document.createElement('button');
    del.className = 'delete';
    del.textContent = 'Supprimer';
    del.addEventListener('click', () => deleteTask(task));

    li.append(checkbox, title, del);
    list.append(li);
  }
  const left = tasks.filter((t) => !t.done).length;
  counter.textContent = `${left} tâche${left > 1 ? 's' : ''} restante${left > 1 ? 's' : ''}`;
}

async function loadTasks() {
  try {
    tasks = await api('GET', '/api/tasks');
    showError('');
    render();
  } catch (err) {
    showError(err.message);
  }
}

async function toggleTask(task, done) {
  try {
    Object.assign(task, await api('PATCH', `/api/tasks/${task.id}`, { done }));
    showError('');
  } catch (err) {
    showError(err.message);
  }
  render();
}

async function deleteTask(task) {
  try {
    await api('DELETE', `/api/tasks/${task.id}`);
    tasks = tasks.filter((t) => t.id !== task.id);
    showError('');
    render();
  } catch (err) {
    showError(err.message);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    tasks.push(await api('POST', '/api/tasks', { title: input.value }));
    input.value = '';
    showError('');
    render();
  } catch (err) {
    showError(err.message);
  }
});

loadTasks();
