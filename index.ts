import { execFileSync, spawnSync } from 'child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs'
import { basename } from 'path'
import { createInterface } from 'readline'

export type PortConfig = {
  type: 'port'
  port: number
  server_name: string
  filename: string
}

export type RootConfig = {
  type: 'root'
  root: string
  server_name: string
  filename: string
  /** e.g. /pma — serve app under this path instead of /. When set, generates location path/ { alias root/; ... }. */
  path_prefix?: string
  /**
   * nginx.md `auth` column:
   * - undefined / '' — auto: site-specific htpasswd if present, else generic, else no auth
   * - '-' — no auth
   * - 'y' — same lookup, but if none exist use `/etc/nginx/.htpasswd`
   * - absolute path — use this specific htpasswd file
   */
  auth?: string
  /** e.g. unix:/run/php/php8.3-fpm.sock. Defaults to unix:/run/php/php8.3-fpm.sock */
  fastcgi_pass?: string
}

export type Config = PortConfig | RootConfig

export function parse_default_filename(server_name: string) {
  return server_name.split(' ')[0].split(',')[0].split('/')[0] + '.conf'
}

/** If `server_name` contains a path (e.g. 'example.com/pma'),
 * return { server_name: 'example.com', path_prefix: '/pma' }. */
export function parse_server_name_path(server_name: string): {
  server_name: string
  path_prefix?: string
} {
  let i = server_name.indexOf('/')
  if (i < 0) {
    return { server_name }
  }
  let host = server_name.slice(0, i).trim()
  let path = server_name.slice(i).trim()
  if (path === '/') {
    return { server_name: host }
  }
  return { server_name: host, path_prefix: path }
}

/** Strip trailing slash; require absolute path; reject filesystem root `/`. */
export function normalize_doc_root(root: string): string {
  let path = root.trim()
  if (!path) {
    throw new Error('docroot must not be empty, got: ' + JSON.stringify(root))
  }
  if (path === '/') {
    throw new Error(
      'docroot must not be filesystem root (/), got: ' + JSON.stringify(root),
    )
  }
  if (!path.startsWith('/')) {
    throw new Error(
      'docroot must be an absolute path, got: ' + JSON.stringify(root),
    )
  }
  if (path.endsWith('/')) {
    path = path.slice(0, -1)
  }
  return path
}

export function format_config_list(config_list: Config[]): string {
  let lines: string[] = []
  lines.push(`| dest | server_name | filename | auth |`)
  lines.push(`|------|-------------|----------|------|`)
  config_list.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'port' ? -1 : 1
    if (a.type === 'port' && b.type === 'port') {
      let cmp = a.port - b.port
      if (cmp !== 0) return cmp
    }
    if (a.type === 'root' && b.type === 'root') {
      let cmp = a.root.localeCompare(b.root)
      if (cmp !== 0) return cmp
      cmp = (a.path_prefix || '').localeCompare(b.path_prefix || '')
      if (cmp !== 0) return cmp
    }
    return a.server_name.localeCompare(b.server_name)
  })
  for (let config of config_list) {
    let dest =
      config.type === 'port'
        ? config.port.toString().padStart(5, ' ')
        : config.root
    let default_filename = parse_default_filename(config.server_name)
    let filename = config.filename == default_filename ? '-' : config.filename
    let server_name =
      config.type === 'root' && config.path_prefix
        ? config.server_name + config.path_prefix
        : config.server_name
    let auth = config.type === 'root' ? format_auth_column(config.auth) : '-'
    lines.push(`| ${dest} | ${server_name} | ${filename} | ${auth} |`)
  }
  return lines.join('\n')
}

/** Split a markdown table row into cells; keep empty middle cells (column alignment). */
function parse_table_row(line: string): string[] {
  line = line.trim()
  if (!line) return []
  if (line.startsWith('|')) {
    line = line.slice(1)
  }
  if (line.endsWith('|')) {
    line = line.slice(0, -1)
  }
  return line.split('|').map(col => col.trim())
}

export function parse_config_list(text: string): Config[] {
  let lines = text
    .split('\n')
    .map(line => parse_table_row(line))
    .filter(line => line.length > 0)
  let headers = lines.shift()
  if (!headers) {
    throw new Error('missing header line')
  }
  let destVariants = new Set([
    'dest',
    'port',
    'root',
    'path',
    'port_or_root',
    'port_or_path',
  ])
  let colIndex = {
    dest: headers.findIndex(col => destVariants.has(col.toLowerCase())),
    server_name: headers.findIndex(col => col.toLowerCase() === 'server_name'),
    filename: headers.findIndex(col => col.toLowerCase() === 'filename'),
    auth: headers.findIndex(col => col.toLowerCase() === 'auth'),
  }
  if (colIndex.dest == -1 || colIndex.server_name == -1) {
    throw new Error(
      'invalid table header, requires dest and server_name (filename/auth optional, in any order)',
    )
  }
  let indices = Object.values(colIndex)
  let extraHeaders = headers
    .map((name, index) => ({ name, index }))
    .filter(col => !indices.includes(col.index))
    .map(col => col.name)
  let missingHeaders = Object.entries(colIndex)
    .filter(([_name, index]) => index === -1)
    .map(([name]) => name)
  if (missingHeaders.length > 0 && extraHeaders.length > 0) {
    throw new Error(
      `potential mismatch in header names, extra headers found: ${extraHeaders.join(', ')}, missing headers: ${missingHeaders.join(', ')}`,
    )
  }
  if (lines.length == 0) return []

  // remove separator line (cells are dashes)
  if (lines[0].every(col => col.replaceAll('-', '').length === 0)) {
    lines.shift()
  }

  let config_list: Config[] = []

  for (let cols of lines) {
    let dest = cols[colIndex.dest]

    let serverNameRaw = cols[colIndex.server_name]
    if (!serverNameRaw) {
      throw new Error('missing server_name, row: ' + JSON.stringify(cols))
    }
    let { server_name, path_prefix } = parse_server_name_path(serverNameRaw)

    let filename = cols[colIndex.filename]
    if (!filename || filename == '-') {
      filename = parse_default_filename(server_name)
    }

    let auth = cols[colIndex.auth]

    if (+dest) {
      let port = +dest
      config_list.push({
        type: 'port',
        port,
        server_name,
        filename,
      })
    } else if (dest?.startsWith('/')) {
      let root = normalize_doc_root(dest)
      config_list.push({
        type: 'root',
        root,
        server_name,
        filename,
        path_prefix,
        auth,
      })
    } else {
      throw new Error('invalid dest, got: ' + JSON.stringify(cols))
    }
  }

  return config_list
}

export function scan_conf_dir(dir: string): Config[] {
  if (!existsSync(dir)) {
    console.log('Warning: nginx config directory not found: ' + config_dir)
    return []
  }
  let filenames = readdirSync(dir)
  let config_list: Config[] = []
  for (let filename of filenames) {
    let file = join(dir, filename)
    try {
      let config = parse_conf_file(file)
      config_list.push(config)
    } catch (error) {
      let message = String(error)
      if (message.includes('not found')) {
        continue
      }
      showError(error)
    }
  }
  return config_list
}

export function parse_conf_lines(text: string): string[] {
  let lines = text
    .split('\n')
    .map(line => line.split('#')[0].trim())
    .filter(line => line.length > 0)
  return lines
}

export function parse_conf_file(file: string): Config {
  let text = load_file(file).trim()
  let lines = parse_conf_lines(text)
  let server_name = lines
    .find(line => line.startsWith('server_name '))
    ?.replace('server_name ', '')
    .split(';')[0]
    .trim()
  if (!server_name) {
    throw new Error('server_name not found, file: ' + JSON.stringify(file))
  }
  let filename = basename(file)
  let proxyLine = lines.find(line => line.startsWith('proxy_pass '))
  if (proxyLine) {
    let port = +proxyLine
      .replace('proxy_pass ', '')
      .split(';')[0]
      .split(':')
      .pop()!
    if (!port) {
      throw new Error('port not found, file: ' + JSON.stringify(file))
    }
    return {
      type: 'port',
      port,
      server_name,
      filename,
    }
  }
  let authFile = lines
    .find(line => line.startsWith('auth_basic_user_file '))
    ?.replace('auth_basic_user_file ', '')
    .split(';')[0]
    .trim()
  // Optional; presence of fastcgi_pass (not deny-`\.php`) marks PHP on save
  let fastcgi_pass = lines
    .find(line => line.startsWith('fastcgi_pass '))
    ?.replace('fastcgi_pass ', '')
    .split(';')[0]
    .trim()

  let rootLine = lines.find(line => line.startsWith('root '))
  if (rootLine) {
    let root = rootLine.replace('root ', '').split(';')[0].trim()
    root = normalize_doc_root(root)
    return {
      type: 'root',
      filename,
      server_name,
      root,
      auth: auth_from_user_file(authFile),
      fastcgi_pass,
    }
  }

  // Path-prefix apps: `location /pma/ { alias /usr/share/phpmyadmin/; ... }` (no top-level root)
  let aliasLine = lines.find(line => line.startsWith('alias '))
  if (aliasLine) {
    let root = aliasLine.replace('alias ', '').split(';')[0].trim()
    root = normalize_doc_root(root)
    let path_prefix: string | undefined
    for (let line of lines) {
      if (!line.startsWith('location ') || line.includes('~')) continue
      let match = /^location\s+(\/\S+?)\s*\{?\s*$/.exec(line)
      if (!match) continue
      let path = match[1]
      if (path === '/') continue
      path_prefix = path.endsWith('/') ? path.slice(0, -1) : path
      break
    }
    return {
      type: 'root',
      filename,
      server_name,
      root,
      auth: auth_from_user_file(authFile),
      path_prefix,
      fastcgi_pass,
    }
  }

  throw new Error(
    'unknown config type (expect proxy_pass, root, or alias): ' +
      JSON.stringify(file),
  )
}

const PHP_FPM_DIR = '/run/php'
const NGINX_DIR = '/etc/nginx'
const NGINX_AUTH_DIR = '/etc/nginx/auth'
const DEFAULT_HTPASSWD = `${NGINX_DIR}/.htpasswd`
const DEFAULT_HTPASSWD_2 = `${NGINX_AUTH_DIR}/.htpasswd`
const DEFAULT_PHP_FPM_SOCK = 'unix:/run/php/php8.3-fpm.sock'

/** Detect PHP-FPM socket from /run/php/ (e.g. php8.3-fpm.sock).
 * Returns undefined if dir missing or no match. */
export function detect_php_fpm_sock(): string | undefined {
  if (!existsSync(PHP_FPM_DIR)) return undefined
  let names: string[] = []
  try {
    names = readdirSync(PHP_FPM_DIR)
  } catch {
    return undefined
  }
  let versioned = names
    .filter(n => n.endsWith('.sock') && /^php[\d.]+-fpm\.sock$/.test(n))
    .sort()
    .pop()
  let unversioned = names.find(n => n === 'php-fpm.sock')
  let sock = versioned ?? unversioned
  if (sock) {
    return `unix:${PHP_FPM_DIR}/${sock}`
  }
  return undefined
}

/** Candidate htpasswd paths (each server_name host, then generic). */
export function auth_file_candidates(server_name: string): string[] {
  let files: string[] = []
  let hosts = server_name
    .split(' ')
    .flatMap(part => part.split(','))
    .map(part => part.split('/')[0].trim())
    .filter(part => part.length > 0)
  let variants = ['<host>.htpasswd', '.htpasswd-<host>', '.htpasswd_<host>']
  let dirs = [NGINX_AUTH_DIR, NGINX_DIR]
  for (let dir of dirs) {
    for (let host of hosts) {
      for (let variant of variants) {
        let name = variant.replace('<host>', host)
        files.push(`${dir}/${name}`)
      }
    }
  }
  for (let dir of dirs) {
    files.push(`${dir}/.htpasswd`)
  }
  return files
}

/**
 * Resolve nginx `auth_basic_user_file` path from the `auth` column.
 * - '-' → undefined (no auth)
 * - absolute path → that path
 * - 'y' — same lookup as empty, else DEFAULT_HTPASSWD
 * - empty/undefined — site-specific if present, else generic, else undefined
 */
export function resolve_auth_user_file(config: {
  server_name: string
  auth?: string
}): string | undefined {
  let auth = config.auth?.trim()
  if (auth === '-') return undefined
  if (auth?.startsWith('/')) return auth
  let force = !!auth && ['y', 'yes'].includes(auth.toLowerCase())
  if (auth && !force) {
    throw new Error(
      'invalid auth value (use -, y, empty, or absolute path): ' +
        JSON.stringify(auth),
    )
  }
  for (let file of auth_file_candidates(config.server_name)) {
    if (existsSync(file)) return file
  }
  return !force
    ? undefined
    : existsSync(NGINX_AUTH_DIR)
      ? DEFAULT_HTPASSWD_2
      : DEFAULT_HTPASSWD
}

/** Map a conf `auth_basic_user_file` path back to an `auth` column value. */
export function auth_from_user_file(file?: string): string {
  if (!file) return '-'
  if (file === DEFAULT_HTPASSWD || file === DEFAULT_HTPASSWD_2) {
    return 'y'
  }
  return file
}

/** Format `auth` column cell for nginx.md. */
export function format_auth_column(auth?: string): string {
  let value = auth?.trim()
  if (!value) return ''
  if (['y', 'yes'].includes(value.toLowerCase())) return 'y'
  return value
}

// Dirs to skip when scanning for .php (avoid false positives from vendor/node_modules etc.)
const PHP_SCAN_SKIP_DIRS = new Set([
  'vendor',
  'node_modules',
  'bower_components',
  'storage',
  'cache',
  'tmp',
  'temp',
  'logs',
  'backups',
  '.git',
])

/** Scan root dir for any .php file (recursive, skipping vendor/node_modules etc.). Missing/unreadable root → false (tool runs on the real host). */
export function has_php_files(root: string): boolean {
  if (!existsSync(root)) {
    return false
  }
  let stack = [root]
  while (stack.length > 0) {
    let dir = stack.pop()!
    try {
      let filenames = readdirSync(dir)
      for (let filename of filenames) {
        if (filename.endsWith('.php')) {
          return true
        }
        if (PHP_SCAN_SKIP_DIRS.has(filename) || filename.startsWith('.'))
          continue
        let file = join(dir, filename)
        if (statSync(file).isDirectory()) {
          stack.push(file)
        }
      }
    } catch (error) {
      // ignore unreadable dirs / files
    }
  }
  return false
}

/**
 * Best-effort phpMyAdmin detection (heuristics; may miss custom layouts or false-positive on /admin-like paths).
 * True if root/path looks like PMA, a marker file mentions PhpMyAdmin, or themes/pmahomme exists.
 */
export function is_phpmyadmin(root: string, path_prefix?: string): boolean {
  if (/phpmyadmin/i.test(root)) return true
  // path: `admin` covers /admin and /phpmyadmin; also accept short /pma aliases
  if (path_prefix && /(admin|pma)/i.test(path_prefix)) return true
  // Theme dir name is PMA-specific (existence only)
  if (existsSync(join(root, 'themes/pmahomme'))) return true
  // PHP markers: require product name in file contents (existence alone is not enough)
  let contentMarkers = [
    'index.php',
    'config.sample.inc.php',
    'libraries/vendor_config.php',
    'libraries/classes/DatabaseInterface.php',
  ]
  for (let marker of contentMarkers) {
    let file = join(root, marker)
    if (!existsSync(file)) continue
    try {
      let text = readFileSync(file, 'utf-8')
      if (/phpmyadmin/i.test(text)) return true
    } catch {
      // ignore unreadable files
    }
  }
  return false
}

export function save_conf_file(args: { dir: string; config: Config }) {
  let { dir, config } = args
  if (config.type === 'root') {
    config = { ...config, root: normalize_doc_root(config.root) }
  }
  let text: string
  if (config.type === 'port') {
    text = `
server {
    listen 80;
    listen [::]:80;

    server_name ${config.server_name};

    ## Uncomment and increase if clients need to upload large files (per request limit, not per file limit)
    # client_max_body_size 1M;

    location / {
        ## Forward to web server
        proxy_pass http://localhost:${config.port};
        proxy_set_header Host $host;
        proxy_http_version 1.1;

        ## Forward websocket connections
        ## Client sends heartbeat every 30s, so default proxy_read_timeout 60s is fine
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_cache_bypass $http_upgrade; # don't cache websocket/upgrade requests

        ## Forward client IP behind nginx proxy
        ## for express, add app.set("trust proxy", "loopback"), then use req.ip to get the client ip
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Forwarded "for=$remote_addr;proto=$scheme;host=$host"; # for nginx 1.22.0-
        # proxy_set_header Forwarded $forwarded; # for nginx 1.23.0+
    }
}
`
  } else {
    // Default deny list for static and PHP: dotfiles/dirs that should not be web-accessible. Edit generated config to allow more as needed.
    let sensitiveDotfiles =
      'env|git|ht|phpunit|php-cs-fixer|composer|idea|vscode|cursor|docker|cache|tmp|temp|terraform|next|nuxt|vercel|netlify|npm|yarn|ds_store|sqlite|db|nyc_output|npmrc|yarnrc'
    let sensitiveDirs =
      'vendor|storage|node_modules|bower_components|coverage|cache|tmp|temp|logs|backups|scripts'
    // Deny database / source-map extensions (*.sqlite, *.db, *.js.map, *.map, etc.)
    let sensitiveExt = '\\.(sqlite3?|db|map)$'
    // Deny package/docker metadata files if present under the docroot
    let sensitiveFiles =
      'package\\.json|package-lock\\.json|pnpm-lock\\.yaml|yarn\\.lock|composer\\.json|composer\\.lock|Dockerfile|docker-compose\\.ya?ml|compose\\.ya?ml'
    // Extra paths/files (README allowed by default)
    let sensitiveExtra =
      'doc|sql|setup/|examples|test|po|scripts|.*\\.bak|.*\\.dist|.*\\.swp'
    if (is_phpmyadmin(config.root, config.path_prefix)) {
      // phpMyAdmin-only: top-level docs / release-date stamp files
      sensitiveExtra += '|README|CHANGELOG|RELEASE-DATE-.*'
    }

    let authPath = resolve_auth_user_file(config)
    let authBlock = authPath
      ? `
    # Basic auth
    auth_basic "Restricted Access";
    auth_basic_user_file ${authPath};
`
      : ''

    let logName = config.filename.replace(/\.conf$/, '')

    // enable PHP server only when docroot has .php files (missing root / FPM installed alone → static)
    let withPhp = has_php_files(config.root)
    let fastcgi =
      config.fastcgi_pass ?? detect_php_fpm_sock() ?? DEFAULT_PHP_FPM_SOCK

    let pathPrefix = config.path_prefix ?? ''
    let pathLoc = pathPrefix.endsWith('/') ? pathPrefix : pathPrefix + '/'
    let rootSlash = config.root.endsWith('/') ? config.root : config.root + '/'

    let denyPath = pathPrefix ? pathLoc : '/'

    let rootBlock = pathPrefix
      ? ''
      : `
    root ${config.root};
    index ${withPhp ? 'index.php ' : ''}index.html index.htm;
`

    let locationBlock: string
    if (pathPrefix && withPhp) {
      locationBlock = `
    location ${pathLoc} {
        alias ${rootSlash};
        index index.php index.html index.htm;
        try_files $uri $uri/ ${pathLoc}index.php?$args;
        location ~ \\.php$ {
            include snippets/fastcgi-php.conf;
            fastcgi_param SCRIPT_FILENAME $request_filename;
            fastcgi_pass ${fastcgi};
            include fastcgi_params;
        }
    }
`
    } else if (pathPrefix) {
      locationBlock = `
    location ${pathLoc} {
        alias ${rootSlash};
        index index.html index.htm;
        try_files $uri $uri/ ${pathLoc}index.html;
    }
`
    } else if (withPhp) {
      locationBlock = `
    location / {
        try_files $uri $uri/ /index.php?$args;
    }
`
    } else {
      locationBlock = `
    location / {
        try_files $uri $uri/ /index.html;
    }
`
    }

    let denyPhpBlock = withPhp
      ? ''
      : `
    # Deny PHP so source is not served if .php files are added later without updating this config file
    location ~ \\.php$ {
        deny all;
    }
`

    let denyBlock = `
    # Deny access to sensitive files and dirs (adjust these deny rules as needed)
    location ~ /\\.(${sensitiveDotfiles}) {
        deny all;
    }
    location ~* ${sensitiveExt} {
        deny all;
    }
    location ~* /(${sensitiveFiles})$ {
        deny all;
    }
    location ~* ^${denyPath}(${sensitiveDirs})/ {
        deny all;
    }
    location ~* ^${denyPath}(${sensitiveExtra})$ {
        deny all;
    }`

    let rootPhpBlock =
      withPhp && !pathPrefix
        ? `
    location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass ${fastcgi};
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
    }`
        : ''

    text = `
server {
    listen 80;
    listen [::]:80;

    server_name ${config.server_name};
${rootBlock}
    access_log /var/log/nginx/${logName}_access.log;
    error_log  /var/log/nginx/${logName}_error.log;
${authBlock}${locationBlock}${denyPhpBlock}${denyBlock}${rootPhpBlock}
}
`
  }
  let file = join(dir, config.filename)
  save_file(file, text)
}

type Semver = {
  major: number
  minor: number
  patch: number
}

// Debian-family /etc/profile drops sbin dirs for non-root, so "nginx" only resolves under sudo
const NGINX_BINARIES = [
  'nginx',
  '/usr/sbin/nginx',
  '/usr/local/sbin/nginx',
  '/usr/local/nginx/sbin/nginx',
]

/** Detect nginx version from `nginx -v` (e.g. 1.24.0). undefined if nginx missing/unreadable. */
export function detect_nginx_version(): Semver | undefined {
  for (let binary of NGINX_BINARIES) {
    try {
      let result = spawnSync(binary, ['-v'], { encoding: 'utf-8' })
      let text = `${result.stderr || ''}${result.stdout || ''}`
      let match = /nginx\/(\d+)\.(\d+)\.(\d+)/.exec(text)
      if (!match) continue
      return {
        major: +match[1],
        minor: +match[2],
        patch: +match[3],
      }
    } catch {
      continue
    }
  }
  return undefined
}

/** True when standalone `http2 on;` is supported (nginx 1.25.1+). */
export function nginx_supports_http2_directive(
  version = detect_nginx_version(),
): boolean {
  if (!version) return false
  return compare_semver(version, { major: 1, minor: 25, patch: 1 }) >= 0
}

function compare_semver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

let warned_missing_nginx_version = false

export function update_conf_file(
  file: string,
  version = detect_nginx_version(),
) {
  const text = load_file(file)

  let new_text = text.replaceAll('\r', '')

  for (;;) {
    let t = new_text.replaceAll('\n\n\n\n', '\n\n\n')
    if (t == new_text) {
      break
    }
    new_text = t
  }

  let lines = parse_conf_lines(new_text)
  let useHttp2Directive = nginx_supports_http2_directive(version)

  // look for line: "listen 443 ssl; # managed by Certbot"
  //       or line: "listen [::]:443 ssl; # managed by Certbot"
  let has_ssl = lines.some(
    line =>
      line.startsWith('listen ') &&
      line.includes('443') &&
      line.includes('ssl'),
  )

  // look for line: "listen 443 ssl http2; # managed by Certbot"
  //       or line: "listen 443 http2 ssl; # managed by Certbot"
  //       or line: "listen [::]:443 ssl http2; # managed by Certbot"
  let has_http2_line = lines.some(
    line =>
      line.startsWith('listen ') &&
      line.includes('443') &&
      line.includes('ssl') &&
      line.includes('http2'),
  )

  // look for line: "http2 on;" (nginx 1.25.1+)
  let has_http2_on = lines.some(line => line.startsWith('http2 on'))

  let has_http2 = has_http2_line || has_http2_on

  if (!version) {
    // nginx version unknown: keep the existing http2 syntax instead of guessing.
    // The legacy form warns on nginx 1.25.1+, while "http2 on;" fails on older nginx.
    if (!warned_missing_nginx_version) {
      warned_missing_nginx_version = true
      console.log(
        'Warning: cannot detect nginx version, leaving http2 settings unchanged',
      )
    }
  } else if (useHttp2Directive && has_ssl) {
    // nginx 1.25.1+: prefer `http2 on;` and strip deprecated listen … http2
    // e.g. "listen 443 ssl http2;" -> "listen 443 ssl;"
    // e.g. "listen [::]:443 ssl http2;" -> "listen [::]:443 ssl;"
    // then insert "http2 on;"
    let lines = new_text.split('\n')

    // remove "http2" from "listen … http2;" line
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]
      if (line.trimStart()[0] == '#') continue
      if (
        line.includes('listen ') &&
        line.includes('443') &&
        line.includes('ssl') &&
        line.includes('http2')
      ) {
        lines[i] = line.replace(/\s+http2\b/, '')
      }
    }

    // insert "http2 on;" line
    if (!has_http2_on) {
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i]
        if (line.trimStart()[0] == '#') continue
        if (
          line.includes('listen ') &&
          line.includes('443') &&
          line.includes('ssl')
        ) {
          let indent = line.match(/^(\s*)/)?.[1] ?? '    '
          // e.g. insert "    http2 on;" after the first ssl listen line
          lines.splice(i + 1, 0, `${indent}http2 on;`)
          has_http2 = true
          break
        }
      }
    }

    new_text = lines.join('\n')
  } else if (!has_http2 && has_ssl) {
    // nginx < 1.25.1: enable via listen … http2 on every ssl listen
    // e.g. "listen 443 ssl;" -> "listen 443 ssl http2;"
    // e.g. "listen [::]:443 ssl;" -> "listen [::]:443 ssl http2;"
    let lines = new_text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]
      if (line.trimStart()[0] == '#') continue
      let trimmed = line.split('#')[0].trim()
      if (
        !trimmed.startsWith('listen ') ||
        !trimmed.includes('443') ||
        !trimmed.includes('ssl') ||
        trimmed.includes('http2')
      ) {
        continue
      }
      // keep "default_server" and other listen params in place
      lines[i] = line.replace(/\bssl\b/, 'ssl http2')
    }
    new_text = lines.join('\n')
    has_http2 = true
  }

  if (new_text != text) {
    save_file(file, new_text)
  }

  if (!has_http2 && !has_ssl) {
    // not obtained ssl cert by certbot yet
    return 'no ssl' as const
  }
}

function join(...parts: string[]) {
  // use linux convention even when the script is generated on windows (to be run on linux server)
  return parts.join('/')
}

function save_file(file: string, text: string) {
  text = text.trim() + '\n'
  if (existsSync(file)) {
    let old_text = readFileSync(file).toString()
    if (text == old_text) {
      console.log('unchanged file:', file)
      return
    }
    let date = new Date()
    let y = date.getFullYear()
    let m = date.getMonth().toString().padStart(2, '0')
    let d = date.getDate().toString().padStart(2, '0')
    let H = date.getHours().toString().padStart(2, '0')
    let M = date.getMinutes().toString().padStart(2, '0')
    let S = date.getSeconds().toString().padStart(2, '0')
    let new_file = `${file}.bk_${y}-${m}-${d}_${H}${M}${S}`
    console.log('backup file:', file, '->', new_file)
    renameSync(file, new_file)
  }
  console.log('save file:', file)
  writeFileSync(file, text)
}

function load_file(file: string) {
  console.log('load file:', file)
  return readFileSync(file).toString()
}

function showError(error: unknown) {
  if (__filename.endsWith('.js')) {
    console.error(String(error))
  } else {
    console.error(error)
  }
}

let config_list_file = 'nginx.md'

export let config_dir = '/etc/nginx/conf.d'
let draft_dir = 'draft/conf.d'
let bash_file = 'draft/update.sh'

export function set_config_dir(dir: string) {
  config_dir = dir
}

export let modes = {
  scan_config() {
    console.log('scanning config dir:', config_dir)
    let config_list = scan_conf_dir(config_dir)
    let text = format_config_list(config_list)
    save_file(config_list_file, text)
    console.log()
    console.log(
      '[message] please update file:',
      config_list_file,
      'to continue',
    )
  },
  apply_config(options: { apply_formatting: boolean }) {
    let text = load_file(config_list_file)
    let config_list = parse_config_list(text)

    let no_ssl = false
    let lines: string[] = []

    mkdirSync(draft_dir, { recursive: true })

    for (let config of config_list) {
      let src = join(config_dir, config.filename)
      let dest = join(draft_dir, config.filename)
      if (!existsSync(src)) {
        save_conf_file({ dir: draft_dir, config })
        no_ssl = true
        lines.push(`sudo cp ${JSON.stringify(dest)} ${JSON.stringify(src)}`)
        continue
      }

      copyFileSync(src, dest)
      let update_result = update_conf_file(dest)

      if (update_result == 'no ssl') {
        no_ssl = true
        continue
      }

      if (is_file_same(src, dest)) {
        // already updated
        continue
      }

      lines.push(`sudo cp ${JSON.stringify(dest)} ${JSON.stringify(src)}`)
    }

    if (no_ssl || lines.length > 0) {
      lines.push(`sudo nginx -t`)
      lines.push(`sudo service nginx restart`)
    }

    if (no_ssl) {
      lines.push(`sudo certbot --nginx`)
      lines.push(
        `echo "Hint: run nginx-portal again to enable http2 in nginx configs"`,
      )
    }

    if (lines.length > 0) {
      lines.unshift('set -e')
    }

    save_file(bash_file, lines.join('\n'))

    console.log()
    console.log('[message] please run file:', bash_file, 'to continue')
  },
  show_bash() {
    let text = load_file(bash_file)
    console.log()
    console.log(`content of ${bash_file}:`)
    console.log('```')
    console.log(text.trim())
    console.log('```')
  },
  run_bash() {
    execFileSync('bash', [bash_file], {
      stdio: 'inherit',
    }).toString()
  },
  async interactive() {
    for (;;) {
      console.log(
        `
Select an action:
0. exit
1. scan nginx configs into nginx.md
2. apply nginx configs from nginx.md and generate ${bash_file}
3. show ${bash_file}
4. run ${bash_file}
`.trim(),
      )
      let ans = await ask('action: ')
      ans = ans.toLowerCase()
      switch (ans) {
        case '0':
        case 'exit':
        case '.exit':
          return
        case '1':
        case 'scan':
          modes.scan_config()
          break
        case '2':
        case 'apply': {
          let ans = await ask('apply formatting to nginx configs? (y/N): ')
          let apply_formatting = ans.trim()[0]?.toLowerCase() == 'y'
          modes.apply_config({ apply_formatting })
          break
        }
        case '3':
        case 'show':
          modes.show_bash()
          break
        case '4':
        case 'run':
          modes.run_bash()
          break
        default:
          console.error('Error: unknown action')
          break
      }
      console.log()
    }
  },
}

function read_file_for_compare(file: string): string {
  return readFileSync(file)
    .toString()
    .trim()
    .split('\n')
    .map(line => line.trim())
    .join('')
}

function is_file_same(a_file: string, b_file: string) {
  let a_text = read_file_for_compare(a_file)
  let b_text = read_file_for_compare(b_file)
  return a_text == b_text
}

function showHelp() {
  let { version } = require('./package.json')
  console.log(
    `
nginx-portal v${version}

Usage: nginx-portal [options]

Options:
  -s | --scan               scan nginx configs and save to nginx.md file
  -a | --apply              apply nginx configs from nginx.md file
  -f | --format             apply formatting to nginx configs (default skip formatting if no other effective changes)
  -i | --interactive        run multiple modes with interactive menu
  -d | --config_dir DIR     set the directory of nginx configs to be scanned from (default: /etc/nginx/conf.d)
  -h | --help               show this help message
  -v | --version            show version information

Example:
  nginx-portal -h
`.trim(),
  )
}

function showVersion() {
  let { version } = require('./package.json')
  console.log(version)
}

async function cli() {
  let interactive_flag = false
  let scan_config_flag = false
  let apply_config_flag = false
  let apply_formatting = false
  for (let i = 2; i < process.argv.length; i++) {
    let arg = process.argv[i]
    switch (arg) {
      case '-h':
      case '--help':
        showHelp()
        process.exit(0)
      case '-v':
      case '--version':
        showVersion()
        process.exit(0)
      case '-i':
      case '--interactive':
        interactive_flag = true
        break
      case '-s':
      case '--scan':
        scan_config_flag = true
        break
      case '-a':
      case '--apply':
        apply_config_flag = true
        break
      case '-f':
      case '--format':
        apply_formatting = true
        break
      case '-d':
      case '--config_dir':
        i++
        config_dir = process.argv[i]
        if (!config_dir || config_dir == '-') {
          console.error('Error: --config_dir requires a directory argument')
          process.exit(1)
        }
        break
      default:
        console.error('Error: unknown argument:', JSON.stringify(arg))
        process.exit(1)
    }
  }
  if (!interactive_flag && !scan_config_flag && !apply_config_flag) {
    console.error('Error: run mode not specified.')
    console.error('Hint: run "nginx-portal --help" to see available options.')
    process.exit(1)
  }
  if (interactive_flag) {
    await modes.interactive()
    return
  }
  if (scan_config_flag) {
    modes.scan_config()
  }
  if (apply_config_flag) {
    modes.apply_config({ apply_formatting })
  }
}

function ask(prompt: string) {
  return new Promise<string>(resolve => {
    let io = createInterface({ input: process.stdin, output: process.stdout })
    io.question(prompt, answer => {
      io.close()
      resolve(answer)
    })
  })
}

export async function main() {
  try {
    await cli()
  } catch (error) {
    showError(error)
    process.exit(1)
  }
}
