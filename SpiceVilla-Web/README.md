# SpiceVilla — Web Technology Restaurant System

## Technology
- HTML5
- CSS3
- JavaScript (ES6)
- Browser LocalStorage for demo cart data
- Responsive UI

## Modules
- Premium public restaurant website
- Menu search and category filtering
- Customer interface
- Owner dashboard
- POS billing
- Kitchen Display System / KOT
- Table/reservation-ready interface
- GST billing UI with configurable CGST/SGST demo rates

The public homepage includes an illustrative POS and invoice preview; preview figures are examples, not live sales data. Inventory and staff management are not connected modules yet and are labeled as planned. Live owner workflows link to the existing database-backed POS, order, kitchen, menu, customer, payment, invoice, and report pages.

## Run the website
This application now uses a Python API and MySQL. Do not open HTML files directly or use a static-only Live Server: sign-in, ordering, and management data require the API.

1. Install Python 3.10+ and MySQL 8.0+.
2. Create a MySQL database user with permission to create/use the `spicevilla` database, then import `backend/schema.sql` using a MySQL client.
3. Copy `backend/.env.example` to `backend/.env` and set your MySQL connection values. Do not commit `backend/.env`.
4. Install backend packages with `python -m pip install -r requirements.txt`.
5. Start the website and API with `python backend/server.py`, then open `http://127.0.0.1:8000`.
6. Open **Owner Login → Create the owner account** on the restaurant computer to create the first owner account. Alternatively, create it from the project root with `python backend/create_owner.py`.

If npm is installed, `npm start` starts the API, `npm test` runs the database-independent checks, and `npm run create-owner` creates the first owner account.

Do not place database credentials in frontend files. For the configured local MySQL setup on this development PC, see **Portable local MySQL on Windows** below.

Run the backend's database-independent checks from the project root with `python -m unittest discover -s backend -p "test_*.py"`.

### Portable local MySQL on Windows
If you do not have administrator access, install the official MySQL 8.4 Windows ZIP into `%LOCALAPPDATA%\SpiceVilla\mysql\mysql-8.4.x-winx64`, initialize its data directory, and configure `backend\.env` for `127.0.0.1`. After importing `backend\schema.sql` and creating an owner account, run `.\start-local.ps1` from PowerShell to start MySQL (if needed) and the website. Keep that window open while using the app. Run `.\stop-local.ps1` to stop only this portable MySQL process; database files remain in your user profile.

On the configured development PC, portable MySQL is installed in the user profile, the schema and menu seed data are loaded, and `backend\.env` is configured with a local-only database account. The backend has been verified at `http://127.0.0.1:8000`. To run it again later, open PowerShell in the project folder and run `.\start-local.ps1`. Create the first restaurant owner from **Owner Login → Create the owner account**, or run `python backend\create_owner.py` while MySQL is running.

The web-based owner signup is a one-time bootstrap: it works only from a loopback connection on the restaurant computer and only while no owner account exists. Create additional owner accounts with the administrator-only `backend/create_owner.py` command.

## Demo navigation
Home → Customer / Order Online
Login → Customer interface
Owner Portal → Owner dashboard
Owner Dashboard → POS / Billing Workspace / Kitchen

Menu cards open a dedicated dish details page. Orders lead to an order confirmation and can be tracked from the customer interface. Issued customer invoices can be opened and printed or saved as PDF from the browser print dialog.

## Billing workspace
Owners use **Billing Workspace** from the owner dashboard to search all orders, issue GST invoices, record payments, and manage outstanding balances. Customers have a separate **My Billing** page with only their account's invoices and payment summary; they can open or print each invoice. Invoice rates are sample values and payment records are not a real payment gateway; no UPI or card payment is processed.

## Google customer sign-in
Open [Google Cloud Credentials](https://console.cloud.google.com/apis/credentials), configure the OAuth consent screen, and create an OAuth client ID for a **Web application**. Add `http://127.0.0.1:8000` as an authorized JavaScript origin. Set `GOOGLE_CLIENT_ID` in `backend/.env` to the public client ID and restart SpiceVilla. The login page displays setup instructions while this value is blank; the server validates Google ID tokens before creating or signing in a customer. Never add a client secret to the website.

## Important
## Backend API and limitations
The API persists menu, account, order, invoice, payment, reservation, and report data in MySQL. Customer passwords are stored as PBKDF2 hashes; server-side sessions use HttpOnly cookies. Sample GST rates are 2.5% CGST and 2.5% SGST and must be reviewed before production. Payment entries are records only—no UPI/card gateway is connected. Configure HTTPS and `COOKIE_SECURE=1` behind a production TLS proxy before deployment.
