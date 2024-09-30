import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'

export type Config = {
  file: string
  server_name: string
  port: number
}

export function print_conf_list(config_list: Config[]) {
  console.log(`|  port | server_name |`)
  console.log(`|-------|-------------|`)
  for (let config of config_list) {
    let port = config.port.toString().padStart(5, ' ')
    console.log(`| ${port} | ${config.server_name} |`)
  }
}

export function scan_conf_dir(dir: string): Config[] {
  let filenames = readdirSync(dir)
  return filenames.map(filename => {
    let file = join(dir, filename)
    return scan_conf_file(file)
  })
}

export function scan_conf_file(file: string): Config {
  let text = readFileSync(file).toString().trim()
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
  console.log('write file:', file)
  writeFileSync(file, text.trim() + '\n')
}

async function main() {
  let dir = 'mock/test'
  mkdirSync(dir, { recursive: true })
  // genConf({ dir, server_name: 'jobsdone.hkit.cc', port: 8123 })
  // genConf({ dir, server_name: 'talent-demand-dynamic.hkit.cc', port: 8124 })
  let config_list = scan_conf_dir(dir)
  print_conf_list(config_list)
}

main().catch(e => console.error(e))
