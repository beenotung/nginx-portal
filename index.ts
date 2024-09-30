import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'fs'
import { basename, join } from 'path'
import { createInterface } from 'readline'

export type Config = {
  filename: string
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
    if (config.filename == default_filename) {
      line += ` - |`
    } else {
      line += ` ${config.filename} |`
    }
    lines.push(line)
  }
  return lines.join('\n')
}

export function parse_config_list(text: string): Config[] {
  let lines = text
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

    let config: Config = {
      port,
      server_name,
      filename,
    }
    config_list.push(config)
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

export function parse_conf_file(file: string): Config {
  let text = load_file(file).trim()
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
  let filename = basename(file)
  return { filename, server_name, port }
}

export function save_conf_file(args: { dir: string; config: Config }) {
  let { dir, config } = args
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
}
`
  let file = join(dir, config.filename)
  save_file(file, text)
}

function save_file(file: string, text: string) {
  console.log('save file:', file)
  writeFileSync(file, text.trim() + '\n')
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

let config_dir = '/etc/nginx/conf.d'
let draft_dir = 'draft/conf.d'

if (!__filename.endsWith('.js')) {
  config_dir = 'mock/conf.d'
  mkdirSync(config_dir, { recursive: true })
  let sample_list = [
    { server_name: 'jobsdone.hkit.cc', port: 8123 },
    { server_name: 'talent-demand-dynamic.hkit.cc', port: 20080 },
  ]
  for (let config of sample_list) {
    let filename = parse_default_filename(config.server_name)
    let file = join(config_dir, filename)
    if (existsSync(file)) {
      continue
    }
    save_conf_file({
      dir: config_dir,
      config: {
        filename,
        server_name: config.server_name,
        port: config.port,
      },
    })
  }
}

export let modes = {
  scan_config() {
    let config_list = scan_conf_dir(config_dir)
    let text = format_config_list(config_list)
    save_file(config_list_file, text)
  },
  apply_config() {
    let text = load_file(config_list_file)
    let config_list = parse_config_list(text)
    mkdirSync(draft_dir, { recursive: true })
    for (let config of config_list) {
      let src = join(config_dir, config.filename)
      let dest = join(draft_dir, config.filename)
      if (existsSync(src)) {
        copyFileSync(src, dest)
      } else {
        save_conf_file({ dir: draft_dir, config })
      }
      a
    }
  },
}

function showHelp() {
  let { version } = require('./package.json')
  console.log(
    `
nginx-portal v${version}

Usage: nginx-portal [options]

Options:
  -s | --scan           scan nginx configs
  -a | --apply          apply nginx configs
  -i | --interactive    run multiple modes with interactive menu
  -h | --help           show this help message
  -v | --version        show version information

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
    // TODO
    for (;;) {
      console.log(
        `
Select an action:
0. exit
1. scan nginx configs
2. apply nginx configs
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
        case 'apply':
          modes.apply_config()
          break
        default:
          console.error('Error: unknown action')
          break
      }
    }
  }
  if (scan_config_flag) {
    modes.scan_config()
  }
  if (apply_config_flag) {
    modes.apply_config()
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

async function main() {
  await cli()
  // modes.scan_config()
  // modes.apply_config()
}

main().catch(e => {
  showError(e)
  process.exit(1)
})
