// ============================================================================
// demo/build-demo.mjs — 将次世代 WebGL2 HDR 投骰引擎模块化源码打包为单文件 demo/index.html
// 支持双击 file:// 零服务器离线秒开，同时执行 Node VM 语法强校验。
// ============================================================================

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const demoDir = path.dirname(fileURLToPath(import.meta.url))

function stripModuleSyntax(code) {
  return code
    .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"]\s*;?\n?/gm, '')
    .replace(/export\s+(class|function|const)\s+/g, '$1 ')
}

async function build() {
  const [
    template,
    meshesSrc,
    shadersSrc,
    rendererSrc,
    audioSrc,
    choreoSrc,
    appSrc
  ] = await Promise.all([
    readFile(path.join(demoDir, 'template.html'), 'utf8'),
    readFile(path.join(demoDir, 'gl-meshes.js'), 'utf8'),
    readFile(path.join(demoDir, 'gl-shaders.js'), 'utf8'),
    readFile(path.join(demoDir, 'gl-renderer.js'), 'utf8'),
    readFile(path.join(demoDir, 'audio.js'), 'utf8'),
    readFile(path.join(demoDir, 'physics-choreo.js'), 'utf8'),
    readFile(path.join(demoDir, 'app.js'), 'utf8')
  ])

  const bundleJs = [
    '(() => {',
    '"use strict";',
    '// --- 1. Beveled Polyhedra & 4-Channel Normal-Bump Engraved Atlas ---',
    stripModuleSyntax(meshesSrc),
    '// --- 2. WebGL2 (#version 300 es) HDR Shaders ---',
    stripModuleSyntax(shadersSrc),
    '// --- 3. Multi-Pass HDR Renderer (RGBA16F + Dual-Kawase Bloom + ACES) ---',
    stripModuleSyntax(rendererSrc),
    '// --- 4. Spatial Procedural Audio Engine ---',
    stripModuleSyntax(audioSrc),
    '// --- 5. Rigid-Body Exact Quaternion Landing & Cinematic Spring Camera ---',
    stripModuleSyntax(choreoSrc),
    '// --- 6. Interactive Workbench App ---',
    stripModuleSyntax(appSrc),
    '})();'
  ].join('\n\n')

  new vm.Script(bundleJs, { filename: 'fate-dice-webgl2-bundle.js' })

  const safeJs = bundleJs.replace(/<\/script>/gi, '<\\/script>')
  const html = template.replace('<!-- BUILD_BUNDLE_SLOT -->', `<script>\n${safeJs}\n</script>`)
  const outPath = path.join(demoDir, 'index.html')
  await writeFile(outPath, html, 'utf8')
  console.log(`[build-demo] OK -> ${outPath} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`)
}

build().catch(err => {
  console.error(err)
  process.exit(1)
})
