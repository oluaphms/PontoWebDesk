# API Inventory (baseline P0.0)

## Mount canônico (VPS)

`app.use('/api', apiRouter)` — `backend/src/routes/apiRouter.ts`

| Router / inline | Path |
|-----------------|------|
| health | GET /api/health, /api/health/db, /api/health/time (+ readiness/liveness P0.4) |
| authRoutes | /api/auth |
| adminRoutes | /api/admin |
| employeeRoutes | /api/employees |
| attendanceRoutes | /api/attendance |
| punchRoutes | /api/punches |
| diagnostics | /api/diagnostics/rep |
| repRoutes | /api/rep |
| dataRoutes | /api/data/:table |
| uploadRoutes | /api/uploads |
| bankHoursRoutes | /api/bank-hours |
| root | GET /health (hint) |

## Vercel serverless (legado / dual-path)

`api/` — auth, admin, rep, jobs, operational, uploads, export, punch, employees, timesheet, health, reverse-geocode + `api/_shared/*`.

Piloto P0: path oficial = **LOCAL_API → Express VPS**.
