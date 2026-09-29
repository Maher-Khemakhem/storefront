# Supermarket Storefront

The customer-facing React/Vite application for the supermarket ERP.

## Development

Start the Spring Boot backend on port `8080`, then run:

```powershell
npm install
npm run dev
```

Open `http://localhost:5174`. Vite proxies `/api` and `/uploads` to the backend.

The storefront uses the customer API under `/api/store/**` and stores only the
JWT session in browser local storage. Payment confirmation is currently the
backend's mock-card flow.
