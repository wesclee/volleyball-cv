# Upload Progress Design

**Date:** 2026-05-19  
**Status:** Approved

---

## Overview

The upload phase in `UploadProcess.tsx` currently shows a static "Uploading…" text with no progress indicator. This change adds real upload progress using `XMLHttpRequest`'s `upload.onprogress` event, displayed as a separate progress bar that completes before the processing bar takes over.

---

## Changes

### `frontend/src/api/client.ts` — `uploadVideo`

Add an optional `onProgress?: (pct: number) => void` parameter. Replace the `fetch` call for this function with `XMLHttpRequest`:

```typescript
export function uploadVideo(
  matchId: number,
  setNumber: number,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<Video>
```

Implementation:
- Build `FormData` exactly as before (`set_number`, `file`)
- Create `XMLHttpRequest`, open `POST` to `/matches/${matchId}/videos`
- Wire `xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total * 100) }`
- Resolve on `xhr.onload` (parse JSON response, reject on non-2xx)
- Reject on `xhr.onerror`

All other functions in `client.ts` keep using the `fetch`-based `request()` helper.

### `frontend/src/views/UploadProcess.tsx` — two-phase progress bar

`handleProcess` passes a progress callback to `uploadVideo`:

```typescript
const video = await uploadVideo(Number(matchId), setNumber, s.file, pct =>
  setSetField(setNumber, 'progress', pct)
)
```

When upload completes, reset progress to 0 before switching to `processing`:

```typescript
setSetField(setNumber, 'progress', 0)
setSetField(setNumber, 'status', 'processing')
```

The progress bar UI is extended to also render during `uploading`:

- `uploading`: blue bar, label "Uploading… X%"
- `processing`: blue bar, label "Processing… X%" (unchanged)
- `done`: green bar, label "✓ Done" (unchanged)

The bar component condition changes from `status === 'processing' || status === 'done'` to include `status === 'uploading'`.

No new state fields. `progress` is already 0 at start and already drives the bar.

---

## Testing

### Frontend

- **`UploadProcess.test.tsx`** (modify) — add a test that mocks `uploadVideo` to call `onProgress(50)` mid-upload and verifies the upload bar renders at 50%; add a test that progress resets to 0 when transitioning to processing.

### API client

- **`api.test.ts`** (modify) — add a test that `uploadVideo` calls `XMLHttpRequest` and fires `onProgress` with the correct percentage when `upload.onprogress` fires; verify it resolves with the parsed response body.

---

## What Does Not Change

- All other API functions (`processVideo`, `getJob`, etc.)
- Processing progress polling logic
- Backend
- Any other views
