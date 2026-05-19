# Upload Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a real upload progress bar while a video file is being sent to the server, so the user knows how long the upload will take.

**Architecture:** `uploadVideo` in `client.ts` is rewritten to use `XMLHttpRequest` (which exposes `upload.onprogress`) instead of `fetch`. It gains an optional `onProgress` callback. `UploadProcess.tsx` passes the callback and shows the existing progress bar during the upload phase, then resets and continues showing it during processing.

**Tech Stack:** React 18, TypeScript, Vitest, @testing-library/react, XMLHttpRequest (browser built-in).

---

## File Map

| Action | Path | Change |
|--------|------|--------|
| Modify | `frontend/src/api/client.ts` | Rewrite `uploadVideo` to use XHR with `onProgress` callback |
| Modify | `frontend/src/test/api.test.ts` | Add 3 tests for `uploadVideo` XHR behaviour |
| Modify | `frontend/src/views/UploadProcess.tsx` | Pass progress callback; show bar + label during upload; reset on transition |
| Modify | `frontend/src/test/UploadProcess.test.tsx` | Add tests for upload progress bar and reset |

---

## Task 1: XHR-based uploadVideo with onProgress

**Files:**
- Modify: `frontend/src/api/client.ts` (the `uploadVideo` function, lines ~37–42)
- Modify: `frontend/src/test/api.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `frontend/src/test/api.test.ts`. First add `uploadVideo` to the existing import at the top of the file:

```typescript
import { getMatches, createMatch, getMatchVideos, getRallies, patchRally, exportMatch, getLabelingStatus, getLabelingQueue, uploadVideo } from '../api/client'
```

Then add a new `describe` block after the existing tests (inside the outer `describe('API client', ...)` block):

```typescript
describe('uploadVideo', () => {
  const mockVideo = {
    id: 10, match_id: 1, set_number: 1, raw_path: '/x.mp4',
    status: 'pending', duration: null, created_at: '',
  }

  let mockXhr: {
    open: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
    upload: { onprogress?: (e: Partial<ProgressEvent>) => void }
    onload?: () => void
    onerror?: () => void
    status: number
    responseText: string
  }

  beforeEach(() => {
    mockXhr = {
      open: vi.fn(),
      send: vi.fn(),
      upload: {},
      status: 200,
      responseText: JSON.stringify(mockVideo),
    }
    vi.stubGlobal('XMLHttpRequest', vi.fn(() => mockXhr))
  })

  it('sends POST to /matches/{id}/videos and resolves with video', async () => {
    const promise = uploadVideo(1, 1, new File([''], 'test.mp4'))
    mockXhr.onload?.()
    const result = await promise
    expect(mockXhr.open).toHaveBeenCalledWith('POST', 'http://localhost:8000/matches/1/videos')
    expect(mockXhr.send).toHaveBeenCalled()
    expect(result.id).toBe(10)
  })

  it('calls onProgress with correct percentage during upload', async () => {
    const onProgress = vi.fn()
    const promise = uploadVideo(1, 1, new File([''], 'test.mp4'), onProgress)
    mockXhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent)
    mockXhr.onload?.()
    await promise
    expect(onProgress).toHaveBeenCalledWith(50)
  })

  it('rejects on non-2xx status', async () => {
    mockXhr.status = 422
    mockXhr.responseText = 'Unprocessable Entity'
    const promise = uploadVideo(1, 1, new File([''], 'test.mp4'))
    mockXhr.onload?.()
    await expect(promise).rejects.toThrow('422')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/leew4/volleyball-cv/frontend
npm test -- --run src/test/api.test.ts 2>&1 | tail -15
```

Expected: the 3 new `uploadVideo` tests FAIL (XHR not used yet, `onProgress` param doesn't exist).

- [ ] **Step 3: Rewrite uploadVideo in client.ts**

Replace the current `uploadVideo` function (the one that calls `return request(...)`) with:

```typescript
export function uploadVideo(
  matchId: number,
  setNumber: number,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<Video> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('set_number', String(setNumber))
    form.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/matches/${matchId}/videos`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total * 100)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText) as Video)
      } else {
        reject(new Error(`${xhr.status} ${xhr.responseText}`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.send(form)
  })
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /home/leew4/volleyball-cv/frontend
npm test -- --run src/test/api.test.ts 2>&1 | tail -10
```

Expected: all tests in `api.test.ts` pass (existing + 3 new).

- [ ] **Step 5: Run full frontend suite**

```bash
cd /home/leew4/volleyball-cv/frontend
npm test -- --run 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /home/leew4/volleyball-cv
git add frontend/src/api/client.ts frontend/src/test/api.test.ts
git commit -m "feat: rewrite uploadVideo to use XHR with onProgress callback"
```

---

## Task 2: Upload progress bar in UploadProcess

**Files:**
- Modify: `frontend/src/views/UploadProcess.tsx`
- Modify: `frontend/src/test/UploadProcess.test.tsx`

- [ ] **Step 1: Write failing tests**

Add two tests to `frontend/src/test/UploadProcess.test.tsx`, inside the existing `describe('UploadProcess', ...)` block, after the existing tests:

```typescript
it('shows upload progress bar with percentage during upload', async () => {
  let resolveUpload!: (v: typeof VIDEO) => void
  vi.mocked(api.uploadVideo).mockImplementation((_mid, _sn, _file, onProgress) => {
    onProgress?.(60)
    return new Promise(res => { resolveUpload = res })
  })

  const user = userEvent.setup()
  renderWithRoute()
  await screen.findByText(/2026-05-18/)

  const file = new File(['video'], 'set1.mp4', { type: 'video/mp4' })
  await user.upload(screen.getAllByLabelText(/set [123]/i)[0], file)
  await user.click(screen.getAllByRole('button', { name: /upload/i })[0])

  await waitFor(() => {
    expect(screen.getByText(/Uploading… 60%/i)).toBeInTheDocument()
  })

  resolveUpload(VIDEO)
})

it('shows processing bar after upload completes', async () => {
  const user = userEvent.setup()
  renderWithRoute()
  await screen.findByText(/2026-05-18/)

  const file = new File(['video'], 'set1.mp4', { type: 'video/mp4' })
  await user.upload(screen.getAllByLabelText(/set [123]/i)[0], file)
  await user.click(screen.getAllByRole('button', { name: /upload/i })[0])

  await waitFor(() => {
    expect(screen.getByText(/Processing…/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/leew4/volleyball-cv/frontend
npm test -- --run src/test/UploadProcess.test.tsx 2>&1 | tail -15
```

Expected: the 2 new tests FAIL — "Uploading… 60%" not found in DOM.

- [ ] **Step 3: Update handleProcess in UploadProcess.tsx**

In `frontend/src/views/UploadProcess.tsx`, find `handleProcess` and replace the `uploadVideo` call and the line after it with:

```typescript
const video = await uploadVideo(
  Number(matchId),
  setNumber,
  s.file,
  pct => setSetField(setNumber, 'progress', pct),
)
setSetField(setNumber, 'progress', 0)
setSetField(setNumber, 'status', 'processing')
```

The full updated `handleProcess` function:

```typescript
async function handleProcess(setNumber: 1 | 2 | 3) {
  const s = sets.find(s => s.setNumber === setNumber)!
  if (!s.file) return
  setSetField(setNumber, 'status', 'uploading')
  setSetField(setNumber, 'error', null)
  try {
    const video = await uploadVideo(
      Number(matchId),
      setNumber,
      s.file,
      pct => setSetField(setNumber, 'progress', pct),
    )
    setSetField(setNumber, 'progress', 0)
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
```

- [ ] **Step 4: Update the progress bar UI in UploadProcess.tsx**

Find the JSX section that renders the per-set card. Replace:

```tsx
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
```

With:

```tsx
{(s.status === 'uploading' || s.status === 'processing' || s.status === 'done') && (
  <div className="mt-3">
    <div className="h-2 bg-gray-200 rounded overflow-hidden">
      <div
        className={`h-full rounded transition-all duration-300 ${s.status === 'done' ? 'bg-green-500' : 'bg-blue-500'}`}
        style={{ width: `${s.progress}%` }}
      />
    </div>
    <p className="text-xs text-gray-500 mt-1">
      {s.status === 'done'
        ? '✓ Done'
        : s.status === 'uploading'
        ? `Uploading… ${Math.round(s.progress)}%`
        : `Processing… ${Math.round(s.progress)}%`}
    </p>
  </div>
)}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd /home/leew4/volleyball-cv/frontend
npm test -- --run src/test/UploadProcess.test.tsx 2>&1 | tail -10
```

Expected: all 5 UploadProcess tests pass.

- [ ] **Step 6: TypeScript check**

```bash
cd /home/leew4/volleyball-cv/frontend
npx tsc --noEmit 2>&1 | head -10
```

Expected: no errors.

- [ ] **Step 7: Run full suite**

```bash
cd /home/leew4/volleyball-cv/frontend
npm test -- --run 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
cd /home/leew4/volleyball-cv
git add frontend/src/views/UploadProcess.tsx frontend/src/test/UploadProcess.test.tsx
git commit -m "feat: show upload progress bar with percentage during file upload"
```
