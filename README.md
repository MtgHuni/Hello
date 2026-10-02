# Hello — Liste de tâches

Petite application web : un serveur **Node.js + Express** expose une API REST, et un frontend en **HTML/CSS/JavaScript pur** permet de gérer une liste de tâches.

## Démarrer

```bash
npm install
npm start
```

Puis ouvrir <http://localhost:3000>.

- `npm run dev` : redémarre le serveur automatiquement à chaque modification
- `npm test` : lance les tests de l'API

## Structure

```
server.js        point d'entrée (démarre le serveur)
app.js           routes de l'API
public/          frontend (index.html, style.css, app.js, hello.html)
data/tasks.json  données sauvegardées (créé automatiquement, non versionné)
test/            tests
```

## API

| Méthode | Route             | Description                                |
|---------|-------------------|--------------------------------------------|
| GET     | `/api/tasks`      | Liste les tâches                           |
| POST    | `/api/tasks`      | Crée une tâche — `{ "title": "..." }`      |
| PATCH   | `/api/tasks/:id`  | Modifie — `{ "done": true }` ou `{ "title": "..." }` |
| DELETE  | `/api/tasks/:id`  | Supprime une tâche                         |
