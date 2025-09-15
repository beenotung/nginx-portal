# nginx-portal

A utility tool to easily manage port forwarding and update Nginx configurations through an interactive and scriptable CLI interface.

[![npm Package Version](https://img.shields.io/npm/v/nginx-portal)](https://www.npmjs.com/package/nginx-portal)

**Manage port forwarding for multiple servers with a compact list** like:

```
| port  | server_name                   | filename     |
| ----- | ----------------------------- | ------------ |
| 8080  | hkit.cc www.hkit.cc           | hkit.cc.conf |
| 9080  | jobsdone.hkit.cc              | -            |
| 10080 | talent-demand-dynamic.hkit.cc | -            |
```

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

## Format and Example

Example `nginx.md` file:

```
| port  | server_name                   | filename     |
| ----- | ----------------------------- | ------------ |
| 8080  | hkit.cc www.hkit.cc           | hkit.cc.conf |
| 9080  | jobsdone.hkit.cc              | -            |
| 10080 | talent-demand-dynamic.hkit.cc | -            |
```

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

## License

This project is licensed with [BSD-2-Clause](./LICENSE)

This is free, libre, and open-source software. It comes down to four essential freedoms [[ref]](https://seirdy.one/2021/01/27/whatsapp-and-the-domestication-of-users.html#fnref:2):

- The freedom to run the program as you wish, for any purpose
- The freedom to study how the program works, and change it so it does your computing as you wish
- The freedom to redistribute copies so you can help others
- The freedom to distribute copies of your modified versions to others
