import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { config_dir, save_conf_file, set_config_dir } from '../index'
import { join, resolve } from 'path'

set_config_dir('mock/etc/nginx/conf.d')
mkdirSync(config_dir, { recursive: true })

let pma_dir = resolve('mock/usr/share/phpmyadmin')
mkdirSync(pma_dir, { recursive: true })
if (!existsSync(join(pma_dir, 'index.php'))) {
  writeFileSync(join(pma_dir, 'index.php'), '<?php /* PhpMyAdmin */\n')
}

save_conf_file({
  dir: config_dir,
  config: {
    type: 'port',
    port: 8123,
    server_name: 'jobsdone.hkit.cc',
    filename: 'jobsdone.hkit.cc.conf',
  },
})

save_conf_file({
  dir: config_dir,
  config: {
    type: 'port',
    port: 20080,
    server_name: 'talent-demand-dynamic.hkit.cc',
    filename: 'talent-demand-dynamic.hkit.cc.conf',
  },
})

save_conf_file({
  dir: config_dir,
  config: {
    type: 'root',
    root: '/var/www/html',
    server_name: 'example.com',
    filename: 'example.com.conf',
  },
})

save_conf_file({
  dir: config_dir,
  config: {
    type: 'root',
    root: pma_dir,
    server_name: 'admin.example.com',
    filename: 'admin.example.com.conf',
    auth: 'y',
    fastcgi_pass: 'unix:/run/php/php8.3-fpm.sock',
    path_prefix: '/pma',
  },
})
