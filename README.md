# Ecom Pro Dashboard

A Next.js 14 wrapper around the Ecom Pro dashboard — products, leads, tasks, campaigns, and more.

## Stack
- **Next.js 14** (App Router)
- **React 18**
- The dashboard itself is a self-contained HTML/JS/CSS app served from `/public/dashboard.html` and mounted into a full-screen iframe from `app/page.jsx`. Data is persisted in the browser's `localStorage`.

## Project structure

```
ecompro-dashboard/
├── app/
│   ├── globals.css      # global styles (loader + iframe sizing)
│   ├── layout.jsx       # root layout, metadata
│   └── page.jsx         # home route — mounts the dashboard iframe
├── public/
│   └── dashboard.html   # the actual dashboard app
├── .gitignore
├── next.config.mjs
├── package.json
└── README.md
```

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Deploy to Vercel via GitHub

1. **Create a GitHub repo**
   - Go to https://github.com/new
   - Name it `ecompro-dashboard` (or whatever), keep it Private if you prefer
   - Don't initialize with README/license — leave it empty

2. **Push this folder**
   From inside this `ecompro-dashboard/` folder:

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/ecompro-dashboard.git
   git push -u origin main
   ```

3. **Import to Vercel**
   - Go to https://vercel.com/new
   - Pick the GitHub repo you just pushed
   - Vercel auto-detects Next.js — leave all defaults
   - Click **Deploy**

   Live in ~1 minute at `https://ecompro-dashboard.vercel.app` (or your project name).

4. **Auto-deploy on every push**
   After this initial import, every `git push` to `main` triggers an automatic redeploy. Push, refresh — done.

## Updating the dashboard

The dashboard lives in `public/dashboard.html`. Edit it directly, commit, push — Vercel rebuilds.

```bash
git add public/dashboard.html
git commit -m "Update dashboard"
git push
```

## Notes

- Data is stored in `localStorage`, so each visitor has their own data (per browser).
- If you want shared data across visitors later, you'll need a backend (Supabase, Firebase, etc.).
- The iframe approach keeps the existing dashboard 100% intact while giving Vercel a proper Next.js project to deploy.
