# Volleyball CV — Plan 2: React Frontend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React + TypeScript + Vite frontend with 5 views (Match Manager, Upload+Process, Rally Review, Export+Download, Active Learning stub) that talks to the existing FastAPI backend.

**Architecture:** Vite dev server on port 5173, FastAPI on port 8000 with CORS enabled. React Router v6 for client-side routing. Tailwind CSS for styling. API calls use plain `fetch` wrapped in typed functions. Tests use Vitest + React Testing Library with the API client module mocked.

**Tech Stack:** Node 20, React 18, TypeScript 5, Vite 5, React Router v6, Tailwind CSS v3, Vitest, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom

---

## File Structure

```
volleyball-cv/
├── backend/
│   ├── main.py                    ADD: CORSMiddleware, static file mounts
│   └── routers/
│       └── matches.py             ADD: GET /matches/{id}/videos endpoint
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── src/
│       ├── main.tsx               Entry point — renders App
│       ├── App.tsx                BrowserRouter + sidebar nav + routes
│       ├── index.css              Tailwind directives
│       ├── types.ts               TS interfaces mirroring all backend schemas
│       ├── api/
│       │   └── client.ts          Typed fetch wrappers for every backend endpoint
│       ├── views/
│       │   ├── MatchManager.tsx   View 1: list matches, create match, navigate to views
│       │   ├── UploadProcess.tsx  View 2: upload set videos, trigger processing, poll progress
│       │   ├── RallyReview.tsx    View 3: list rallies, video preview, score buttons, edit timestamps
│       │   ├── ExportUpload.tsx   View 5: trigger export, show download links
│       │   └── ActiveLearning.tsx View 4: stub placeholder (implemented in Plan 3)
│       └── test/
│           ├── setup.ts           @testing-library/jest-dom matchers
│           ├── api.test.ts        API client — verify fetch called with correct URL/method
│           ├── MatchManager.test.tsx
│           ├── UploadProcess.test.tsx
│           ├── RallyReview.test.tsx
│           └── ExportUpload.test.tsx
```

---

### Task 1: Backend additions for frontend

**Files:**
- Modify: `backend/main.py`
- Modify: `backend/routers/matches.py`
- Modify: `tests/test_matches.py`

Three changes the frontend needs: (1) CORS so the browser on port 5173 can call port 8000, (2) a `GET /matches/{id}/videos` endpoint so the frontend can list videos per match, (3) static file serving so the video player can stream raw uploads.

- [ ] **Step 1: Add CORS middleware to backend/main.py**

```python
# backend/main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import backend.models  # noqa — registers all ORM models with Base
from backend.config import EXPORTS_DIR, UPLOADS_DIR
from backend.database import Base, engine
from backend.routers import matches, videos, jobs, rallies


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    yield


app = FastAPI(title="Volleyball CV", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")
app.mount("/exports", StaticFiles(directory=str(EXPORTS_DIR)), name="exports")

app.include_router(matches.router)
app.include_router(videos.router)
app.include_router(jobs.router)
app.include_router(rallies.router)
```

- [ ] **Step 2: Add GET /matches/{match_id}/videos to backend/routers/matches.py**

Add this endpoint after the existing `get_match` endpoint:

```python
from backend.models.match import Match, Video
from backend.schemas.match import MatchCreate, MatchRead, ProcessedVideoRead, VideoRead

# ... (existing endpoints unchanged) ...

@router.get("/{match_id}/videos", response_model=list[VideoRead])
def list_match_videos(match_id: int, db: Session = Depends(get_db)):
    match = db.get(Match, match_id)
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")
    return db.query(Video).filter(Video.match_id == match_id).order_by(Video.set_number).all()
```

The full updated import block at the top of `matches.py`:

```python
# backend/routers/matches.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.match import Match, Video
from backend.schemas.match import MatchCreate, MatchRead, ProcessedVideoRead, VideoRead

router = APIRouter(prefix="/matches", tags=["matches"])
```

- [ ] **Step 3: Write failing test for the new endpoint**

```python
# Add to tests/test_matches.py
import io

def test_list_match_videos(client):
    match_id = client.post("/matches", json={"date": "2026-05-18"}).json()["id"]
    # No videos yet
    resp = client.get(f"/matches/{match_id}/videos")
    assert resp.status_code == 200
    assert resp.json() == []

    # Upload a video
    client.post(
        f"/matches/{match_id}/videos",
        data={"set_number": "1"},
        files={"file": ("s.mp4", io.BytesIO(b"x"), "video/mp4")},
    )
    resp = client.get(f"/matches/{match_id}/videos")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["set_number"] == 1

def test_list_match_videos_not_found(client):
    resp = client.get("/matches/999/videos")
    assert resp.status_code == 404
```

- [ ] **Step 4: Run tests**

```bash
cd /home/leew4/volleyball-cv
PATH="/home/leew4/bin:$PATH" PYTHONPATH=backend python3.12 -m pytest tests/test_matches.py -v
```

Expected: all `PASSED` (including two new tests)

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
PATH="/home/leew4/bin:$PATH" PYTHONPATH=backend python3.12 -m pytest tests/ -v
```

Expected: all previously passing tests still `PASSED`

- [ ] **Step 6: Commit**

```bash
git add backend/main.py backend/routers/matches.py tests/test_matches.py
git commit -m "feat: backend additions for frontend — CORS, static files, list videos endpoint"
```

---

### Task 2: Vite + React scaffold

**Files:**
- Create: `frontend/` directory tree (via npm create vite)
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`
- Create: `frontend/tailwind.config.js`
- Create: `frontend/postcss.config.js`
- Create: `frontend/src/test/setup.ts`

- [ ] **Step 1: Create Vite project**

```bash
cd /home/leew4/volleyball-cv
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
```

- [ ] **Step 2: Install dependencies**

```bash
cd /home/leew4/volleyball-cv/frontend
npm install react-router-dom@6
npm install -D tailwindcss@3 postcss autoprefixer
npm install -D vitest @vitest/coverage-v8 jsdom
npm install -D @testing-library/react @testing-library/user-event @testing-library/jest-dom
npx tailwindcss init -p
```

- [ ] **Step 3: Replace vite.config.ts**

```typescript
// frontend/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
```

- [ ] **Step 4: Add test script to package.json**

In `frontend/package.json`, update the `"scripts"` section to add:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 5: Configure Tailwind**

```javascript
// frontend/tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
```

- [ ] **Step 6: Create test setup file**

```typescript
// frontend/src/test/setup.ts
import '@testing-library/jest-dom'
```

- [ ] **Step 7: Add tsconfig reference for test globals**

Verify `frontend/tsconfig.app.json` includes `"types": ["vitest/globals"]` in `compilerOptions`. If not, add it:

```json
{
  "compilerOptions": {
    "types": ["vitest/globals"]
  }
}
```

- [ ] **Step 8: Run a smoke test to verify setup**

```bash
cd /home/leew4/volleyball-cv/frontend
npm test
```

Expected: `No test files found` (no test files yet, but setup succeeds without errors)

- [ ] **Step 9: Commit**

```bash
cd /home/leew4/volleyball-cv
git add frontend/
git commit -m "chore: Vite + React + TypeScript scaffold with Tailwind and Vitest"
```

---

### Task 3: TypeScript types + API client

**Files:**
- Create: `frontend/src/types.ts`
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/test/api.test.ts`

- [ ] **Step 1: Create frontend/src/types.ts**

```typescript
// frontend/src/types.ts

export interface Match {
  id: number
  date: string
  opponent: string | null
  venue: string | null
  notes: string | null
  created_at: string
}

export interface MatchCreate {
  date: string
  opponent?: string
  venue?: string
  notes?: string
}

export interface Video {
  id: number
  match_id: number
  set_number: number
  raw_path: string
  status: 'pending' | 'processing' | 'done' | 'error'
  duration: number | null
  created_at: string
}

export interface Job {
  id: number
  video_id: number
  status: 'pending' | 'running' | 'done' | 'error'
  progress_pct: number
  error: string | null
  created_at: string
}

export interface Rally {
  id: number
  video_id: number
  start_time: number
  end_time: number
  score_home: number | null
  score_away: number | null
  confidence: number
}

export interface RallyUpdate {
  score_home?: number | null
  score_away?: number | null
  start_time?: number
  end_time?: number
}

export interface ProcessedVideo {
  id: number
  match_id: number
  output_path: string
  created_at: string
}
```

- [ ] **Step 2: Create frontend/src/api/client.ts**

```typescript
// frontend/src/api/client.ts
import type { Job, Match, MatchCreate, ProcessedVideo, Rally, RallyUpdate, Video } from '../types'

const BASE = 'http://localhost:8000'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, init)
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`${r.status} ${text}`)
  }
  return r.json() as Promise<T>
}

export function getMatches(): Promise<Match[]> {
  return request('/matches')
}

export function getMatch(matchId: number): Promise<Match> {
  return request(`/matches/${matchId}`)
}

export function createMatch(data: MatchCreate): Promise<Match> {
  return request('/matches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export function getMatchVideos(matchId: number): Promise<Video[]> {
  return request(`/matches/${matchId}/videos`)
}

export function uploadVideo(matchId: number, setNumber: number, file: File): Promise<Video> {
  const form = new FormData()
  form.append('set_number', String(setNumber))
  form.append('file', file)
  return request(`/matches/${matchId}/videos`, { method: 'POST', body: form })
}

export function processVideo(videoId: number): Promise<Job> {
  return request(`/videos/${videoId}/process`, { method: 'POST' })
}

export function getJob(jobId: number): Promise<Job> {
  return request(`/jobs/${jobId}`)
}

export function getRallies(videoId: number): Promise<Rally[]> {
  return request(`/videos/${videoId}/rallies`)
}

export function patchRally(rallyId: number, data: RallyUpdate): Promise<Rally> {
  return request(`/rallies/${rallyId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export function exportMatch(matchId: number): Promise<ProcessedVideo[]> {
  return request(`/matches/${matchId}/export`, { method: 'POST' })
}
```

- [ ] **Step 3: Write failing tests**

```typescript
// frontend/src/test/api.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getMatches, createMatch, getMatchVideos, getRallies, patchRally, exportMatch } from '../api/client'

describe('API client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockFetch(data: unknown, status = 200) {
    vi.mocked(fetch).mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(String(data)),
    } as Response)
  }

  it('getMatches — calls GET /matches', async () => {
    mockFetch([{ id: 1, date: '2026-05-18' }])
    const result = await getMatches()
    expect(fetch).toHaveBeenCalledWith('http://localhost:8000/matches', undefined)
    expect(result).toHaveLength(1)
  })

  it('createMatch — calls POST /matches with JSON body', async () => {
    mockFetch({ id: 2, date: '2026-05-18' })
    await createMatch({ date: '2026-05-18', opponent: 'Team A' })
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000/matches',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: '2026-05-18', opponent: 'Team A' }),
      }),
    )
  })

  it('getMatchVideos — calls GET /matches/{id}/videos', async () => {
    mockFetch([])
    await getMatchVideos(3)
    expect(fetch).toHaveBeenCalledWith('http://localhost:8000/matches/3/videos', undefined)
  })

  it('getRallies — calls GET /videos/{id}/rallies', async () => {
    mockFetch([])
    await getRallies(5)
    expect(fetch).toHaveBeenCalledWith('http://localhost:8000/videos/5/rallies', undefined)
  })

  it('patchRally — calls PATCH /rallies/{id} with JSON body', async () => {
    mockFetch({ id: 1, score_home: 5 })
    await patchRally(1, { score_home: 5, score_away: 3 })
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000/rallies/1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ score_home: 5, score_away: 3 }),
      }),
    )
  })

  it('throws on non-ok response', async () => {
    mockFetch('Not Found', 404)
    await expect(getMatchVideos(999)).rejects.toThrow('404')
  })

  it('exportMatch — calls POST /matches/{id}/export', async () => {
    mockFetch([])
    await exportMatch(1)
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000/matches/1/export',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
```

- [ ] **Step 4: Run tests to verify they fail first**

```bash
cd /home/leew4/volleyball-cv/frontend
npm test
```

Expected: `FAIL` (api/client.ts doesn't exist yet)

- [ ] **Step 5: Run tests again (both files exist now)**

The files were created in steps 1 and 2. Run tests:

```bash
npm test
```

Expected: all `PASSED`

- [ ] **Step 6: Commit**

```bash
cd /home/leew4/volleyball-cv
git add frontend/src/types.ts frontend/src/api/ frontend/src/test/api.test.ts
git commit -m "feat: TypeScript types and typed API client"
```

---

### Task 4: App shell + routing

**Files:**
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/index.css`
- Create stubs: `frontend/src/views/MatchManager.tsx`, `frontend/src/views/UploadProcess.tsx`, `frontend/src/views/RallyReview.tsx`, `frontend/src/views/ExportUpload.tsx`, `frontend/src/views/ActiveLearning.tsx`

- [ ] **Step 1: Replace frontend/src/index.css with Tailwind directives**

```css
/* frontend/src/index.css */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 2: Replace frontend/src/main.tsx**

```typescript
// frontend/src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 3: Create stub view files (so App.tsx imports resolve)**

```typescript
// frontend/src/views/MatchManager.tsx
export default function MatchManager() { return <div>Match Manager</div> }
```

```typescript
// frontend/src/views/UploadProcess.tsx
export default function UploadProcess() { return <div>Upload</div> }
```

```typescript
// frontend/src/views/RallyReview.tsx
export default function RallyReview() { return <div>Rally Review</div> }
```

```typescript
// frontend/src/views/ExportUpload.tsx
export default function ExportUpload() { return <div>Export</div> }
```

```typescript
// frontend/src/views/ActiveLearning.tsx
export default function ActiveLearning() {
  return (
    <div className="p-8 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-2">Active Learning Review</h1>
      <p className="text-gray-500">
        Available in Plan 3 once a Tier 2 YOLOv8 model has been trained.
        Come back after you have uploaded and labeled your first set of frames.
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Replace frontend/src/App.tsx**

```typescript
// frontend/src/App.tsx
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import ActiveLearning from './views/ActiveLearning'
import ExportUpload from './views/ExportUpload'
import MatchManager from './views/MatchManager'
import RallyReview from './views/RallyReview'
import UploadProcess from './views/UploadProcess'

function NavItem({ to, label, end }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `block px-3 py-2 rounded text-sm ${isActive ? 'bg-blue-700 text-white' : 'text-gray-300 hover:text-white hover:bg-gray-700'}`
      }
    >
      {label}
    </NavLink>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen bg-gray-50">
        <nav className="w-44 bg-gray-900 p-3 flex flex-col gap-1 shrink-0">
          <span className="text-white font-bold text-sm mb-3 px-3">Volleyball CV</span>
          <NavItem to="/" label="Matches" end />
          <NavItem to="/active-learning" label="Active Learning" />
        </nav>
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<MatchManager />} />
            <Route path="/matches/:matchId/upload" element={<UploadProcess />} />
            <Route path="/matches/:matchId/rally-review" element={<RallyReview />} />
            <Route path="/matches/:matchId/export" element={<ExportUpload />} />
            <Route path="/active-learning" element={<ActiveLearning />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
```

- [ ] **Step 5: Start the dev server and verify it loads**

```bash
cd /home/leew4/volleyball-cv/frontend
npm run dev
```

Open http://localhost:5173 in a browser. Expected: sidebar with "Volleyball CV" + "Matches" nav item, main area showing "Match Manager" placeholder text. No console errors.

Kill the server with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
cd /home/leew4/volleyball-cv
git add frontend/src/
git commit -m "feat: app shell — sidebar nav, React Router routes, view stubs"
```

---

### Task 5: Match Manager view

**Files:**
- Modify: `frontend/src/views/MatchManager.tsx`
- Create: `frontend/src/test/MatchManager.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// frontend/src/test/MatchManager.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import MatchManager from '../views/MatchManager'
import type { Match } from '../types'

vi.mock('../api/client')

const MATCH: Match = {
  id: 1,
  date: '2026-05-18',
  opponent: 'Team A',
  venue: null,
  notes: null,
  created_at: '2026-05-18T00:00:00',
}

describe('MatchManager', () => {
  beforeEach(() => {
    vi.mocked(api.getMatches).mockResolvedValue([MATCH])
    vi.mocked(api.createMatch).mockResolvedValue({ ...MATCH, id: 2, date: '2026-06-01' })
  })

  it('renders a list of matches', async () => {
    render(<MemoryRouter><MatchManager /></MemoryRouter>)
    await screen.findByText('2026-05-18')
    expect(screen.getByText('vs Team A')).toBeInTheDocument()
  })

  it('shows empty state when no matches', async () => {
    vi.mocked(api.getMatches).mockResolvedValue([])
    render(<MemoryRouter><MatchManager /></MemoryRouter>)
    await screen.findByText(/no matches yet/i)
  })

  it('creates a match and navigates on submit', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><MatchManager /></MemoryRouter>)
    await screen.findByText('2026-05-18')

    await user.type(screen.getByPlaceholderText(/opponent/i), 'Rivals')
    const dateInput = screen.getByLabelText(/date/i)
    await user.type(dateInput, '2026-06-01')
    await user.click(screen.getByRole('button', { name: /new match/i }))

    await waitFor(() => expect(api.createMatch).toHaveBeenCalledWith(
      expect.objectContaining({ opponent: 'Rivals' }),
    ))
  })

  it('shows Upload and Rally Review links per match', async () => {
    render(<MemoryRouter><MatchManager /></MemoryRouter>)
    await screen.findByText('2026-05-18')
    expect(screen.getByRole('link', { name: /upload/i })).toHaveAttribute('href', '/matches/1/upload')
    expect(screen.getByRole('link', { name: /rally review/i })).toHaveAttribute('href', '/matches/1/rally-review')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /home/leew4/volleyball-cv/frontend
npm test
```

Expected: `FAIL` (stub MatchManager doesn't have the right UI)

- [ ] **Step 3: Replace frontend/src/views/MatchManager.tsx**

```typescript
// frontend/src/views/MatchManager.tsx
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createMatch, getMatches } from '../api/client'
import type { Match, MatchCreate } from '../types'

export default function MatchManager() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState('')
  const [opponent, setOpponent] = useState('')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    getMatches()
      .then(setMatches)
      .finally(() => setLoading(false))
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      const body: MatchCreate = { date }
      if (opponent.trim()) body.opponent = opponent.trim()
      const match = await createMatch(body)
      navigate(`/matches/${match.id}/upload`)
    } finally {
      setCreating(false)
    }
  }

  if (loading) return <p className="p-6 text-gray-500">Loading…</p>

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Matches</h1>

      <form onSubmit={handleCreate} className="mb-8 flex flex-wrap gap-2 items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="date" className="text-xs text-gray-600 font-medium">Date</label>
          <input
            id="date"
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            required
            className="border rounded px-3 py-1.5 text-sm"
          />
        </div>
        <input
          type="text"
          placeholder="Opponent (optional)"
          value={opponent}
          onChange={e => setOpponent(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={creating}
          className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50 hover:bg-blue-700"
        >
          {creating ? 'Creating…' : 'New Match'}
        </button>
      </form>

      {matches.length === 0 ? (
        <p className="text-gray-500">No matches yet. Create one above.</p>
      ) : (
        <ul className="space-y-2">
          {matches.map(m => (
            <li key={m.id} className="border rounded-lg p-4 bg-white flex justify-between items-center">
              <div>
                <span className="font-semibold">{m.date}</span>
                {m.opponent && <span className="ml-2 text-gray-500 text-sm">vs {m.opponent}</span>}
              </div>
              <div className="flex gap-3 text-sm">
                <Link to={`/matches/${m.id}/upload`} className="text-blue-600 hover:underline">
                  Upload
                </Link>
                <Link to={`/matches/${m.id}/rally-review`} className="text-blue-600 hover:underline">
                  Rally Review
                </Link>
                <Link to={`/matches/${m.id}/export`} className="text-blue-600 hover:underline">
                  Export
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
cd /home/leew4/volleyball-cv/frontend
npm test
```

Expected: all `PASSED`

- [ ] **Step 5: Commit**

```bash
cd /home/leew4/volleyball-cv
git add frontend/src/views/MatchManager.tsx frontend/src/test/MatchManager.test.tsx
git commit -m "feat: Match Manager view — list matches, create form, nav links"
```

---

### Task 6: Upload + Process view

**Files:**
- Modify: `frontend/src/views/UploadProcess.tsx`
- Create: `frontend/src/test/UploadProcess.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// frontend/src/test/UploadProcess.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import UploadProcess from '../views/UploadProcess'
import type { Job, Match, Video } from '../types'

vi.mock('../api/client')

const MATCH: Match = { id: 1, date: '2026-05-18', opponent: 'Team A', venue: null, notes: null, created_at: '' }
const VIDEO: Video = { id: 10, match_id: 1, set_number: 1, raw_path: '/tmp/x.mp4', status: 'pending', duration: null, created_at: '' }
const JOB_DONE: Job = { id: 5, video_id: 10, status: 'done', progress_pct: 100, error: null, created_at: '' }

function renderWithRoute(matchId = '1') {
  return render(
    <MemoryRouter initialEntries={[`/matches/${matchId}/upload`]}>
      <Routes>
        <Route path="/matches/:matchId/upload" element={<UploadProcess />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('UploadProcess', () => {
  beforeEach(() => {
    vi.mocked(api.getMatch).mockResolvedValue(MATCH)
    vi.mocked(api.uploadVideo).mockResolvedValue(VIDEO)
    vi.mocked(api.processVideo).mockResolvedValue({ ...JOB_DONE, status: 'pending', progress_pct: 0 })
    vi.mocked(api.getJob).mockResolvedValue(JOB_DONE)
  })

  it('shows match title and three set panels', async () => {
    renderWithRoute()
    await screen.findByText('2026-05-18')
    expect(screen.getAllByText(/set [123]/i)).toHaveLength(3)
  })

  it('upload button is disabled with no file selected', async () => {
    renderWithRoute()
    await screen.findByText('2026-05-18')
    const buttons = screen.getAllByRole('button', { name: /upload/i })
    expect(buttons[0]).toBeDisabled()
  })

  it('uploads file and shows progress bar', async () => {
    const user = userEvent.setup()
    renderWithRoute()
    await screen.findByText('2026-05-18')

    const file = new File(['video'], 'set1.mp4', { type: 'video/mp4' })
    const inputs = screen.getAllByLabelText(/set [123]/i)
    await user.upload(inputs[0], file)

    const button = screen.getAllByRole('button', { name: /upload/i })[0]
    await user.click(button)

    await waitFor(() => expect(api.uploadVideo).toHaveBeenCalledWith(1, 1, file))
    await waitFor(() => expect(api.processVideo).toHaveBeenCalledWith(10))
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /home/leew4/volleyball-cv/frontend
npm test -- --reporter=verbose 2>&1 | tail -20
```

Expected: `FAIL`

- [ ] **Step 3: Replace frontend/src/views/UploadProcess.tsx**

```typescript
// frontend/src/views/UploadProcess.tsx
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getJob, getMatch, processVideo, uploadVideo } from '../api/client'
import type { Match } from '../types'

type SetStatus = 'idle' | 'uploading' | 'processing' | 'done' | 'error'

interface SetState {
  setNumber: 1 | 2 | 3
  file: File | null
  status: SetStatus
  progress: number
  error: string | null
}

const INITIAL_SETS: SetState[] = [
  { setNumber: 1, file: null, status: 'idle', progress: 0, error: null },
  { setNumber: 2, file: null, status: 'idle', progress: 0, error: null },
  { setNumber: 3, file: null, status: 'idle', progress: 0, error: null },
]

export default function UploadProcess() {
  const { matchId } = useParams<{ matchId: string }>()
  const [match, setMatch] = useState<Match | null>(null)
  const [sets, setSets] = useState<SetState[]>(INITIAL_SETS)
  const timers = useRef<Record<number, ReturnType<typeof setInterval>>>({})

  useEffect(() => {
    getMatch(Number(matchId)).then(setMatch)
    return () => { Object.values(timers.current).forEach(clearInterval) }
  }, [matchId])

  function setSetField<K extends keyof SetState>(n: 1 | 2 | 3, key: K, val: SetState[K]) {
    setSets(prev => prev.map(s => s.setNumber === n ? { ...s, [key]: val } : s))
  }

  async function handleProcess(setNumber: 1 | 2 | 3) {
    const s = sets.find(s => s.setNumber === setNumber)!
    if (!s.file) return
    setSetField(setNumber, 'status', 'uploading')
    setSetField(setNumber, 'error', null)
    try {
      const video = await uploadVideo(Number(matchId), setNumber, s.file)
      setSetField(setNumber, 'status', 'processing')
      const job = await processVideo(video.id)
      const poll = setInterval(async () => {
        const updated = await getJob(job.id)
        setSetField(setNumber, 'progress', updated.progress_pct)
        if (updated.status === 'done') {
          setSetField(setNumber, 'status', 'done')
          clearInterval(timers.current[setNumber])
        } else if (updated.status === 'error') {
          setSetField(setNumber, 'status', 'error')
          setSetField(setNumber, 'error', updated.error)
          clearInterval(timers.current[setNumber])
        }
      }, 2000)
      timers.current[setNumber] = poll
    } catch (err) {
      setSetField(setNumber, 'status', 'error')
      setSetField(setNumber, 'error', String(err))
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Link to="/" className="text-sm text-blue-600 hover:underline">← Back</Link>
      {match && (
        <h1 className="text-2xl font-bold mt-1 mb-6">
          {match.date}{match.opponent ? ` vs ${match.opponent}` : ''}
        </h1>
      )}

      <div className="space-y-4">
        {sets.map(s => (
          <div key={s.setNumber} className="border rounded-lg p-4 bg-white">
            <h2 className="font-semibold mb-3">Set {s.setNumber}</h2>
            <div className="flex gap-2 items-center flex-wrap">
              <label htmlFor={`file-${s.setNumber}`} className="sr-only">
                Set {s.setNumber}
              </label>
              <input
                id={`file-${s.setNumber}`}
                type="file"
                accept="video/*"
                aria-label={`Set ${s.setNumber}`}
                disabled={s.status !== 'idle'}
                onChange={e => setSetField(s.setNumber, 'file', e.target.files?.[0] ?? null)}
                className="text-sm"
              />
              <button
                onClick={() => handleProcess(s.setNumber)}
                disabled={!s.file || s.status !== 'idle'}
                className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm font-medium disabled:opacity-40 hover:bg-blue-700"
              >
                Upload &amp; Process
              </button>
            </div>

            {s.status === 'uploading' && (
              <p className="mt-2 text-sm text-gray-500">Uploading…</p>
            )}
            {(s.status === 'processing' || s.status === 'done') && (
              <div className="mt-3">
                <div className="h-2 bg-gray-200 rounded overflow-hidden">
                  <div
                    className={`h-full rounded transition-all duration-300 ${s.status === 'done' ? 'bg-green-500' : 'bg-blue-500'}`}
                    style={{ width: `${s.progress}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {s.status === 'done' ? '✓ Done' : `Processing… ${Math.round(s.progress)}%`}
                </p>
              </div>
            )}
            {s.status === 'error' && (
              <p className="mt-2 text-sm text-red-600">Error: {s.error}</p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6">
        <Link to={`/matches/${matchId}/rally-review`} className="text-blue-600 hover:underline text-sm">
          Go to Rally Review →
        </Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
cd /home/leew4/volleyball-cv/frontend
npm test
```

Expected: all `PASSED`

- [ ] **Step 5: Commit**

```bash
cd /home/leew4/volleyball-cv
git add frontend/src/views/UploadProcess.tsx frontend/src/test/UploadProcess.test.tsx
git commit -m "feat: Upload + Process view — file inputs, progress polling, per-set status"
```

---

### Task 7: Rally Review view

**Files:**
- Modify: `frontend/src/views/RallyReview.tsx`
- Create: `frontend/src/test/RallyReview.test.tsx`

The Rally Review shows all videos for a match (by set number). For each set, it lists detected rallies with timestamps and score buttons. Clicking a rally loads it in a video player (seeks to `start_time`). Timestamps are editable via number inputs; editing them patches the rally immediately on blur.

- [ ] **Step 1: Write failing tests**

```typescript
// frontend/src/test/RallyReview.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import RallyReview from '../views/RallyReview'
import type { Match, Rally, Video } from '../types'

vi.mock('../api/client')

const MATCH: Match = { id: 1, date: '2026-05-18', opponent: null, venue: null, notes: null, created_at: '' }
const VIDEO: Video = { id: 10, match_id: 1, set_number: 1, raw_path: '/uploads/s.mp4', status: 'done', duration: 600, created_at: '' }
const RALLY: Rally = { id: 20, video_id: 10, start_time: 30.0, end_time: 65.0, score_home: null, score_away: null, confidence: 1.0 }

function renderWithRoute(matchId = '1') {
  return render(
    <MemoryRouter initialEntries={[`/matches/${matchId}/rally-review`]}>
      <Routes>
        <Route path="/matches/:matchId/rally-review" element={<RallyReview />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RallyReview', () => {
  beforeEach(() => {
    vi.mocked(api.getMatch).mockResolvedValue(MATCH)
    vi.mocked(api.getMatchVideos).mockResolvedValue([VIDEO])
    vi.mocked(api.getRallies).mockResolvedValue([RALLY])
    vi.mocked(api.patchRally).mockResolvedValue({ ...RALLY, score_home: 1, score_away: 0 })
  })

  it('renders match title and set heading', async () => {
    renderWithRoute()
    await screen.findByText('2026-05-18')
    await screen.findByText(/set 1/i)
  })

  it('renders rally with timestamps as editable inputs', async () => {
    renderWithRoute()
    // Timestamps render inside <input type="number">, not as text nodes
    await screen.findByDisplayValue('30')
    expect(screen.getByDisplayValue('65')).toBeInTheDocument()
  })

  it('clicking Home Scored patches rally score_home', async () => {
    const user = userEvent.setup()
    renderWithRoute()
    await screen.findByDisplayValue('30')
    await user.click(screen.getByRole('button', { name: /home scored/i }))
    await waitFor(() => expect(api.patchRally).toHaveBeenCalledWith(20, expect.objectContaining({ score_home: 1 })))
  })

  it('clicking Away Scored patches rally score_away', async () => {
    const user = userEvent.setup()
    renderWithRoute()
    await screen.findByDisplayValue('30')
    await user.click(screen.getByRole('button', { name: /away scored/i }))
    await waitFor(() => expect(api.patchRally).toHaveBeenCalledWith(20, expect.objectContaining({ score_away: 1 })))
  })

  it('shows no rallies message when list is empty', async () => {
    vi.mocked(api.getRallies).mockResolvedValue([])
    renderWithRoute()
    await screen.findByText(/set 1/i)
    expect(screen.getByText(/no rallies detected/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /home/leew4/volleyball-cv/frontend
npm test
```

Expected: `FAIL`

- [ ] **Step 3: Replace frontend/src/views/RallyReview.tsx**

```typescript
// frontend/src/views/RallyReview.tsx
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getMatch, getMatchVideos, getRallies, patchRally } from '../api/client'
import type { Match, Rally, Video } from '../types'

const BACKEND = 'http://localhost:8000'

interface VideoWithRallies {
  video: Video
  rallies: Rally[]
}

export default function RallyReview() {
  const { matchId } = useParams<{ matchId: string }>()
  const [match, setMatch] = useState<Match | null>(null)
  const [sets, setSets] = useState<VideoWithRallies[]>([])
  const [activeRally, setActiveRally] = useState<{ videoId: number; rallyId: number } | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const id = Number(matchId)
    getMatch(id).then(setMatch)
    getMatchVideos(id).then(async videos => {
      const withRallies = await Promise.all(
        videos.map(async video => ({ video, rallies: await getRallies(video.id) })),
      )
      setSets(withRallies)
    })
  }, [matchId])

  function selectRally(videoId: number, rally: Rally) {
    setActiveRally({ videoId, rallyId: rally.id })
    if (videoRef.current) {
      videoRef.current.currentTime = rally.start_time
    }
  }

  function updateLocalRally(rallyId: number, patch: Partial<Rally>) {
    setSets(prev => prev.map(s => ({
      ...s,
      rallies: s.rallies.map(r => r.id === rallyId ? { ...r, ...patch } : r),
    })))
  }

  async function scoreHome(rally: Rally) {
    const next = (rally.score_home ?? 0) + 1
    updateLocalRally(rally.id, { score_home: next })
    await patchRally(rally.id, { score_home: next })
  }

  async function scoreAway(rally: Rally) {
    const next = (rally.score_away ?? 0) + 1
    updateLocalRally(rally.id, { score_away: next })
    await patchRally(rally.id, { score_away: next })
  }

  async function handleTimestampBlur(rally: Rally, field: 'start_time' | 'end_time', value: string) {
    const num = parseFloat(value)
    if (isNaN(num) || num === rally[field]) return
    updateLocalRally(rally.id, { [field]: num })
    await patchRally(rally.id, { [field]: num })
  }

  const activeVideo = sets.find(s => s.video.id === activeRally?.videoId)?.video ?? sets[0]?.video

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link to="/" className="text-sm text-blue-600 hover:underline">← Back</Link>
      {match && (
        <h1 className="text-2xl font-bold mt-1 mb-4">
          {match.date}{match.opponent ? ` vs ${match.opponent}` : ''}
        </h1>
      )}

      {activeVideo && (
        <div className="mb-6">
          <video
            ref={videoRef}
            src={`${BACKEND}/uploads/${activeVideo.raw_path.split('/').pop()}`}
            controls
            className="w-full max-h-64 bg-black rounded"
          />
        </div>
      )}

      {sets.map(({ video, rallies }) => (
        <div key={video.id} className="mb-6">
          <h2 className="font-semibold text-lg mb-2">Set {video.set_number}</h2>
          {rallies.length === 0 ? (
            <p className="text-gray-500 text-sm">No rallies detected yet. Process the video first.</p>
          ) : (
            <ul className="space-y-2">
              {rallies.map(r => {
                const isActive = activeRally?.rallyId === r.id
                return (
                  <li
                    key={r.id}
                    className={`border rounded-lg p-3 bg-white cursor-pointer ${isActive ? 'ring-2 ring-blue-500' : 'hover:border-blue-300'}`}
                    onClick={() => selectRally(video.id, r)}
                  >
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex items-center gap-1 text-sm text-gray-600">
                        <input
                          type="number"
                          step="0.1"
                          defaultValue={r.start_time}
                          onBlur={e => handleTimestampBlur(r, 'start_time', e.target.value)}
                          onClick={e => e.stopPropagation()}
                          className="w-20 border rounded px-1 py-0.5 text-xs"
                          aria-label="start time"
                        />
                        <span>–</span>
                        <input
                          type="number"
                          step="0.1"
                          defaultValue={r.end_time}
                          onBlur={e => handleTimestampBlur(r, 'end_time', e.target.value)}
                          onClick={e => e.stopPropagation()}
                          className="w-20 border rounded px-1 py-0.5 text-xs"
                          aria-label="end time"
                        />
                        <span className="ml-1 text-gray-400">s</span>
                      </div>
                      <div className="flex gap-2 ml-auto">
                        <button
                          onClick={e => { e.stopPropagation(); scoreHome(r) }}
                          className="bg-green-100 hover:bg-green-200 text-green-800 px-3 py-1 rounded text-xs font-medium"
                        >
                          Home Scored {r.score_home != null ? `(${r.score_home})` : ''}
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); scoreAway(r) }}
                          className="bg-orange-100 hover:bg-orange-200 text-orange-800 px-3 py-1 rounded text-xs font-medium"
                        >
                          Away Scored {r.score_away != null ? `(${r.score_away})` : ''}
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ))}

      <div className="mt-4">
        <Link to={`/matches/${matchId}/export`} className="text-blue-600 hover:underline text-sm">
          Go to Export →
        </Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
cd /home/leew4/volleyball-cv/frontend
npm test
```

Expected: all `PASSED`

- [ ] **Step 5: Commit**

```bash
cd /home/leew4/volleyball-cv
git add frontend/src/views/RallyReview.tsx frontend/src/test/RallyReview.test.tsx
git commit -m "feat: Rally Review view — rally list, video preview, score buttons, timestamp editing"
```

---

### Task 8: Export + Download view

**Files:**
- Modify: `frontend/src/views/ExportUpload.tsx`
- Create: `frontend/src/test/ExportUpload.test.tsx`

The Export view triggers `POST /matches/{id}/export` which runs ffmpeg on all sets and returns a list of ProcessedVideo records. Each result shows a download link pointing to `/exports/<filename>` on the backend's static file server.

- [ ] **Step 1: Write failing tests**

```typescript
// frontend/src/test/ExportUpload.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import ExportUpload from '../views/ExportUpload'
import type { Match, ProcessedVideo } from '../types'

vi.mock('../api/client')

const MATCH: Match = { id: 1, date: '2026-05-18', opponent: 'Team A', venue: null, notes: null, created_at: '' }
const PV: ProcessedVideo = {
  id: 3,
  match_id: 1,
  output_path: '/data/exports/export_match1_set1.mp4',
  created_at: '',
}

function renderWithRoute(matchId = '1') {
  return render(
    <MemoryRouter initialEntries={[`/matches/${matchId}/export`]}>
      <Routes>
        <Route path="/matches/:matchId/export" element={<ExportUpload />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ExportUpload', () => {
  beforeEach(() => {
    vi.mocked(api.getMatch).mockResolvedValue(MATCH)
    vi.mocked(api.exportMatch).mockResolvedValue([PV])
  })

  it('shows match title and export button', async () => {
    renderWithRoute()
    await screen.findByText('2026-05-18')
    expect(screen.getByRole('button', { name: /generate export/i })).toBeInTheDocument()
  })

  it('clicking Generate Export calls exportMatch and shows download link', async () => {
    const user = userEvent.setup()
    renderWithRoute()
    await screen.findByText('2026-05-18')
    await user.click(screen.getByRole('button', { name: /generate export/i }))
    await waitFor(() => expect(api.exportMatch).toHaveBeenCalledWith(1))
    await screen.findByRole('link', { name: /download/i })
  })

  it('download link points to backend export file', async () => {
    const user = userEvent.setup()
    renderWithRoute()
    await screen.findByText('2026-05-18')
    await user.click(screen.getByRole('button', { name: /generate export/i }))
    const link = await screen.findByRole('link', { name: /download/i })
    expect(link).toHaveAttribute('href', expect.stringContaining('export_match1_set1.mp4'))
  })

  it('shows exporting state while request is in flight', async () => {
    vi.mocked(api.exportMatch).mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    renderWithRoute()
    await screen.findByText('2026-05-18')
    await user.click(screen.getByRole('button', { name: /generate export/i }))
    expect(screen.getByRole('button', { name: /exporting/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /home/leew4/volleyball-cv/frontend
npm test
```

Expected: `FAIL`

- [ ] **Step 3: Replace frontend/src/views/ExportUpload.tsx**

```typescript
// frontend/src/views/ExportUpload.tsx
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { exportMatch, getMatch } from '../api/client'
import type { Match, ProcessedVideo } from '../types'

const BACKEND = 'http://localhost:8000'

export default function ExportUpload() {
  const { matchId } = useParams<{ matchId: string }>()
  const [match, setMatch] = useState<Match | null>(null)
  const [exporting, setExporting] = useState(false)
  const [results, setResults] = useState<ProcessedVideo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getMatch(Number(matchId)).then(setMatch)
  }, [matchId])

  async function handleExport() {
    setExporting(true)
    setError(null)
    try {
      const pvs = await exportMatch(Number(matchId))
      setResults(pvs)
    } catch (err) {
      setError(String(err))
    } finally {
      setExporting(false)
    }
  }

  function downloadUrl(pv: ProcessedVideo): string {
    const filename = pv.output_path.split('/').pop()!
    return `${BACKEND}/exports/${filename}`
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Link to="/" className="text-sm text-blue-600 hover:underline">← Back</Link>
      {match && (
        <h1 className="text-2xl font-bold mt-1 mb-6">
          Export — {match.date}{match.opponent ? ` vs ${match.opponent}` : ''}
        </h1>
      )}

      <p className="text-sm text-gray-600 mb-4">
        Generates a trimmed MP4 per set using the current rally timestamps.
        Previously exported files are replaced.
      </p>

      <button
        onClick={handleExport}
        disabled={exporting}
        className="bg-blue-600 text-white px-5 py-2 rounded font-medium disabled:opacity-50 hover:bg-blue-700"
      >
        {exporting ? 'Exporting…' : 'Generate Export'}
      </button>

      {error && <p className="mt-4 text-red-600 text-sm">Error: {error}</p>}

      {results !== null && (
        <div className="mt-6">
          {results.length === 0 ? (
            <p className="text-gray-500 text-sm">No sets with rallies found. Process videos and assign rallies first.</p>
          ) : (
            <ul className="space-y-2">
              {results.map(pv => (
                <li key={pv.id} className="border rounded-lg p-3 bg-white flex justify-between items-center">
                  <span className="text-sm text-gray-700">{pv.output_path.split('/').pop()}</span>
                  <a
                    href={downloadUrl(pv)}
                    download
                    className="text-blue-600 hover:underline text-sm font-medium"
                  >
                    Download
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
cd /home/leew4/volleyball-cv/frontend
npm test
```

Expected: all `PASSED`

- [ ] **Step 5: Commit**

```bash
cd /home/leew4/volleyball-cv
git add frontend/src/views/ExportUpload.tsx frontend/src/test/ExportUpload.test.tsx
git commit -m "feat: Export view — generate trimmed MP4, download links"
```

---

### Task 9: Add frontend to docker-compose and browser smoke test

**Files:**
- Create: `frontend/Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Create frontend/Dockerfile**

```dockerfile
# frontend/Dockerfile
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

- [ ] **Step 2: Create frontend/nginx.conf**

```nginx
# frontend/nginx.conf
server {
    listen 80;

    root /usr/share/nginx/html;
    index index.html;

    # SPA fallback — all paths serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API calls to backend
    location /api/ {
        proxy_pass http://backend:8000/;
        proxy_set_header Host $host;
    }
}
```

- [ ] **Step 3: Update docker-compose.yml**

```yaml
# docker-compose.yml
version: '3.9'
services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data
    environment:
      - DATA_DIR=/app/data
      - DATABASE_URL=sqlite:////app/data/volleyball_cv.db

  frontend:
    build: ./frontend
    ports:
      - "3000:80"
    depends_on:
      - backend
```

- [ ] **Step 4: Run the full test suite one more time**

```bash
cd /home/leew4/volleyball-cv/frontend
npm test
```

Expected: all tests `PASSED`

- [ ] **Step 5: Start the backend and Vite dev server for a browser smoke test**

In one terminal:
```bash
cd /home/leew4/volleyball-cv
PATH="/home/leew4/bin:$PATH" PYTHONPATH=backend python3.12 -m uvicorn backend.main:app --port 8000 --reload
```

In a second terminal:
```bash
cd /home/leew4/volleyball-cv/frontend
npm run dev
```

Open http://localhost:5173 in a browser and verify:
- Sidebar shows "Matches" and "Active Learning"
- Create a match (enter a date, click "New Match") → navigates to Upload view
- Upload view shows 3 set panels, each with file input and disabled Upload button
- Navigate back, click Rally Review → shows message "No rallies detected yet"
- Navigate to Active Learning → shows the Plan 3 placeholder message
- Navigate to Export → shows "Generate Export" button

Kill both servers with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
cd /home/leew4/volleyball-cv
git add frontend/Dockerfile frontend/nginx.conf docker-compose.yml
git commit -m "feat: Docker frontend service + nginx SPA config — Plan 2 complete"
```

---

## Remaining Plans

- **Plan 3:** Active Learning + Tier 2 YOLOv8 fine-tuning pipeline
- **Plan 4:** YouTube OAuth2 + upload integration
