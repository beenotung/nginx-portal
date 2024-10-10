import { existsSync, mkdirSync } from 'fs'
import {
  config_dir,
  parse_default_filename,
  save_conf_file,
  set_config_dir,
} from '../index'
import { join } from 'path'

set_config_dir('mock/conf.d')
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
