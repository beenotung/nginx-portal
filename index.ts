import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'fs'
import { basename, join } from 'path'

export type Config = {
  file: string
  server_name: string
  port: number
}

export function parse_default_filename(server_name: string) {
  return server_name.split(' ')[0].split(',')[0] + '.conf'
}

export function format_config_list(config_list: Config[]): string {
  let lines: string[] = []
  lines.push(`|  port | server_name | filename |`)
  lines.push(`|-------|-------------|----------|`)
  config_list.sort((a, b) => a.port - b.port)
  for (let config of config_list) {
    let port = config.port.toString().padStart(5, ' ')
    let line = `| ${port} | ${config.server_name} |`
    let default_filename = parse_default_filename(config.server_name)
    let filename = basename(config.file)
    if (filename == default_filename) {
      line += ` - |`
    } else {
      line += ` ${filename} |`
    }
    lines.push(line)
  }
  return lines.join('\n')
}

export function parse_config_list(args: {
  dir: string
  text: string
}): Config[] {
  let lines = args.text
    .split('\n')
    .map(line =>
      line
        .split('|')
        .map(col => col.trim())
        .filter(col => col.length > 0),
    )
    .filter(line => line.length > 0)
  let headers = lines.shift()
  if (!headers) {
    throw new Error('missing header line')
  }
  if (
    headers[0]?.toLowerCase() != 'port' ||
    headers[1]?.toLowerCase() != 'server_name' ||
    headers[2]?.toLowerCase() != 'filename'
  ) {
    throw new Error(
      'invalid header, expect: "| port | server_name | filename |"',
    )
  }
  if (lines.length == 0) return []

  // remove separator line
  if (
    lines[0][0]?.startsWith('-') &&
    lines[0][1]?.startsWith('-') &&
    lines[0][2]?.startsWith('-')
  ) {
    lines.shift()
  }

  let config_list: Config[] = []

  for (let cols of lines) {
    let port = +cols[0]
    if (!port) {
      throw new Error('invalid port, got: ' + JSON.stringify(cols[0]))
    }

    let server_name = cols[1]
    if (!server_name) {
      throw new Error('missing server_name, port: ' + port)
    }

    let filename = cols[2]
    if (filename == '-') {
      filename = parse_default_filename(server_name)
    }
    let file = join(args.dir, filename)

    let config: Config = {
      port,
      server_name,
      file,
    }
    config_list.push(config)
  }

  return config_list
}

export function scan_conf_dir(dir: string) {
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

export function parse_conf_file(file: string): Config {
  let text = loadFile(file).trim()
  let lines = text
    .split('\n')
    .map(line => line.split('#')[0].trim())
    .filter(line => line.length > 0)
  let server_name = lines
    .find(line => line.startsWith('server_name '))
    ?.replace('server_name ', '')
    .split(';')[0]
    .trim()
  if (!server_name) {
    throw new Error('server_name not found, file: ' + JSON.stringify(file))
  }
  let port = +lines
    .find(line => line.startsWith('proxy_pass '))
    ?.replace('proxy_pass ', '')
    .split(';')[0]
    .split(':')
    .pop()!
  if (!port) {
    throw new Error('port not found, file: ' + JSON.stringify(file))
  }
  return { file, server_name, port }
}

export function gen_conf_file(config: {
  dir: string
  server_name: string
  port: number
}) {
  let filename = config.server_name.split(',')[0] + '.conf'
  let text = `
server {
  listen 80;
  listen [::]:80;

  server_name ${config.server_name};

  location / {
    proxy_pass http://localhost:${config.port};
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }

  #listen 443 ssl http2; # managed by Certbot
  #listen [::]:443 ssl http2; # managed by Certbot
}
`
  let file = join(config.dir, filename)
  saveFile(file, text)
}

function saveFile(file: string, text: string) {
  console.log('save file:', file)
  writeFileSync(file, text.trim() + '\n')
}

function loadFile(file: string) {
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

export let modes = {
  scan_config(dir: string) {
    let config_list = scan_conf_dir(dir)
    let text = format_config_list(config_list)
    saveFile(config_list_file, text)
  },
  apply_config(dir: string) {
    let text = loadFile(config_list_file)
    let config_list = parse_config_list({ dir, text })
    for (let config of config_list) {
    }
  },
}

async function main() {
  let dir = '/etc/nginx/conf.d'
  if (!__filename.endsWith('.js')) {
    dir = 'mock/conf.d'
    mkdirSync(dir, { recursive: true })
    gen_conf_file({
      dir,
      server_name: 'jobsdone.hkit.cc',
      port: 8123,
    })
    gen_conf_file({
      dir,
      server_name: 'talent-demand-dynamic.hkit.cc',
      port: 8124,
    })
  }
  if (!existsSync(dir)) {
    throw new Error('nginx config directory not found: ' + dir)
  }

  modes.scan_config(dir)
}

main().catch(e => {
  showError(e)
  process.exit(1)
})
