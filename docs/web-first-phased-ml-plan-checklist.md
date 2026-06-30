# Web-First Domino ML Plan — Operator Checklist (Execution Runbook)

**Date:** 2026-06-29  
**Companion doc:** `docs/web-first-phased-ml-plan.md`  
**Scope:** Execute Phase 1 (web-only) with strict focus on tile detection + pip reading.  
**Rule:** No native mobile app work until Phase 1 acceptance gates pass.

---

## 0) Operating Rules (Must Hold)

- [ ] Web app only (mobile-first in browser)
- [ ] No paid AI API usage
- [ ] Keep stack minimal and low-cost
- [ ] Prioritize model/data quality over framework expansion
- [ ] Do not start native app tasks before lock criteria pass twice consecutively

---

## 1) Repo Setup Checklist

## 1.1 Directory structure
- [ ] Create top-level app directories:
  - [ ] `web/` (React + TS + Vite)
  - [ ] `api/` (FastAPI inference service)
  - [ ] `ml/` (training + exports + datasets metadata)
  - [ ] `docs/` (plans, reports)
- [ ] Add root `README.md` with setup steps
- [ ] Add `.gitignore` covering Python envs, node_modules, model artifacts, temp images

## 1.2 Environment files
- [ ] Add `.env.example` for `web/`
- [ ] Add `.env.example` for `api/`
- [ ] Define required variables clearly (host URLs, optional auth key, model path)

---

## 2) Web App Execution Checklist (React + TS + Vite)

## 2.1 Bootstrap
- [ ] Initialize React + TS + Vite app in `web/`
- [ ] Confirm local run command works
- [ ] Add basic mobile-first layout shell

## 2.2 MVP UI (must-have only)
- [ ] File upload input
- [ ] Camera capture path (if available in browser)
- [ ] Preview selected image
- [ ] “Analyze” action button
- [ ] Results panel for detected tiles
- [ ] Error and retry states

## 2.3 Overlay rendering
- [ ] Render image in canvas or container with known dimensions
- [ ] Draw returned bounding boxes
- [ ] Draw value labels (`left|right`) near each bbox
- [ ] Handle empty detections gracefully

## 2.4 UX quality bar
- [ ] Touch-friendly controls
- [ ] Clear loading indicator while inferencing
- [ ] Confidence warning message for low-confidence scans
- [ ] Retake/try-again flow is obvious

---

## 3) API Service Checklist (FastAPI)

## 3.1 Bootstrap
- [ ] Create FastAPI app in `api/`
- [ ] Add health endpoint `GET /health`
- [ ] Add inference endpoint `POST /infer` (stub first)
- [ ] Add CORS settings for web app origin(s)

## 3.2 Inference contract
- [ ] `POST /infer` accepts image file upload
- [ ] Returns JSON with:
  - [ ] `tiles[].bbox`
  - [ ] `tiles[].value`
  - [ ] `tiles[].confidence`
  - [ ] `latency_ms`
- [ ] Validate malformed inputs with clean error responses

## 3.3 Runtime concerns
- [ ] Add request size limit (protect from huge uploads)
- [ ] Add basic timeout handling
- [ ] Add minimal structured logs (request id, latency, tile count)

---

## 4) Model Pipeline Checklist (YOLOv8n Baseline First)

## 4.1 Dataset prep
- [ ] Define annotation schema for baseline
- [ ] Collect initial diverse sample set (lighting, angle, surfaces)
- [ ] Split into train/val/test with fixed seed
- [ ] Document dataset version in `ml/`

## 4.2 Baseline training
- [ ] Train YOLOv8n baseline detector
- [ ] Save model artifact with version tag
- [ ] Record training config/hyperparameters
- [ ] Record validation metrics

## 4.3 Baseline inference integration
- [ ] Load baseline model in API
- [ ] Run detector on uploaded images
- [ ] Return tile bboxes and confidence
- [ ] Verify with manual samples from phone photos

---

## 5) Pip/Value Reading Checklist

## 5.1 Reader implementation
- [ ] Implement initial value-reading stage
- [ ] Integrate with detector outputs
- [ ] Return predicted tile values in API response

## 5.2 Orientation and confidence handling
- [ ] Add orientation-safe handling where needed
- [ ] Ensure confidence surfaced to frontend
- [ ] Flag uncertain reads for retry guidance

## 5.3 Validation
- [ ] Build test subset specifically for reading accuracy
- [ ] Measure exact tile read accuracy
- [ ] Log frequent error patterns (e.g., glare, blur, overlap)

---

## 6) Evaluation & Metrics Checklist

## 6.1 Required metrics
- [ ] Tile detection recall
- [ ] Tile detection precision
- [ ] Exact tile-read accuracy
- [ ] Latency (p50, optionally p95)

## 6.2 Scenario slices
- [ ] Low light
- [ ] Glare/reflections
- [ ] Angle/perspective distortion
- [ ] Partial overlap/clutter

## 6.3 Reporting format
- [ ] Maintain a versioned evaluation report per model revision
- [ ] Include:
  - [ ] model version
  - [ ] dataset version
  - [ ] metric table
  - [ ] pass/fail vs gate thresholds
  - [ ] observed failure modes

---

## 7) Acceptance Gate Checklist (Must Pass Twice Consecutively)

- [ ] Detection recall >= 95%
- [ ] Exact tile-read accuracy >= agreed threshold (target 90–95%)
- [ ] Median end-to-end latency <= 500 ms/photo (deployed environment)
- [ ] Stable behavior across required scenario slices
- [ ] Run #1 passes all gates
- [ ] Run #2 passes all gates (consecutive)

**If any fail:** remain in Phase 1 and continue iteration loop.

---

## 8) Iteration Loop Checklist (When Gates Fail)

- [ ] Collect new hard-case examples from real usage
- [ ] Label and add to training set
- [ ] Retrain and version model
- [ ] Re-run full evaluation suite
- [ ] Compare with previous version (no blind promotion)
- [ ] Promote only if net improvement and no major regressions

---

## 9) Deployment Checklist (Low-Cost First)

## 9.1 Web
- [ ] Deploy `web/` to free/static host
- [ ] Confirm mobile browser functionality in production URL

## 9.2 API
- [ ] Deploy `api/` to low-cost container host
- [ ] Configure environment variables
- [ ] Confirm `/health` and `/infer` in deployed environment

## 9.3 Cost controls
- [ ] Enforce input resize/compression policy
- [ ] Use CPU inference initially
- [ ] Monitor request volume and latency before upgrading infra

---

## 10) Operational Readiness Checklist

- [ ] Add simple runbook: start, deploy, rollback
- [ ] Add known-issues section for common failure cases
- [ ] Add troubleshooting steps for camera permissions and upload errors
- [ ] Define who approves model promotion to production

---

## 11) Stop/No-Go Conditions

If any of these occur, pause new feature work and stabilize:
- [ ] Repeated production inference failures
- [ ] Significant regression in detection or reading accuracy
- [ ] Latency exceeds acceptable threshold for majority of users
- [ ] Scope creep into native app before gate pass

---

## 12) Native App Deferral Check (Explicit)

Before creating any native-app issue/task, confirm all are true:
- [ ] Two consecutive acceptance runs passed
- [ ] Web app is stable for target usage
- [ ] Model performance is consistent in real-world samples
- [ ] Team agrees ROI justifies native phase start

If any unchecked: **native app remains out of scope**.
