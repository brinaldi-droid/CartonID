# CartonIQ

AI carton selection optimization for medical device distribution centers. Compare Manhattan WMS recommendations against CartonIQ's engineering-scored picks with explainable rationale, 3D cubing, and session analytics.

Original Figma Make bundle: https://www.figma.com/design/pVNMhhFS5yshcwioYXj85d/CartonIQ

## Features

- **Order Builder** — barcode-friendly SKU search, multi-SKU quantities, optional Manhattan carton entry
- **Recommendation Engine** — 3D extreme-points cubing, 80–92% utilization band, weighted engineering scores
- **Manhattan vs AI** — side-by-side comparison, freight / dim-weight / corrugate KPIs
- **Dunnage plan & top-3 alternatives** — kraft-paper placement and ranked carton options
- **Analytics** — session history with estimated savings and utilization KPIs
- **Admin** — Excel/CSV import plus add/edit/delete for SKUs and cartons

## Running

Requires Node.js 18+.

```bash
npm install
npm run dev
```

Open the local URL Vite prints (usually http://localhost:5173).

## Demo flow

1. **Create New Order**
2. Add SKUs (e.g. `MDV-4412`, `MDV-2201`) — press Enter after a barcode for exact match
3. Optionally set the Manhattan WMS carton
4. **Analyze** — review comparison, cubing layers, dunnage plan, and alternatives
5. Check **Analytics** for cumulative session KPIs
6. Use **Admin** to import your own SKU/carton Excel files

## Sample data

- `src/imports/Packsize.csv` — Packsize carton database (sole recommendation source)
- `src/imports/sku-database-sample.csv` — medical device SKUs with fragility
