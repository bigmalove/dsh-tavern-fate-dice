// ============================================================================
// demo/build-demo.mjs — 将 demo/*.js 模块化源码零冲突隔离打包进单文件 demo/index.html
// 使得 demo/index.html 无论通过双击 file:// 离线打开还是 HTTP 服务访问均可零依赖秒开！
// ============================================================================

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const demoDir = path.dirname(fileURLToPath(import.meta.url))

function wrapStyleModule(code, globalVarName) {
  const transformed = code
    .replace(/^\s*import\s+[^\n]+\n/gm, '')
    .replace(/export\s+default\s+[^\n;]+;?/g, '')
    .replace(/export\s*\{[^}]*\}\s*;?/g, '')
    .replace(/export\s+(const|let|var|function|class)\s+/g, '$1 ')
  return `const ${globalVarName} = (() => {\n${transformed}\n  return STYLES;\n})();\n`
}

function stripExportsImports(code) {
  return code
    .replace(/^\s*import\s+[^\n]+\n/gm, '')
    .replace(/export\s+(class|function|const)\s+/g, '$1 ')
}

async function build() {
  const [
    template,
    polyhedraSrc,
    audioSrc,
    stylesASrc,
    stylesBSrc,
    stylesCSrc,
    stylesDSrc,
    engineSrc,
    appSrc
  ] = await Promise.all([
    readFile(path.join(demoDir, 'template.html'), 'utf8'),
    readFile(path.join(demoDir, 'polyhedra.js'), 'utf8'),
    readFile(path.join(demoDir, 'audio.js'), 'utf8'),
    readFile(path.join(demoDir, 'styles-a.js'), 'utf8'),
    readFile(path.join(demoDir, 'styles-b.js'), 'utf8'),
    readFile(path.join(demoDir, 'styles-c.js'), 'utf8'),
    readFile(path.join(demoDir, 'styles-d.js'), 'utf8'),
    readFile(path.join(demoDir, 'engine.js'), 'utf8'),
    readFile(path.join(demoDir, 'app.js'), 'utf8')
  ])

  const bundleJs = [
    '(() => {',
    '"use strict";',
    '// --- 1. Polyhedra ---',
    `const { D6_PIPS, getMesh, MESH_LIBRARY } = (() => {\n${stripExportsImports(polyhedraSrc)}\n  return { D6_PIPS, getMesh, MESH_LIBRARY };\n})();`,
    '// --- 2. Procedural Audio ---',
    `const { ProceduralDiceAudio } = (() => {\n${stripExportsImports(audioSrc)}\n  return { ProceduralDiceAudio };\n})();`,
    '// --- 3. 8 Visual Style Modules (Isolated Closures) ---',
    wrapStyleModule(stylesASrc, 'STYLES_A'),
    wrapStyleModule(stylesBSrc, 'STYLES_B'),
    wrapStyleModule(stylesCSrc, 'STYLES_C'),
    wrapStyleModule(stylesDSrc, 'STYLES_D'),
    '// --- 4. 3D Rigid-Body & SoA Particle Engine ---',
    `const { DiceStageEngine } = (() => {\n${stripExportsImports(engineSrc)}\n  return { DiceStageEngine };\n})();`,
    '// --- 5. Interactive Workbench App ---',
    `(() => {\n${stripExportsImports(appSrc)}\n})();`,
    '})();'
  ].join('\n\n')

  // VM 语法级强校验，确保无任何重名标识符或语法错误
  new vm.Script(bundleJs, { filename: 'demo-bundle.js' })

  // 注意防止 </script> 出现在内联脚本字面量中
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
