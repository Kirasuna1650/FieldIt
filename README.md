# Field It

A simple web app to fill one PDF form template in bulk using worksheet-style table input.

## Features

- Upload a fillable PDF template
- Detect PDF field names automatically
- Auto-build a worksheet table from PDF fields
- Enter values directly in worksheet inputs
- Generate a filled PDF output
- Download one filled PDF file

## Tech Stack

- Node.js + Express
- pdf-lib for filling forms
- Plain HTML/CSS/JS frontend served by Express

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Start the app:

```bash
npm run dev
```

3. Open the app in a browser:

`http://localhost:3000`

## Run With Docker

1. Build and start:

```bash
docker compose up -d --build
```

2. Open:

`http://localhost:3000`

3. Stop:

```bash
docker compose down
```

## CasaOS Notes

- Copy this project folder to your Debian server.
- In CasaOS, create/import an app using this project's `docker-compose.yml`.
- If you use Cloudflare Tunnel, route your domain/subdomain to `http://localhost:3000` on that server.

## Usage

1. Select a fillable PDF form file.
2. Click **Build Worksheet from PDF**.
3. Enter data in worksheet inputs.
4. Click **Generate Filled PDF**.
5. Download the filled PDF.

## Notes

- Non-text controls are supported for common cases:
  - Checkboxes: values like `true`, `1`, `yes`, `on` are treated as checked.
  - Dropdown/radio fields: exact option text should match.
- Optional output file name can be entered before generating.
- Some advanced PDF form field types may need template-specific handling.
