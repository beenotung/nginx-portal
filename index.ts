import { execFileSync } from 'child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'fs'
import { basename } from 'path'
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

export function update_conf_file(file: string) {
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

  // look for line: "listen 443 ssl http2; # managed by Certbot"
  //       or line: "listen 443 http2 ssl; # managed by Certbot"
  let has_http2 = lines.some(line => {
    if (!line.startsWith('listen 443 ')) {
      return false
    }
    let parts = line.split(';')[0].split(' ')
    return parts.includes('ssl') && parts.includes('http2')
  })

  // look for lines: "listen 443 ssl; # managed by Certbot"
  let has_ssl = lines.some(line => line.startsWith('listen 443 ssl'))

  if (!has_http2 && has_ssl) {
    let lines = new_text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]
      if (line.trimStart()[0] == '#') {
        continue
      }
      lines[i] = line.replace('listen 443 ssl;', 'listen 443 ssl http2;')
    }
    new_text = lines.join('\n')
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

let config_dir = '/etc/nginx/conf.d'
let draft_dir = 'draft/conf.d'

let bash_file = 'draft/update.sh'

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
    console.log()
    console.log(
      '[message] please update file:',
      config_list_file,
      'to continue',
    )
  },
  apply_config() {
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
    let out = execFileSync('bash', [bash_file]).toString()
    console.log(out.trimEnd())
  },
  async interactive() {
    for (;;) {
      console.log(
        `
Select an action:
0. exit
1. scan nginx configs
2. apply nginx configs
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
        case 'apply':
          modes.apply_config()
          break
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

function is_file_same(a_file: string, b_file: string) {
  let a_text = readFileSync(a_file).toString().trim()
  let b_text = readFileSync(b_file).toString().trim()
  return a_text == b_text
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
    await modes.interactive()
    return
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
