/*
 * Custom function renderability tests
 *
 * Based on bertbaron/mandelbrot by Bert Baron
 * This file is part of the Mandelbrot Explorer project.
 * Licensed under GPL-3.0. See LICENSE file for details.
 *
 */

import { compileIterationFunction, getParsedExpression } from '../customFunctionParser.mjs'
import { functionPresets } from '../functionPresets.mjs'
import { jsExprToWGSL } from '../wgslCompiler.mjs'

function linspace(a, b, n) {
  const out = []
  if (n === 1) return [(a + b) / 2]
  for (let i = 0; i < n; i++) out.push(a + (i * (b - a)) / (n - 1))
  return out
}

function testRenderability(expr, opts = {}) {
  const {
    grid = 21,
    maxIter = 100,
    bailout = 4,
    xmin = -2,
    xmax = 2,
    z0Real = 0,
    z0Imag = 0,
  } = opts
  // Normalize expression and attempt to compile
  const normalizedExpr = expr.normalize ? expr.normalize('NFKC') : expr
  let compiled
  try {
    compiled = compileIterationFunction(normalizedExpr)
  } catch (e) {
    // console.log(`${expr} : compile FAILED -> ${e.message}`);
    return { expr, compiled: false, renders: false, error: e.message }
  }

  const xs = linspace(xmin, xmax, grid)
  const ys = linspace(xmin, xmax, grid)
  let foundEscape = false
  let foundNonFinite = false
  let runtimeErrors = 0
  outer: for (const cr of xs) {
    for (const ci of ys) {
      // start iteration from preset z0 if provided
      let zR = z0Real,
        zI = z0Imag
      for (let it = 0; it < maxIter; it++) {
        let res
        try {
          res = compiled(zR, zI, cr, ci)
        } catch (e) {
          // runtime error for this probe
          runtimeErrors++
          break
        }
        if ((!Array.isArray(res) && !(res instanceof Float64Array)) || res.length !== 2)
          break
        zR = res[0]
        zI = res[1]
        if (!Number.isFinite(zR) || !Number.isFinite(zI)) {
          foundNonFinite = true
          // treat non-finite as a special case but do not mark as rendering-failure here
          break
        }
        const zq = zR * zR + zI * zI
        if (zq >= bailout) {
          foundEscape = true
          break outer
        }
      }
    }
  }

  // const compiledEmoji = compiled ? "✅" : "❌";
  // const rendersEmoji = foundEscape ? "🟢" : "🔴";
  // const label = expr.length > 40 ? expr : expr.padEnd(40);
  // console.log(`${label} compiled=${compiledEmoji}   renders=${rendersEmoji}   (escape=${foundEscape})`);
  // Per new spec: non-finite occurrences should NOT mark renders as failed.
  const renders = foundEscape || foundNonFinite

  // quick GPU-side WGSL validation for expressions that compiled successfully
  let wgslValid = true
  let wgslError = null
  try {
    const wgsl = jsExprToWGSL(getParsedExpression(normalizedExpr))
    // look for adjacent tokens that would indicate a missing operator
    if (/\)\s+\(/.test(wgsl)) {
      wgslValid = false
      wgslError = 'missing operator between subexpressions'
    }
  } catch (e) {
    wgslValid = false
    wgslError = e.message
  }

  return {
    expr,
    compiled: true,
    renders,
    nonFinite: foundNonFinite,
    runtimeErrors,
    wgslValid,
    wgslError,
  }
}

async function main() {
  const results = []
  // include a couple of expressions that previously triggered GPU bugs
  results.push(testRenderability('sin(Re(z)) + i*cos(Im(z)) + c'))
  results.push(testRenderability('Re(sin(z)) + i*Im(cos(z)) + c'))

  for (const preset of functionPresets) {
    const expr = preset.expr || preset
    const opts = {
      z0Real: preset.z0Real || 0,
      z0Imag: preset.z0Imag || 0,
    }
    results.push(testRenderability(expr, opts))
  }

  console.log('\nSummary:\n')
  for (const r of results) {
    const compiledEmoji = r.compiled ? '✅' : '❌'
    const rendersEmoji = r.renders ? '🟢' : '🔴'
    const wgslEmoji = r.wgslValid ? '✅' : '❌'
    const exprStr = String(r.expr)
    const label = exprStr.length > 60 ? exprStr : exprStr.padEnd(60)
    const nf = r.nonFinite ? ' ⚠️ non-finite' : ''
    const re = r.runtimeErrors ? ` (runtimeErr=${r.runtimeErrors})` : ''
    const wgslMsg = r.wgslValid ? '' : ` WGSL_FAIL:${r.wgslError}`
    console.log(`${label} compiled=${compiledEmoji}   renders=${rendersEmoji}${nf}${re}   wgsl=${wgslEmoji}${wgslMsg}`)
  }

  const compiledCount = results.filter(r => r.compiled).length
  const rendersCount = results.filter(r => r.renders).length
  const total = results.length
  console.log(`\ncompiled:${compiledCount}/${total}, renders:${rendersCount}/${total}`)
}

if (
  import.meta.url === `file://${process.cwd()}/test/customFunctionRenderabilityTests.mjs`
) {
  main()
} else {
  main()
}
