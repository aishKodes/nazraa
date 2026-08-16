# Hostinger setup — four steps

You do **not** upload any application files to `public_html`. Vercel hosts the control panel; Hostinger provides MySQL only.

1. In Hostinger hPanel, open **Websites → Dashboard → Databases → Management**. Create one database and its user. Save the full generated database name, username, and password.
2. Next to that database, choose **Enter phpMyAdmin → Import**. Upload `hostinger-setup.sql` from this repository and click **Import/Go**. Do not edit the SQL file.
3. In hPanel, open **Remote MySQL**, select this database, enable **Any Host**, and create the remote connection. Copy the hostname shown there. This is needed because Vercel does not use one predictable outbound IP on the standard setup. Use a long unique database password.
4. In Vercel, import this GitHub repository. Keep the detected Next.js settings and add the environment variables shown below for **Production, Preview, and Development**.

```text
DB_HOST=the hostname shown in Hostinger Remote MySQL
DB_PORT=3306
DB_NAME=the full Hostinger database name
DB_USER=the full Hostinger database username
DB_PASSWORD=the database password
DB_SSL=false
SESSION_SECRET=a random value at least 32 characters long
INITIAL_MASTER_NAME=your name
INITIAL_MASTER_CODE=MST-NAZRAA
INITIAL_MASTER_PASSWORD=a long unique first password
```

Deploy, open the Vercel URL, and sign in using `INITIAL_MASTER_CODE` and `INITIAL_MASTER_PASSWORD`. The first successful login creates the Master account with a bcrypt hash. Then remove these three variables from Vercel and redeploy:

```text
INITIAL_MASTER_NAME
INITIAL_MASTER_CODE
INITIAL_MASTER_PASSWORD
```

Keep the `DB_*` and `SESSION_SECRET` values. Never add any of these secrets to GitHub.
