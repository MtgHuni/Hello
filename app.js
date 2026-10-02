const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function createApp({ dataFile }) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  async function readTasks() {
    try {
      return JSON.parse(await fs.readFile(dataFile, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async function writeTasks(tasks) {
    await fs.mkdir(path.dirname(dataFile), { recursive: true });
    await fs.writeFile(dataFile, JSON.stringify(tasks, null, 2));
  }

  app.get('/api/tasks', async (req, res) => {
    res.json(await readTasks());
  });

  app.post('/api/tasks', async (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title) return res.status(400).json({ error: 'Le titre est obligatoire.' });

    const tasks = await readTasks();
    const task = { id: crypto.randomUUID(), title, done: false, createdAt: new Date().toISOString() };
    tasks.push(task);
    await writeTasks(tasks);
    res.status(201).json(task);
  });

  app.patch('/api/tasks/:id', async (req, res) => {
    const tasks = await readTasks();
    const task = tasks.find((t) => t.id === req.params.id);
    if (!task) return res.status(404).json({ error: 'Tâche introuvable.' });

    if (typeof req.body?.done === 'boolean') task.done = req.body.done;
    if (typeof req.body?.title === 'string') {
      const title = req.body.title.trim();
      if (!title) return res.status(400).json({ error: 'Le titre est obligatoire.' });
      task.title = title;
    }
    await writeTasks(tasks);
    res.json(task);
  });

  app.delete('/api/tasks/:id', async (req, res) => {
    const tasks = await readTasks();
    const remaining = tasks.filter((t) => t.id !== req.params.id);
    if (remaining.length === tasks.length) return res.status(404).json({ error: 'Tâche introuvable.' });
    await writeTasks(remaining);
    res.status(204).end();
  });

  return app;
}

module.exports = { createApp };
