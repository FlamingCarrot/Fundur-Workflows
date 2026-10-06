# Auth0 Setup Guide

This project uses **Auth0** for identity, authentication, and session management via `@auth0/nextjs-auth0`.

---

## 1. Create your Auth0 Application
1. Go to the [Auth0 Dashboard](https://manage.auth0.com).
2. Navigate to **Applications** -> **Applications** -> **Create Application**.
3. Choose **Regular Web Applications**.
4. Set the technology to **Next.js** (or generic Regular Web App).

---

## 2. Configure URLs
In your Application Settings:
- **Allowed Callback URLs**:
  - Development: `http://localhost:3000/api/auth/callback`
  - Production: `https://your-domain.vercel.app/api/auth/callback`
- **Allowed Logout URLs**:
  - Development: `http://localhost:3000`
  - Production: `https://your-domain.vercel.app`
- **Allowed Web Origins**:
  - Development: `http://localhost:3000`
  - Production: `https://your-domain.vercel.app`

---

## 3. Generate Secret & Configure `.env.local`
Run this in your terminal to generate a secure 32-byte secret for session encryption:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Fill in your `.env.local`:
```env
AUTH0_DOMAIN="your-tenant.us.auth0.com"
AUTH0_ISSUER_BASE_URL="https://your-tenant.us.auth0.com"
AUTH0_CLIENT_ID="<your-auth0-client-id>"
AUTH0_CLIENT_SECRET="<your-auth0-client-secret>"
AUTH0_SECRET="<generated-32-byte-hex-string>"
AUTH0_BASE_URL="http://localhost:3000"
```

---

## 4. Local Development Fallback
When developing locally without active internet or before creating your Auth0 tenant, the application includes an automatic **Development Fallback Mode**:
- Accessing `/api/auth/login` creates a local developer session cookie for `Andre Swanepoel (Workspace Owner)`.
- No credentials or internet connection required for rapid UI prototyping.
