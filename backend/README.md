# India Chat Backend (Local Development Starter)

Node.js + Express + TypeScript + PostgreSQL + Prisma + Socket.IO backend scaffold based on the India-focused chat app MVP PRD.

## Included
- Express REST API with TypeScript
- PostgreSQL schema via Prisma
- Development OTP authentication (no SMS/email provider)
- JWT access and rotating refresh tokens
- User profile update/search, block and report
- Direct and group conversations
- Message send/history/edit/delete/read receipt
- Socket.IO authentication, conversation join and typing events
- Local file uploads (Multer)
- Health endpoint, validation, rate limiting, Helmet, centralized errors

## Not production-ready yet
This is a development foundation, not a production-ready secure messenger. End-to-end encryption is NOT implemented. Do not advertise E2EE or store sensitive plaintext in production. A mature, audited Signal Protocol implementation and independent security review are required. OTP is generated locally and returned only when `NODE_ENV=development` and `DEV_RETURN_OTP=true`; no real SMS/email is sent. Local uploads are public static files for development only. Add malware scanning, private access controls, signed download routes and storage abstraction before production. Admin authorization, FCM, Redis, multi-device key management, and full group-admin operations are not implemented.

## Requirements
- Node.js 20+ (Node 22 recommended)
- PostgreSQL 14+
- npm

## Setup (Windows PowerShell / macOS / Linux)

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a PostgreSQL database:
   ```sql
   CREATE DATABASE india_chat;
   ```

3. Copy `.env.example` to `.env`, then update `DATABASE_URL` with your local PostgreSQL password. Replace both JWT secrets with random values of at least 32 characters.
   - Keep `DEV_RETURN_OTP=true` only for local development.
   - Set `CLIENT_ORIGIN` to your frontend origin (for example `http://localhost:8081`).

4. Generate Prisma client and run the first migration:
   ```bash
   npx prisma generate
   npx prisma migrate dev --name init
   ```

5. Start the development server:
   ```bash
   npm run dev
   ```

6. Verify:
   ```text
   GET http://localhost:5000/api/health
   ```

## Useful commands
```bash
npm run dev
npm run typecheck
npm run build
npm run db:studio
```

## API overview

All API routes are prefixed with `/api`.

| Method | Endpoint | Auth | Purpose |
|---|---|---:|---|
| GET | `/health` | No | Health check |
| POST | `/auth/otp/request` | No | Generate dev OTP |
| POST | `/auth/otp/verify` | No | Verify OTP, create/login user |
| POST | `/auth/refresh` | No | Rotate refresh token |
| POST | `/auth/logout` | Yes | Revoke current session |
| GET | `/auth/me` | Yes | Current user |
| GET | `/users/search?q=...` | Yes | Search users |
| PATCH | `/users/me` | Yes | Update profile |
| POST | `/users/:userId/block` | Yes | Block user |
| DELETE | `/users/:userId/block` | Yes | Unblock user |
| POST | `/users/:userId/report` | Yes | Report user |
| GET | `/conversations` | Yes | List conversations |
| POST | `/conversations/direct` | Yes | Create/find direct conversation |
| POST | `/conversations/group` | Yes | Create group |
| GET | `/conversations/:id/members` | Yes | List members |
| GET | `/messages/conversation/:id` | Yes | Message history |
| POST | `/messages` | Yes | Send message |
| PATCH | `/messages/:id` | Yes | Edit own message |
| DELETE | `/messages/:id` | Yes | Delete own message |
| POST | `/messages/:id/read` | Yes | Mark message read |
| POST | `/uploads` | Yes | Upload one local file (`file` form field) |
| GET | `/reports/mine` | Yes | List own reports |

## Authentication example

1. Request a local OTP:
   ```http
   POST /api/auth/otp/request
   Content-Type: application/json

   { "destination": "demo@example.com" }
   ```
2. Copy `devOtp` from the response.
3. Verify:
   ```http
   POST /api/auth/otp/verify
   Content-Type: application/json

   {
     "destination": "demo@example.com",
     "code": "123456",
     "username": "demo_user",
     "displayName": "Demo User"
   }
   ```
4. Use `accessToken` as `Authorization: Bearer <token>`.
5. Store refresh tokens securely on the client; never put tokens in URLs or logs.

## Socket.IO

Connect with:
```ts
import { io } from "socket.io-client";

const socket = io("http://localhost:5000", {
  auth: { token: accessToken }
});

socket.emit("conversation:join", conversationId, (result) => console.log(result));
socket.on("message:new", message => console.log(message));
socket.emit("typing:start", conversationId);
```

The client must join a conversation before it receives room broadcasts. Message creation currently uses REST and broadcasts through Socket.IO.

## File uploads
- Send `multipart/form-data` with field name `file`.
- Allowed MIME types: JPEG, PNG, WebP, GIF, MP4, PDF, TXT and selected audio types.
- Default max size: 25 MB.
- Files are stored in `uploads/` and served from `/uploads/<filename>`.
- This public static route is for local testing only.

## Important follow-up work
1. Add automated integration tests and API collection.
2. Add transactions and stronger consistency for OTP consumption/session creation.
3. Add per-user/device session controls and device registration APIs.
4. Add membership and authorization checks for every group action.
5. Add private media delivery, file content inspection and quotas.
6. Implement reliable delivery receipts and offline message sync.
7. Implement a reviewed E2EE protocol on clients with server-side public-key/prekey directory.
8. Add Redis adapter for Socket.IO when running multiple backend instances.
9. Add FCM and real OTP provider only when ready.
10. Add admin roles, moderation dashboard APIs, monitoring, backups and deployment hardening.

## Security notes
- Use HTTPS outside localhost.
- Never commit `.env`.
- Never use the development OTP response in production.
- Rotate JWT secrets and use a secret manager in production.
- Add account enumeration protections and OTP request/verification throttling before public launch.
- Do not treat transport TLS as end-to-end encryption.
