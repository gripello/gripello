# Gripello

A climbing route management system for gyms and outdoor venues — [gripello.app](https://gripello.app).

- [Setup Docker Compose](#setup-docker-compose)
- [Getting Started](#getting-started)
- [Custom TLS Certificate](#custom-tls-certificate)
- [Usage](#usage)
- [Contributing](#contributing)
- [License](#license)

## Setup Docker Compose

Running Gripello in production requires a commercial license, see [License](#license).

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)

### Download Docker Compose File

```sh
wget https://raw.githubusercontent.com/gripello/gripello/main/docker-compose.yml
```

### Docker Compose Configuration

```yaml
services:
    gripello:
        container_name: gripello-app
        image: tilalx/verti-grade:latest
        ports:
            - '80:80'
            - '443:443'
        environment:
            # Default superuser created on first boot. Change before deploying!
            PB_SUPERUSER_EMAIL: admin@example.com
            PB_SUPERUSER_PASSWORD: changeme123
        volumes:
            - ./pb_data:/pb/pb_data
```

### Running the Project

```sh
docker-compose up -d
```

## Getting Started

After `docker-compose up -d` completes, follow these steps to get the application ready.

### 1. Open the Application

Navigate to **`https://localhost`** in your browser.

> The default setup uses a self-signed TLS certificate. Your browser will show a security warning — click "Advanced" → "Proceed" to continue. See [Custom TLS Certificate](#custom-tls-certificate) to use a real certificate.

### 2. Log In as Superuser

The superuser account is created automatically on first boot using the credentials set in `docker-compose.yml`:

| Field    | Default value       |
| -------- | ------------------- |
| Email    | `admin@example.com` |
| Password | `changeme123`       |

**Change these before deploying to production.**

The superuser account is used to access the PocketBase admin panel at `https://localhost/_/` — it is separate from regular user accounts.

### 3. Create Your First User Account

Regular user accounts must be created via the PocketBase admin panel:

1. Open `https://localhost/_/` and log in with the superuser credentials
2. Navigate to **Collections → users → New record**
3. Fill in the email, password, and any other required fields
4. Set **verified** to `true` so the user can log in immediately
5. Save the record

After that the user can log in at `https://localhost/auth/login`.

### 4. Configure Email

Without SMTP the app sends no mail at all — a user created in the UI never gets
their invitation and cannot sign in, and the DSA Art. 16 notices are not
delivered. Set these in `docker-compose.yml` (they are read at every boot, so
no visit to the PocketBase panel is needed):

| Variable                                | Purpose                                           |
| --------------------------------------- | ------------------------------------------------- |
| `PB_SMTP_HOST` / `PB_SMTP_PORT`         | Mail server. Setting the host enables SMTP.       |
| `PB_SMTP_USERNAME` / `PB_SMTP_PASSWORD` | Credentials, if the server needs them.            |
| `PB_SMTP_TLS`                           | `false` for STARTTLS; anything else enforces TLS. |
| `PB_APP_URL`                            | Origin used for links in mail.                    |
| `PB_APP_NAME`                           | Name used in subject lines and signatures.        |
| `PB_SENDER_ADDRESS` / `PB_SENDER_NAME`  | From address and display name.                    |

Leave `PB_SMTP_HOST` unset to keep whatever is configured in the PocketBase
panel instead.

### 5. Configure Application Settings

Go to **Admin → Settings** in the Gripello UI to configure:

- Organisation name and logo
- Privacy policy / imprint URL
- Sign image for route cards
- Grading scale for routes (UIAA, French, YDS) and boulders (Fontainebleau, V-Scale)

### 6. Start Adding Routes

Once logged in as a regular user, use the dashboard to add and manage climbing routes.

---

## Custom TLS Certificate

By default, a self-signed certificate is generated automatically at startup. To use your own certificate (e.g. from Let's Encrypt), mount it into the container:

```yaml
volumes:
    - ./pb_data:/pb/pb_data
    - ./ssl/cert.pem:/etc/nginx/ssl/cert.pem:ro
    - ./ssl/key.pem:/etc/nginx/ssl/key.pem:ro
```

---

## Rate Limiting

Rate limits are enabled by the migrations and need no configuration. They are
sized per client IP for a gym: generous on reads and route ratings, because a
whole hall shares one address behind wifi NAT, and tight on sign-ins and on the
endpoints that send mail. See `pocketbase/pb_migrations/1790200001_enable_rate_limits.js`
for each rule and the reasoning behind its numbers.

The container only believes `X-Forwarded-For` from the addresses in
`TRUSTED_PROXIES` (default `127.0.0.1 ::1`). If you put another reverse proxy in
front of it, make sure that proxy sets `X-Forwarded-For` and list its address or
network, e.g. `TRUSTED_PROXIES: "172.18.0.0/16"`. Without it every visitor is
bucketed as one client and the limits will start rejecting legitimate traffic.
Never list networks that untrusted clients connect from: they could then pick
their own IP and step around the limits.

---

## Captcha (optional)

Set `CAP_SECRET` to a long random string to require a solved
[Cap](https://trycap.dev) proof-of-work challenge on the actions an anonymous
visitor can trigger: creating a rating, filing a DSA notice, signing in, and the
public password-reset form. Leave it unset and the captcha is simply off — every
form keeps working, which is what an existing install gets after an upgrade.

The puzzle solves itself during submit (about a second on a phone); there is no
checkbox to tick, and the challenge is issued and verified entirely by this
application. Signed-in staff are never asked, and the PocketBase panel at `/_/`
is deliberately not gated — it cannot attach a token, and the rate limits cover
it instead.

> **Note:** the solver's WebAssembly module is fetched from `cdn.jsdelivr.net`
> at runtime by the upstream widget. Visitors' browsers therefore contact that
> CDN, and the captcha degrades (or fails) on a network that cannot reach it.
> Self-hosting that asset is possible via `window.CAP_CUSTOM_WASM_URL` and is
> not yet wired up here.

Turning it on also raises the two rate limits the captcha now backs, since each
submission costs the client real work.

For local development `yarn dev` supplies a throwaway secret of its own, so the
captcha is on by default there. Export your own to override it:

```sh
CAP_SECRET=$(openssl rand -hex 32) yarn dev
```

Do **not** put `CAP_SECRET` in `.env`: Nuxt would read it and PocketBase — a
sibling process started by `concurrently` — would not, which leaves visitors
solving puzzles that nothing verifies.

---

## Stopping the Service

```sh
docker-compose down
```

Data is persisted in `./pb_data` and survives restarts.

## Usage

Gripello is designed to be simple and straightforward. Once set up, manage and evaluate climbing routes through the web interface. For detailed usage instructions refer to the [documentation](https://github.com/gripello/gripello/wiki).

## Contributing

1. Fork the repository.
2. Create a new branch (`git checkout -b feature-branch`).
3. Make your changes.
4. Commit your changes (`git commit -am 'Add new feature'`).
5. Push to the branch (`git push origin feature-branch`).
6. Create a new Pull Request.

## License

Gripello is source-available under the [Business Source License 1.1](LICENSE), not an open source license.

- You may copy, modify and redistribute the code and use it for non-production purposes such as development, testing and evaluation.
- Production use, including self-hosting for a gym, requires a commercial license. Contact hello@gripello.com, or use the hosted version at [gripello.app](https://gripello.app).
- Each version converts to the Apache License 2.0 four years after its release.

Version 2.1.1 and earlier remain available under the GNU General Public License v3.0.
