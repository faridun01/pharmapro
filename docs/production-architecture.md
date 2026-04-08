# PharmaPro Desktop + PostgreSQL Architecture

## 1) Target runtime model

PharmaPro should run as a desktop-first system with three explicit runtime layers:

1. Electron shell
2. Local backend process
3. PostgreSQL database

Electron is responsible only for window lifecycle, safe native integrations, preload APIs, updates, and app packaging.

The backend process is responsible for:

- authentication and session management
- all business rules
- inventory consistency
- audit trail writes
- OCR orchestration
- report aggregation
- database transactions

The React renderer is responsible only for:

- rendering UI
- collecting user input
- calling backend use cases
- optimistic UX where safe
- local view state

The renderer must not be the source of truth for inventory, invoices, returns, or stock movements.

## 2) Recommended desktop topology

### Preferred production topology

- Electron main process starts the backend process on app launch
- Backend listens on `127.0.0.1` only
- Electron renderer talks to backend through HTTP on localhost for business APIs
- Sensitive native capabilities go through `preload.ts` and IPC
- PostgreSQL runs as the primary database

### Why PostgreSQL instead of SQLite here

PostgreSQL is a better fit for your target product because the domain is no longer a small single-table offline app:

- many relational workflows already exist in schema
- audit logging matters
- transactional integrity matters
- reports and aggregates will grow
- multi-warehouse flows are easier to model and validate
- future sync or remote deployment becomes much easier

If you still want a pure single-PC install, PostgreSQL can be bundled locally or deployed on a LAN server.

## 3) Main architectural correction

Today the project has a good folder direction, but the most important use cases are still split across UI and routes.

The corrected rule is:

- UI sends intent
- backend service executes the full use case
- repository layer reads and writes data
- transaction boundaries live only on the backend

Example:

- `Complete sale`
- bad: renderer reduces batch quantities, updates product, then creates invoice
- good: renderer sends sale command, backend service validates stock, applies FEFO, writes movements, writes invoice, writes audit, commits once

## 4) Required folder structure

```txt
src/
  desktop/
    main/
      main.cjs
      preload.cjs
      window.cjs
      backend-process.cjs
      paths.cjs
  renderer/
    app/
    pages/
    widgets/
    features/
    shared/
      api/
      ui/
      lib/
      hooks/
  server/
    app/
      createApp.ts
      registerRoutes.ts
      serviceRegistry.ts
    common/
      auth/
      errors/
      http/
      validation/
      security/
      config/
    modules/
      auth/
        auth.controller.ts
        auth.routes.ts
        auth.service.ts
        auth.repository.ts
        auth.schemas.ts
      products/
      inventory/
      batches/
      invoices/
      sales/
      returns/
      writeoffs/
      suppliers/
      warehouses/
      shifts/
      reports/
      notifications/
      ocr/
      settings/
      audit/
      backup/
    infrastructure/
      prisma/
        client.ts
        transaction.ts
      postgres/
        migrations/
      logging/
```

## 5) Boundaries by layer

### Electron main

Allowed:

- create windows
- manage tray/menu
- start and stop backend
- expose preload bridge
- resolve app paths
- auto-update hooks
- open file picker

Not allowed:

- product logic
- auth fallback creation
- invoice creation
- direct DB writes

### Renderer

Allowed:

- forms
- local filters
- cached query state
- input validation for UX
- view models

Not allowed:

- stock mutation rules
- FEFO allocation
- write-off calculations
- invoice numbering
- trusted auth bypass

### Backend

Allowed:

- every business rule
- role and permission checks
- transaction orchestration
- audit writes
- consistency checks

## 6) Security model for desktop

Your current Electron security posture should be changed before treating the app as production-ready.

### Required settings

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true` where possible
- preload bridge for explicit desktop APIs
- CSP for renderer bundle

### Authentication model

Do not use a production desktop fallback that auto-creates an admin user.

Instead:

- user logs in normally through backend
- backend returns session token or signed local session cookie
- renderer stores only what is needed
- every privileged action is checked on backend

If you want desktop convenience:

- allow bootstrap admin creation only on first-run setup screen
- disable bootstrap path after first successful owner/admin creation

## 7) PostgreSQL database strategy

### Prisma datasource

Use PostgreSQL as the primary datasource:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### Recommended database deployment modes

1. Local PostgreSQL on the same machine
2. PostgreSQL on pharmacy local network server
3. Managed PostgreSQL for centralized deployments

For your product, I would optimize for mode 2:

- one PostgreSQL instance in the pharmacy or company network
- multiple desktop clients connect to it
- Electron remains the desktop shell
- backend remains per-client or becomes a shared service later

### Why this is a better long-term choice

- supports multiple workstations
- safer than single-file DB when operations grow
- better backup tooling
- better locking and concurrency
- easier reporting
- easier role separation and future integrations

## 8) Module design standard

Each module should follow one predictable shape:

```txt
module/
  module.routes.ts
  module.controller.ts
  module.service.ts
  module.repository.ts
  module.schemas.ts
  module.types.ts
```

Rules:

- routes wire HTTP only
- controller parses request and response DTOs
- service contains business use cases
- repository contains Prisma queries
- validation schemas live near module entry

## 9) First server-side use cases to extract

These should be moved first because they protect data integrity:

1. `completeSale`
2. `createCustomerReturn`
3. `createSupplierReturn`
4. `createWriteOff`
5. `restockFromInvoice`
6. `openShift`
7. `closeShift`

### Example: `completeSale`

The service should do all of this in one transaction:

- validate cashier and shift
- validate products and requested quantities
- load eligible batches
- apply FEFO
- decrement batch quantities
- update product totals
- create invoice
- create invoice items
- create batch movements
- create cash movements if needed
- create audit log
- return final receipt DTO

The renderer should only call:

- `POST /api/sales/complete`

## 10) Repository rules

Repositories should not contain UI terms and should not return raw Prisma payloads blindly.

Repository responsibilities:

- fetch exact relations needed by service
- map DB records into service-level objects
- hide Prisma-specific details from upper layers

This will make refactors safer when report logic or table structure changes.

## 11) State management in renderer

The current context-based approach is fine for a small app, but for your domain it should evolve into feature-oriented query state.

Recommended renderer pattern:

- `auth`
- `products`
- `sales`
- `invoices`
- `returns`
- `suppliers`
- `reports`

Each feature should own:

- api client functions
- hooks
- DTO types
- UI state

Avoid storing service singletons inside React context when those services are actually backend use cases.

## 12) API contract style

Use command-style endpoints for workflows and CRUD-style endpoints for reference data.

Examples:

- `POST /api/sales/complete`
- `POST /api/returns/customer`
- `POST /api/writeoffs`
- `POST /api/inventory/restock`
- `POST /api/shifts/open`
- `POST /api/shifts/close`
- `GET /api/products`
- `GET /api/suppliers`

This is better than forcing complex workflows through generic product update endpoints.

## 13) Audit and compliance model

Every critical mutation should write audit data inside the same transaction.

Audit record should include:

- user id
- user role
- module
- action
- entity
- entity id
- old value
- new value
- reason
- created at

Do not write audit after commit for critical flows if it can be avoided.

## 14) Desktop-specific operational requirements

### App paths

Do not store durable app data in OS temp directories.

Use:

- Electron `app.getPath('userData')` for logs, config, temp exports, local caches

### Logging

Have separate logs for:

- Electron main
- backend
- OCR worker

### Backups

For PostgreSQL:

- scheduled `pg_dump`
- restore verification command
- backup metadata table
- admin restore flow with confirmation

## 15) Migration plan from current code

### Phase 1: Secure desktop shell

- disable `nodeIntegration`
- enable `contextIsolation`
- add preload bridge
- remove trusted production auth fallback
- move user data out of temp path

### Phase 2: Move business logic to backend

- create `sales.service.ts`
- move FEFO and stock mutation there
- expose `POST /api/sales/complete`
- make renderer stop mutating stock directly

### Phase 3: Standardize modules

- split route logic into controller/service/repository
- add DTO validation
- centralize permission checks

### Phase 4: Switch database to PostgreSQL

- update Prisma datasource
- create first migration
- move local dev data if needed
- add backup strategy

### Phase 5: Prepare multi-workstation mode

- externalize backend config
- support LAN PostgreSQL connection
- add connection diagnostics and health UI

## 16) Final recommendation

For your product, the best target architecture is:

- Electron for shell only
- React for UI only
- Node/Express backend for all domain logic
- Prisma for data access
- PostgreSQL as primary database

That architecture is strong for desktop, scales better than your current shape, and still lets you keep the product local-first.

If you want the shortest safe path, do these three changes first:

1. secure Electron
2. move sale/stock workflows to backend
3. switch Prisma from SQLite to PostgreSQL
