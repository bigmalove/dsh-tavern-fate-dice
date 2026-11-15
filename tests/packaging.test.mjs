import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildFateDiceClient } from '../build.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const read = relative => readFile(path.join(root, relative), 'utf8')

async function exists(relative) {
  try {
    await stat(path.join(root, relative))
    return true
  } catch {
    return false
  }
}

test('没有运行时 npm 依赖：dependencies 必须为空，入口文件齐全', async () => {
  const pkg = JSON.parse(await read('package.json'))
  assert.deepEqual(Object.keys(pkg.dependencies || {}), [], 'dependencies 非空会阻断 DSH Tavern 一键导入')
  assert.equal(pkg.name, 'dsh-tavern-fate-dice')
  assert.ok(pkg.version)
  assert.equal(pkg.exports['.'], './lib/index.js')
  assert.equal(pkg.exports['./client'], './client.js')
  assert.ok(await exists('lib/index.js'))
  assert.ok(await exists('client.js'))
})

test('浏览器侧按 dsh.client 契约声明且 client.js 与源码保持同步', async () => {
  const pkg = JSON.parse(await read('package.json'))
  assert.equal(pkg.dsh?.client?.platform, 'web')
  assert.ok(Array.isArray(pkg.dsh?.client?.inject) && pkg.dsh.client.inject.length > 0)

  const check = await buildFateDiceClient({ check: true })
  assert.equal(check.changed, false, '修改 src/client/main.js 后必须执行 node build.mjs 重新生成 client.js')

  const code = await read('client.js')
  assert.match(code, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(code, /id:\s*['"]dsh-tavern-fate-dice['"]/)
})
