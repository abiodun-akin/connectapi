#!/usr/bin/env bash

# Connect API — README

# Connect API

A small Node.js + Express backend that provides authentication and resource CRUD patterns, intended as the server component for other apps or demos. The project uses MongoDB (Mongoose) for persistence and supports cookie-based JWT authentication.

---

## Quick Links

- Project root: `index.js`
- Auth routes: mounted at `/api/auth` (signup, login, logout)
- Middleware: `middleware/` contains request helpers

---

## Getting started

Prerequisites:

- Node.js 18+ or a compatible LTS
- MongoDB instance (local or remote)

Install and run:

```powershell
git clone https://github.com/abiodun-akin/connectapi.git
cd connectapi
npm install
```

Create a `.env` with at minimum:

```
PORT=3000
CONN_STR=mongodb://localhost:27017/connectapi
TOKEN_SECRET=your_jwt_secret
FRONTEND_ORIGIN=http://localhost:5173
```

Start in development:

```powershell
npm run dev
```

Or with Docker Compose (if you want the bundled MongoDB):

```powershell
docker compose up -d
```

---

## Authentication endpoints (examples)

The auth router (`routes/auth.js`) exposes these endpoints under `/api/auth`:

- `POST /api/auth/signup` — create a new user (name, email, password)
- `POST /api/auth/login` — authenticate and receive a cookie-based JWT (email, password)
- `POST /api/auth/logout` — clear the authentication cookie

Requests and responses follow JSON conventions; the server sets an `httpOnly` cookie named `jwt` on successful login/signup.

---

## Project structure

```
connectapi/
├── index.js                # App entry (server setup, routes)
├── package.json
├── Dockerfile
├── docker-compose.yml      # optional local MongoDB service
├── db.js                   # mongo connection helper
├── user.js                 # user model + auth helpers
├── routes/
│   └── auth.js             # signup/login/logout
├── middleware/
│   ├── requireAuth.js      # protects routes
│   └── getreport.js        # (left in codebase) resource lookup helper
├── mongo_data/             # local MongoDB data (if used with compose)
└── README.md
```

---

## Notes

- The app uses cookie-based JWTs for authentication. Tokens are signed with `TOKEN_SECRET` from `.env`.
- Adjust `FRONTEND_ORIGIN` in `.env` to match your frontend host for CORS.

---

If you'd like, I can also:

- Remove or rename any remaining files that reference the previous 'report' resource (e.g. `report.js`, `middleware/getreport.js`) and update the server accordingly.
- Commit and push the new README for you.
