# nginx-portal

A utility tool to easily manage port forwarding and update Nginx configurations through an interactive and scriptable CLI interface.

[![npm Package Version](https://img.shields.io/npm/v/nginx-portal)](https://www.npmjs.com/package/nginx-portal)

**Manage port forwarding (Node.js, WebSocket), static file server, and PHP server in one compact list:**

```
| dest                      | server_name                   | filename     | auth |
| ------------------------- | ----------------------------- | ------------ | ---- |
|  8080                     | hkit.cc www.hkit.cc           | hkit.cc.conf | -    |
|  9080                     | jobsdone.hkit.cc              | -            | -    |
| 10080                     | talent-demand-dynamic.hkit.cc | -            | -    |
| /var/www/html             | www.example.com               | -            | -    |
| /usr/share/phpmyadmin     | example.com/pma               | -            | y    |
```

<details>
<summary>Explanation of the table</summary>

- First column: `dest` (destination port or root directory).
  - **Port number** → port forwarding proxy (for Node.js, WebSocket servers).
  - **Directory** (e.g. `/var/www/html`) → static file server or PHP server; auto-scans for `.php` (if none, static-only).
- Second Column: `server_name`.
  - Plain host name (e.g. `example.com`) → site at `/`;
  - With path prefix (e.g. `example.com/pma`) → served under `/pma/`.
- Third Column: `filename` (optional; omit column or leave empty/`-` for auto).
  - Filename of the generated nginx config file.
  - If omitted, the tool uses `server_name` + `.conf`.
- Fourth Column: `auth` (optional; omit column or leave empty for auto).
  - `-` → no basic auth
  - empty → auto-detect htpasswd (see lookup below); no auth if none found
  - `y` → same auto-detect; if none found, use `/etc/nginx/.htpasswd`
  - absolute path → use that htpasswd file

Minimal table is `| dest | server_name |`. You can add `filename` and/or `auth` as needed (e.g. `| dest | server_name | auth |`).

Auth file auth-detect order (for empty / `y`):

For each host in `server_name` (space/comma-separated), under `/etc/nginx/auth/` then `/etc/nginx/`:

1. `<host>.htpasswd`
2. `.htpasswd-<host>`
3. `.htpasswd_<host>`

Then generics:

4. `/etc/nginx/auth/.htpasswd`
5. `/etc/nginx/.htpasswd`

For better compatibility, the first column header name can be any one of following: `dest`, `port`, `root`, `path`, `port_or_root`, `port_or_path`.

Columns can appear in **any order**; only the header names matter. `dest` and `server_name` are required; `filename` and `auth` are optional.

</details>
<br>

**with interactive menu**:

```
Select an action:
0. exit
1. scan nginx configs
2. apply nginx configs
3. show draft/update.sh
4. run draft/update.sh
action:
```

## Features

- **Port Forwarding Management**:

  Simplifies managing port forwarding with Nginx, making it easy to see which ports are allocated to which `server_name` through a compact `nginx.md` file.

- **Static server or PHP server in the same list**:

  Manage **static** roots (no PHP) and **PHP** roots (e.g. phpMyAdmin) in one `nginx.md`; the tool generates the right nginx config for each row.

- **Auto-detect PHP-FPM**:

  Detects PHP-FPM socket and version from `/run/php/php*.sock` when generating PHP configs.

- **Optional basic auth**:

  Controlled by the `auth` column. If it is not specified, the tool auto-picks a site-specific or generic htpasswd if present; `y` forces auth (default `/etc/nginx/.htpasswd`).

- **Interactive Mode**:

  A user-friendly interactive menu for performing tasks like scanning, applying configurations, and managing updates.

- **Scan and Generate `nginx.md`**:

  Scans and parses Nginx configuration files in the `conf.d` directory, then generates a `nginx.md` file that summarizes the configurations (e.g., ports and `server_name`) in an easy-to-read table format.

- **Auto Backup of `nginx.md`**:

  Automatically backs up the `nginx.md` file before generating a new one, ensuring previous configurations are preserved and no data is overwritten silently.

- **Apply Configurations**:

  Generates updated Nginx configuration files based on the content of the `nginx.md` file, allowing seamless application of the changes to the server.

- **Preserve HTTPS Certificates**:

  Automatically preserves existing HTTPS certificates managed by Certbot, ensuring SSL/TLS configurations remain intact.

- **Auto-Enable HTTP/2**:

  Automatically enables HTTP/2 for servers with HTTPS enabled, leveraging modern web protocols for better performance.

- **Custom Config Directory**:

  Set custom directories for Nginx configuration files using CLI flags, providing flexibility in managing configurations from different locations.

## Installation (Optional)

This is an npx package, you don't need to install it globally. You can run it directly using the npx command. However, you install it globally to lock down on a specific version.

```shell
npm install --global nginx-portal
# or in short
npm i -g nginx-portal
```

## Usage

You can run the CLI using the following command:

```shell
npx nginx-portal [options]
```

### Options

- `-s | --scan` : Scan Nginx configuration and save to `nginx.md` file.
- `-a | --apply` : Apply Nginx configuration from `nginx.md` file and generate `draft/update.sh`.
- `-f | --format` : Apply formatting to nginx configs (default skip formatting if no other effective changes).
- `-i | --interactive` : Run in interactive mode with multiple options.
- `-d | --config_dir DIR` : Set the directory of Nginx configs to be scanned (default: `/etc/nginx/conf.d`).
- `-h | --help` : Show help message and usage information.
- `-v | --version` : Display the current version of `nginx-portal`.

### Example Commands

#### Run in interactive mode:

```bash
npx nginx-portal -i
```

#### Scan Nginx configs from a custom directory:

```bash
npx nginx-portal --scan --config_dir ./mock/conf.d
```

#### Apply Nginx configs to default directory:

```bash
npx nginx-portal --apply
```

## Nginx Template Configuration

The generated nginx configurations include several important features:

- **WebSocket Support**: Properly forwards WebSocket connections with upgrade headers
- **Client IP Forwarding**: Preserves real client IP addresses behind the nginx proxy using multiple header formats
- **File Upload Limits**: Configurable `client_max_body_size` for large file uploads (uncomment and adjust as needed)
- **HTTP/2 Support**: Automatically enabled when HTTPS certificates are present

### Detailed Proxy Configuration

The location block includes these proxy headers:

```nginx
location / {
    # Forward to web server
    proxy_pass http://localhost:PORT;
    proxy_set_header Host $host;
    proxy_http_version 1.1;

    # WebSocket support
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_cache_bypass $http_upgrade;

    # Client IP forwarding
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Forwarded "for=$remote_addr;proto=$scheme;host=$host";
}
```

### File Upload Configuration

The `client_max_body_size` setting controls the maximum allowed size of client request bodies. By default, it's commented out with a 1MB limit. To allow larger file uploads:

1. Uncomment the line: `# client_max_body_size 1M;`
2. Adjust the size as needed (e.g., `client_max_body_size 10M;` for 10MB)
3. **Important**: This is a per-request limit, not per-file limit

### WebSocket Configuration

The nginx template includes WebSocket support with `proxy_cache_bypass $http_upgrade` to prevent caching of WebSocket/upgrade requests.

**Heartbeat Considerations**: If your WebSocket client sends heartbeats every 30 seconds, the default `proxy_read_timeout` of 60 seconds is sufficient. However, if your client doesn't send heartbeats or sends them less frequently, you may need to increase the timeout:

```nginx
location / {
    proxy_pass http://localhost:PORT;
    # ... other headers ...
    proxy_read_timeout 300s; # 5 minutes for clients without heartbeat
}
```

### Client IP Forwarding

The nginx template includes multiple client IP forwarding headers for compatibility:

- `X-Real-IP`: Contains the real client IP
- `X-Forwarded-For`: Standard header for proxy chains
- `Forwarded`: RFC 7239 standard header (for nginx 1.22.0-)

**For Express.js applications**: Add `app.set("trust proxy", "loopback")` to your app configuration, then use `req.ip` to get the real client IP address.

**For nginx 1.23.0+**: You can use the newer `$forwarded` variable by uncommenting the last line in the template.

## Examples of generated nginx configs

Example of newly generated `conf.d/jobsdone.hkit.cc.conf` before running certbot:

```
server {
    listen 80;
    listen [::]:80;

    server_name jobsdone.hkit.cc;

    # client_max_body_size 1M;

    location / {
        proxy_pass http://localhost:9080;
        # ... proxy headers for websocket, client IP forwarding, etc.
    }
}
```

---

Example `conf.d/jobsdone.hkit.cc.conf` after running certbot:

```
server {
    listen 80;
    listen [::]:80;

    server_name jobsdone.hkit.cc;

    # client_max_body_size 1M;

    location / {
        proxy_pass http://localhost:9080;
        # ... proxy headers for websocket, client IP forwarding, etc.
    }

    listen 443 ssl http2; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/hkit.cc/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/hkit.cc/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}
server {
    if ($host = jobsdone.hkit.cc) {
        return 301 https://$host$request_uri;
    } # managed by Certbot

    server_name jobsdone.hkit.cc;
    listen 80;

    return 404; # managed by Certbot
}
```

The lines with `# managed by Certbot` are automatically added by Certbot.

---

Example generated **static file server** (root `/var/www/html`, server_name `www.example.com`):

```
server {
    listen 80;
    listen [::]:80;

    server_name www.example.com;

    root /var/www/html;
    index index.html index.htm;

    access_log /var/log/nginx/www.example.com_access.log;
    error_log  /var/log/nginx/www.example.com_error.log;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Deny PHP so source is not served if .php files are added later without updating this config file
    location ~ \.php$ {
        deny all;
    }

    # Deny access to sensitive files and dirs (adjust these deny rules as needed)
    location ~ /\.(env|git|ht|phpunit|php-cs-fixer|composer|idea|vscode|cursor|docker|cache|tmp|temp|terraform|next|nuxt|vercel|netlify|npm|yarn|ds_store|sqlite|db|nyc_output|npmrc|yarnrc) {
        deny all;
    }
    location ~* \.(sqlite3?|db|map)$ {
        deny all;
    }
    location ~* /(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|composer\.json|composer\.lock|Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$ {
        deny all;
    }
    location ~* ^/(vendor|storage|node_modules|bower_components|coverage|cache|tmp|temp|logs|backups|scripts)/ {
        deny all;
    }
    location ~* ^/(doc|sql|setup/|examples|test|po|scripts|.*\.bak|.*\.dist|.*\.swp)$ {
        deny all;
    }
}
```

If no `.php` files were found in that directory, the tool config nginx to serve static files only (and denies `.php` so source is not exposed if PHP is added later without updating this config file).

Suitable for a simple HTML/CSS/JS site (e.g. landing page) or an SPA build.

The generated config uses `try_files $uri $uri/ /index.html` so client-side routes keep working.

---

Example generated **PHP with path prefix** (root `/usr/share/phpmyadmin`, server_name `example.com/pma`):

```
server {
    listen 80;
    listen [::]:80;

    server_name example.com;

    access_log /var/log/nginx/example.com_access.log;
    error_log  /var/log/nginx/example.com_error.log;

    # Basic auth
    auth_basic "Restricted Access";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location /pma/ {
        alias /usr/share/phpmyadmin/;
        index index.php index.html index.htm;
        try_files $uri $uri/ /pma/index.php?$args;
        location ~ \.php$ {
            include snippets/fastcgi-php.conf;
            fastcgi_param SCRIPT_FILENAME $request_filename;
            fastcgi_pass unix:/run/php/php8.3-fpm.sock;
            include fastcgi_params;
        }
    }

    # Deny access to sensitive files and dirs (adjust these deny rules as needed)
    location ~ /\.(env|git|ht|phpunit|php-cs-fixer|composer|idea|vscode|cursor|docker|cache|tmp|temp|terraform|next|nuxt|vercel|netlify|npm|yarn|ds_store|sqlite|db|nyc_output|npmrc|yarnrc) {
        deny all;
    }
    location ~* \.(sqlite3?|db|map)$ {
        deny all;
    }
    location ~* /(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|composer\.json|composer\.lock|Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$ {
        deny all;
    }
    location ~* ^/pma/(vendor|storage|node_modules|bower_components|coverage|cache|tmp|temp|logs|backups|scripts)/ {
        deny all;
    }
    location ~* ^/pma/(doc|sql|setup/|examples|test|po|scripts|.*\.bak|.*\.dist|.*\.swp|README|CHANGELOG|RELEASE-DATE-.*)$ {
        deny all;
    }
}
```

If `.php` files were found in that directory, FastCGI is enabled.

When `server_name` includes a path (e.g. `example.com/pma`), the app is served under `/pma/` with `alias` and a nested `location ~ \.php$`, not as the whole site root.

---

### Deny rules

Static and PHP configs get a shared deny list for sensitive paths (dotfiles, `*.db`/`*.map`, package/Docker metadata, `vendor`, …).

PhpMyAdmin setups get a few extra denies.

Edit the generated nginx config if you need different rules.

## Create htpasswd file

Shared default (`auth: y` or empty when the file exists):

```
sudo htpasswd -c /etc/nginx/.htpasswd "first_username"
```

Per-site (picked automatically when present):

```
sudo mkdir -p /etc/nginx/auth
sudo htpasswd -c /etc/nginx/auth/example.com.htpasswd "first_username"
```

When adding subsequent users (do NOT use `-c` flag, or it will overwrite the existing file):

```
sudo htpasswd /etc/nginx/.htpasswd "second_username"
```

The password will be asked in prompt.

## Install `htpasswd`

On Ubuntu/Debian:

```
sudo apt-get install apache2-utils
```

On CentOS/RHEL:

```
sudo yum install httpd-tools
```

On Fedora:

```
sudo dnf install httpd-tools
```

On Arch Linux:

```
sudo pacman -S apache-tools
```

## License

This project is licensed with [BSD-2-Clause](./LICENSE)

This is free, libre, and open-source software. It comes down to four essential freedoms [[ref]](https://seirdy.one/2021/01/27/whatsapp-and-the-domestication-of-users.html#fnref:2):

- The freedom to run the program as you wish, for any purpose
- The freedom to study how the program works, and change it so it does your computing as you wish
- The freedom to redistribute copies so you can help others
- The freedom to distribute copies of your modified versions to others
