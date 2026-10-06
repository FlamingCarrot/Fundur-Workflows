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
  - Development: `http://localhost:3000/auth/callback`
  - Production: `https://your-domain.vercel.app/auth/callback`
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
APP_BASE_URL="http://localhost:3000"
```

On Vercel, set `APP_BASE_URL` to the production domain for production only. Leave it unset for preview deployments: the SDK then uses each preview's own host, and only hosts listed in **Allowed Callback URLs** can complete sign-in.

---

## 4. How sign-in is enforced
The SDK's routes (`/auth/login`, `/auth/logout`, `/auth/callback`, `/auth/profile`) are mounted by `src/proxy.ts`, which also guards every page and API route: signed-out visitors are sent to `/auth/login`, and API calls without a session get a `401`.

While the Auth0 variables above are missing, the proxy lets every request through so the demo can run locally without a tenant. Set them on every deployment that holds real client work.
