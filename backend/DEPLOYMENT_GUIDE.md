# 🚀 Free Deployment Guide for India Chat (BharatChat)

Complete guide to deploy **Database + Backend + Frontend** 100% free with SSL and WebSockets/WebRTC support.

---

## 🏗️ Architecture Overview

| Component | Free Platform | Features |
|---|---|---|
| **Database** | **[Neon.tech](https://neon.tech)** | Free PostgreSQL 16/17 serverless DB (0.5 GB storage, always free) |
| **Backend** | **[Render.com](https://render.com)** | Free Web Service (Node.js, Express, Socket.IO WebSockets) |
| **Frontend** | **[Vercel.com](https://vercel.com)** or **Netlify** | Free Global CDN, Instant HTTPS, Automatic CI/CD |

---

## Step 1: Create Free PostgreSQL Database on Neon (2 mins)

1. Go to [https://neon.tech](https://neon.tech) and sign up with your GitHub or Google account (No credit card required).
2. Click **"Create Project"**:
   - Project Name: `india-chat`
   - Region: Select closest (e.g., `AWS Asia Pacific (Singapore / Mumbai)`).
3. On the dashboard, copy the **Connection string**:
   ```
   postgresql://user:password@ep-xyz.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```
   *(Keep this string handy; this is your `DATABASE_URL`)*.

---

## Step 2: Push Your Code to GitHub (3 mins)

If you haven't pushed to GitHub yet:
1. Create 2 repositories on [GitHub](https://github.com):
   - `india-chat-backend`
   - `india-chat-frontend`
2. Push your backend:
   ```bash
   cd c:\Users\275679\OneDrive\Desktop\india-chat-backend
   git init
   git add .
   git commit -m "feat: complete backend with WebRTC and sockets"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/india-chat-backend.git
   git push -u origin main
   ```
3. Push your frontend:
   ```bash
   cd c:\Users\275679\OneDrive\Desktop\india-chat-frontend
   git init
   git add .
   git commit -m "feat: complete frontend with video calling and blue ticks"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/india-chat-frontend.git
   git push -u origin main
   ```

---

## Step 3: Deploy Backend on Render (3 mins)

1. Go to [https://render.com](https://render.com) and log in.
2. Click **"New +"** -> **"Web Service"**.
3. Select your `india-chat-backend` GitHub repository.
4. Configure the settings:
   - **Name**: `india-chat-backend` (or your choice)
   - **Region**: Singapore or Frankfurt
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**:
     ```bash
     npm install && npx prisma generate && npm run build
     ```
   - **Start Command**:
     ```bash
     npx prisma db push && npm start
     ```
   - **Instance Type**: `Free` ($0/month)
5. Scroll down to **Environment Variables** and add:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | *(Paste your Neon connection string from Step 1)* |
| `JWT_ACCESS_SECRET` | `generate-random-secret-key-at-least-32-chars-long-12345678` |
| `JWT_REFRESH_SECRET` | `generate-another-secret-key-at-least-32-chars-long-87654321` |
| `CLIENT_ORIGIN` | `*` |
| `DEV_RETURN_OTP` | `true` *(Allows instant OTP verification without paid SMS gateway)* |

6. Click **"Deploy Web Service"**.
   - Render will build and run migrations automatically.
   - Once deployed, copy your backend URL: e.g. `https://india-chat-backend.onrender.com`.
   - Test it by visiting: `https://india-chat-backend.onrender.com/api/health` -> should return `{"status":"healthy"}`.

---

## Step 4: Deploy Frontend on Vercel (2 mins)

1. Go to [https://vercel.com](https://vercel.com) and log in with GitHub.
2. Click **"Add New..."** -> **"Project"**.
3. Select your `india-chat-frontend` repository.
4. Settings:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `./`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Under **Environment Variables**, add:

| Key | Value |
|---|---|
| `VITE_API_URL` | `https://india-chat-backend.onrender.com` *(Your Render URL from Step 3)* |

6. Click **"Deploy"**.
7. In ~30 seconds, your site will be live at `https://india-chat-frontend.vercel.app` (or custom name)!

---

## Step 5: Final Check

1. Open your Vercel URL on mobile or laptop.
2. Enter any phone number or email -> OTP will appear automatically on screen.
3. Sign in, add a contact, and start chatting, voice calling, or video calling!
