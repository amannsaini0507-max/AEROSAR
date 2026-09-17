# Git guide for Member 5

Two situations — pick the one that matches you. Commands work in Git Bash / Terminal / PowerShell.

Before anything, install **Git** (https://git-scm.com) and **Node.js 18+** (https://nodejs.org),
and set your name once:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

---

## A. Your team already has a shared GitHub repo (most likely)

The master doc (§18.2) says each member works on their own `feature/*` branch and merges into
`develop`. Member 5's branch is `feature/dashboard` and folder is `frontend/`.

### 1. Pull (clone) the team repo
Get the repo URL from GitHub → green **Code** button → copy HTTPS URL.

```bash
cd Desktop                       # or wherever you keep projects
git clone https://github.com/<team-owner>/<repo-name>.git
cd <repo-name>
git checkout develop  ||  git checkout -b develop     # use develop if it exists
git checkout -b feature/dashboard
```

You can now open this folder in Codex / Antigravity (see `MEMBER5_AGENT_PROMPT.md`).

### 2. Bring in the dashboard from this zip
Copy the **`frontend`** folder from the zip into the team repo folder (next to `backend/`, etc.).
Don't copy `node_modules` if you ran `npm install` in the zip copy. If the team repo has no
`docs/` folder yet, copy the zip's `docs/` too. Then:

```bash
git add frontend docs
git commit -m "[frontend] add command-center dashboard wired to the §7 contract"
git push -u origin feature/dashboard
```

### 3. Open a pull request
On GitHub you'll see **Compare & pull request** → base: `develop`, compare: `feature/dashboard`.
Ask one teammate (ideally Member 4) to skim it — the doc's rule is to check topic/field names
against §7 (§18.4). Send Member 4 `frontend/WS_CONTRACT.md`.

### 4. Daily routine
```bash
git checkout feature/dashboard
git pull origin develop          # get everyone else's latest work
cd frontend && npm install && npm run dev
# ... work ...
git add frontend
git commit -m "[frontend] what you changed"
git push
```
Small commits, often (§18.3). Never push straight to `main`; only Member 6 merges there after
Day 12 testing.

---

## B. Push this zip as a new repo on your own GitHub

The zip already contains a `.git` folder with history and three branches:

| Branch | Contains |
|---|---|
| `main` | Master document + your original dashboard |
| `develop` | Same as `main` (integration branch per §18.2) |
| `feature/dashboard` | All the Member 5 work — **this is checked out** |

### 1. Create an empty repo on GitHub
github.com → **New repository** → name it (e.g. `aerosar`) → leave *all* "Add README / .gitignore /
license" boxes **unticked** → Create.

### 2. (Optional) Put your own name on the commits
The commits were made as "AEROSAR Member 5". To change them to you, run inside the `aerosar` folder:

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
git filter-branch -f --env-filter '
  export GIT_AUTHOR_NAME="$(git config user.name)"
  export GIT_AUTHOR_EMAIL="$(git config user.email)"
  export GIT_COMMITTER_NAME="$(git config user.name)"
  export GIT_COMMITTER_EMAIL="$(git config user.email)"
' -- --all
```
(Use Git Bash on Windows for this one.)

### 3. Push
```bash
cd aerosar
git remote add origin https://github.com/<you>/<repo-name>.git
git push -u origin --all
```
GitHub will ask you to log in the first time (a browser window, or a personal access token).

### 4. Make the work show on the main page (optional)
Either open a pull request `feature/dashboard` → `develop` → `main` on GitHub, or locally:

```bash
git checkout develop && git merge feature/dashboard
git checkout main && git merge develop
git push --all
```

---

## Run the dashboard after cloning

```bash
cd frontend
npm install
npm run dev          # open http://localhost:5173
```

## Common problems

| Message | Fix |
|---|---|
| `fatal: remote origin already exists` | `git remote set-url origin <new-url>` |
| `rejected … fetch first` | The GitHub repo isn't empty. `git pull origin <branch> --rebase`, then push again. |
| `Permission denied` / 403 | You aren't a collaborator on that repo — ask the owner to add you, or log in again. |
| `'npm' is not recognized` | Install Node.js, then reopen the terminal. |
| Port 5173 or 8000 in use | Close the other terminal running it, or `npx vite --port 5174`. |
