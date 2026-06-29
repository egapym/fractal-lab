/**
 * @author Bert Baron
 * @modified
 */

import { calculatePixelOrbitTrap } from './orbitTrap.mjs'
import { BAILOUT_SMOOTH } from './sharedCalculations.mjs'
import { WorkerContext } from './workerContext.mjs'

// Mandelbrot 標準ステップ関数 (z = z² + c)
const MANDELBROT_STEP = (zr, zi, cr, ci) => [zr * zr - zi * zi + cr, 2 * zr * zi + ci]

// スムーズカラーリング計算で繰り返し使う log(2) を定数化（ピクセルごとの再計算を避けるため）
const LOG2 = Math.log(2)
const LOG2_INV = 1 / LOG2

/**
 * 浮動小数点数で Mandelbrot を計算する実装です。
 * 高速ですが、精度はおよそ 58 bit までです。
 */
export class MandelbrotFloat {
  /**
   * @param {WorkerContext} ctx worker の実行コンテキスト
   */
  constructor(ctx) {
    this.ctx = ctx
    this.fractalType = 'mandelbrot' // 既定のフラクタル種別
  }

  async process(task) {
    // タスクからフラクタル種別を受け取る
    this.fractalType = task.fractalType || 'mandelbrot'

    this.max_iter = task.maxIter
    this.max_iter = task.maxIter
    const w = task.w
    const h = task.h
    // z0 が指定されていれば使う
    if (task.z0Real !== undefined && task.z0Imag !== undefined) {
      this.z0Real = task.z0Real
      this.z0Imag = task.z0Imag
    } else {
      this.z0Real = undefined
      this.z0Imag = undefined
    }
    // 脱出半径を受け取る
    this.escapeRadius = task.escapeRadius !== undefined ? task.escapeRadius : 4.0
    // Julia 集合用の固定 c を受け取る
    if (task.fractalType === 'julia') {
      this.juliaRe = task.juliaRe !== undefined ? task.juliaRe : 0.0
      this.juliaIm = task.juliaIm !== undefined ? task.juliaIm : 0.0
    }

    const frameTopLeftFloat = task.frameTopLeft.map((fixed) => fixed.toNumber())
    const frameBottomRightFloat = task.frameBottomRight.map((fixed) => fixed.toNumber())
    const topLeftFloat = [
      frameTopLeftFloat[0] + (task.xOffset * (frameBottomRightFloat[0] - frameTopLeftFloat[0])) / task.frameWidth,
      frameTopLeftFloat[1] + (task.yOffset * (frameBottomRightFloat[1] - frameTopLeftFloat[1])) / task.frameHeight,
    ]
    const bottomRightFloat = [
      frameTopLeftFloat[0] + ((task.xOffset + w) * (frameBottomRightFloat[0] - frameTopLeftFloat[0])) / task.frameWidth,
      frameTopLeftFloat[1] +
        ((task.yOffset + h) * (frameBottomRightFloat[1] - frameTopLeftFloat[1])) / task.frameHeight,
    ]

    const values = new Int32Array(w * h)
    const smooth = task.smooth ? new Uint8ClampedArray(w * h) : null
    const signs = new Int8Array(w * h)
    const zreal = new Float32Array(w * h)
    const zimag = new Float32Array(w * h)
    this.calculate(
      values,
      smooth,
      signs,
      zreal,
      zimag,
      w,
      h,
      topLeftFloat,
      bottomRightFloat,
      task.skipTopLeft,
      task.supersampling,
      task.jobToken,
    )

    // アクティブなパレットが trapSpec を持つ場合のみOrbit trapを計算する
    // (trapSpec がない通常パレットでは計算をスキップしてパフォーマンスを節約)
    let otData = null
    if (task.trapSpec) {
      otData = new Float32Array(w * h)
      this.calculateOrbitTraps(
        otData,
        w,
        h,
        topLeftFloat,
        bottomRightFloat,
        task.trapSpec,
        task.supersampling,
        task.jobToken,
      )
    }

    return {
      type: 'answer',
      task: task,
      values: values,
      smooth: smooth,
      signs: signs,
      zreal: zreal,
      zimag: zimag,
      otData: otData,
    }
  }

  /**
   * Orbit trapデータを全ピクセル分計算する。
   * trapSpec によって形状・モードが決まるため、パレット設定に応じた計算を行う。
   * Julia セット / 標準 Mandelbrot の両方に対応。
   *
   * @param {Float32Array} otData - 出力バッファ (w * h)
   * @param {number}       w
   * @param {number}       h
   * @param {[number,number]} topleft
   * @param {[number,number]} bottomright
   * @param {import('./orbitTrap.mjs').TrapSpec} trapSpec
   * @param {string}       jobToken
   */
  calculateOrbitTraps(otData, w, h, topleft, bottomright, trapSpec, supersampling, jobToken) {
    const rmin = topleft[0]
    const rmax = bottomright[0]
    const imin = topleft[1]
    const imax = bottomright[1]
    const dr = (rmax - rmin) / w
    const di = (imax - imin) / h
    const isJulia = this.fractalType === 'julia'
    const jRe = isJulia ? (this.juliaRe ?? 0) : 0
    const jIm = isJulia ? (this.juliaIm ?? 0) : 0
    const escapeRadius = this.escapeRadius
    // supersampling=0 は OFF、1 以上なら samples×samples 個のサブサンプルを使う
    const samples = supersampling > 0 ? supersampling : 1
    const sampleStep = 1 / samples
    for (let y = 0; y < h; y++) {
      if (this.ctx.shouldStop(jobToken)) return
      const im = imin + di * y
      for (let x = 0; x < w; x++) {
        const re = rmin + dr * x
        if (samples > 1) {
          // サブピクセルごとの値を平均する
          let sum = 0
          for (let sy = 0; sy < samples; sy++) {
            for (let sx = 0; sx < samples; sx++) {
              const sRe = re + dr * (sx + 0.5) * sampleStep
              const sIm = im + di * (sy + 0.5) * sampleStep
              const cr = isJulia ? jRe : sRe
              const ci = isJulia ? jIm : sIm
              const z0r = isJulia ? sRe : (this.z0Real ?? 0.0)
              const z0i = isJulia ? sIm : (this.z0Imag ?? 0.0)
              sum += calculatePixelOrbitTrap(cr, ci, z0r, z0i, MANDELBROT_STEP, this.max_iter, trapSpec, escapeRadius)
            }
          }
          otData[y * w + x] = sum / (samples * samples)
        } else {
          // Julia は z0 がピクセル座標、Mandelbrot は c がピクセル座標になる
          const cr = isJulia ? jRe : re
          const ci = isJulia ? jIm : im
          const z0r = isJulia ? re : (this.z0Real ?? 0.0)
          const z0i = isJulia ? im : (this.z0Imag ?? 0.0)
          otData[y * w + x] = calculatePixelOrbitTrap(
            cr,
            ci,
            z0r,
            z0i,
            MANDELBROT_STEP,
            this.max_iter,
            trapSpec,
            escapeRadius,
          )
        }
      }
    }
  }

  /**
   * @param {Int32Array} values
   * @param {Uint8ClampedArray|null} smooth
   * @param {Int8Array} signs
   * @param {number} w
   * @param {number} h
   * @param {[number, number]} topleft
   * @param {[number, number]} bottomright
   * @param {boolean} skipTopLeft
   * @param {boolean} supersampling
   * @param {string} jobToken
   */
  calculate(values, smooth, signs, zreal, zimag, w, h, topleft, bottomright, skipTopLeft, supersampling, jobToken) {
    const rmin = topleft[0]
    const rmax = bottomright[0]
    const imin = topleft[1]
    const imax = bottomright[1]
    const dr = (rmax - rmin) / w
    const di = (imax - imin) / h
    for (let y = 0; y < h; y++) {
      if (this.ctx.shouldStop(jobToken)) {
        return
      }
      const im = imin + di * y
      if (skipTopLeft && y % 2 === 0) {
        for (let x = 1; x < w; x += 2) {
          this.calculatePixel(y, w, x, rmin, dr, di, im, values, smooth, signs, zreal, zimag, supersampling)
        }
      } else {
        for (let x = 0; x < w; x++) {
          this.calculatePixel(y, w, x, rmin, dr, di, im, values, smooth, signs, zreal, zimag, supersampling)
        }
      }
    }
  }

  /**
   *
   * @param {number} y
   * @param {number} w
   * @param {number} x
   * @param {number} rmin
   * @param {number} dr
   * @param {number} di
   * @param {number} im
   * @param {Int32Array} values
   * @param {Uint8ClampedArray|null} smooth
   * @param {Int8Array} signs - 脱出時の z の符号情報。0=集合内, 1=同符号, 2=異符号
   * @param {number} supersampling - 0=OFF, 2=2x2, 3=3x3, 4=4x4
   */
  calculatePixel(y, w, x, rmin, dr, di, im, values, smooth, signs, zreal, zimag, supersampling) {
    const offset = y * w + x
    const re = rmin + dr * x

    // Julia 集合ではピクセル座標を z0 とし、c は固定値を使う
    if (this.fractalType === 'julia') {
      if (supersampling > 0) {
        const samples = supersampling
        let totalIter = 0
        let totalNu = 0
        let sampleCount = 0
        let capturedSign = 0
        for (let sy = 0; sy < samples; sy++) {
          for (let sx = 0; sx < samples; sx++) {
            const sampleRe = re + (dr * (sx + 0.5)) / samples
            const sampleIm = im + (di * (sy + 0.5)) / samples
            if (smooth) {
              let [iter, zq, zrE, ziE] = this.juliaIterate(sampleRe, sampleIm, this.max_iter, BAILOUT_SMOOTH)
              let nu = 1
              if (iter > 3) {
                const log_zn = Math.log(zq) / 2
                nu = Math.log(log_zn * LOG2_INV) * LOG2_INV
                iter = Math.floor(iter + 1 - nu)
                nu = nu - Math.floor(nu)
              }
              totalIter += iter
              totalNu += nu
              if (sy === 0 && sx === 0) capturedSign = iter >= 4 ? (zrE >= 0 === ziE >= 0 ? 1 : 2) : 0
            } else {
              const [si, , sr, si2] = this.juliaIterate(
                sampleRe,
                sampleIm,
                this.max_iter,
                this.escapeRadius * this.escapeRadius,
              )
              totalIter += si
              if (sy === 0 && sx === 0) capturedSign = si >= 4 ? (sr >= 0 === si2 >= 0 ? 1 : 2) : 0
            }
            sampleCount++
          }
        }
        values[offset] = Math.round(totalIter / sampleCount)
        signs[offset] = capturedSign
        if (smooth) smooth[offset] = Math.round(255 - 255 * (totalNu / sampleCount))
      } else {
        if (smooth) {
          let [iter, zq, zrE, ziE] = this.juliaIterate(re, im, this.max_iter, BAILOUT_SMOOTH)
          let nu = 1
          if (iter > 3) {
            const log_zn = Math.log(zq) / 2
            nu = Math.log(log_zn * LOG2_INV) * LOG2_INV
            iter = Math.floor(iter + 1 - nu)
            nu = nu - Math.floor(nu)
          }
          smooth[offset] = Math.floor(255 - 255 * nu)
          values[offset] = iter
          signs[offset] = iter >= 4 ? (zrE >= 0 === ziE >= 0 ? 1 : 2) : 0
          zreal[offset] = zrE
          zimag[offset] = ziE
        } else {
          const [rawIter, _zqE, zrE, ziE] = this.juliaIterate(
            re,
            im,
            this.max_iter,
            this.escapeRadius * this.escapeRadius,
          )
          values[offset] = rawIter
          signs[offset] = rawIter >= 4 ? (zrE >= 0 === ziE >= 0 ? 1 : 2) : 0
          zreal[offset] = zrE
          zimag[offset] = ziE
        }
      }
      return
    }

    if (supersampling > 0) {
      // supersampling x supersampling samples per pixel
      const samples = supersampling
      let totalIter = 0
      let totalNu = 0
      let sampleCount = 0
      let capturedSign = 0

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          // Sample at subpixel centers: (0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)
          const offsetX = (sx + 0.5) / samples
          const offsetY = (sy + 0.5) / samples
          const sampleRe = re + dr * offsetX
          const sampleIm = im + di * offsetY

          if (smooth) {
            let [iter, zq, zrE, ziE] = this.mandelbrot(sampleRe, sampleIm, this.max_iter, BAILOUT_SMOOTH)
            let nu = 1
            if (iter > 3) {
              const log_zn = Math.log(zq) / 2
              nu = Math.log(log_zn * LOG2_INV) * LOG2_INV
              iter = Math.floor(iter + 1 - nu)
              nu = nu - Math.floor(nu)
            }
            totalIter += iter
            totalNu += nu
            if (sy === 0 && sx === 0) capturedSign = iter >= 4 ? (zrE >= 0 === ziE >= 0 ? 1 : 2) : 0
          } else {
            const [si, , sr, si2] = this.mandelbrot(
              sampleRe,
              sampleIm,
              this.max_iter,
              this.escapeRadius * this.escapeRadius,
            )
            totalIter += si
            if (sy === 0 && sx === 0) capturedSign = si >= 4 ? (sr >= 0 === si2 >= 0 ? 1 : 2) : 0
          }
          sampleCount++
        }
      }

      values[offset] = Math.round(totalIter / sampleCount)
      signs[offset] = capturedSign
      if (smooth) {
        smooth[offset] = Math.round(255 - 255 * (totalNu / sampleCount))
      }
    } else {
      // Normal single sample
      if (smooth) {
        let [iter, zq, zrE, ziE] = this.mandelbrot(re, im, this.max_iter, BAILOUT_SMOOTH)
        let nu = 1
        if (iter > 3) {
          const log_zn = Math.log(zq) / 2
          nu = Math.log(log_zn * LOG2_INV) * LOG2_INV
          iter = Math.floor(iter + 1 - nu)
          nu = nu - Math.floor(nu)
        }
        smooth[offset] = Math.floor(255 - 255 * nu)
        values[offset] = iter
        signs[offset] = iter >= 4 ? (zrE >= 0 === ziE >= 0 ? 1 : 2) : 0
        zreal[offset] = zrE
        zimag[offset] = ziE
      } else {
        const [rawIter, _zqE, zrE, ziE] = this.mandelbrot(re, im, this.max_iter, this.escapeRadius * this.escapeRadius)
        values[offset] = rawIter
        signs[offset] = rawIter >= 4 ? (zrE >= 0 === ziE >= 0 ? 1 : 2) : 0
        zreal[offset] = zrE
        zimag[offset] = ziE
      }
    }
  }

  /**
   * @param {number} re
   * @param {number} im
   * @param {number} max_iter
   * @param {number} bailout
   * @returns {(number|number)[]|number[]}
   */
  /**
   * Julia set iteration: z0 = (z0re, z0im), c fixed at this.juliaRe/Im
   * @param {number} z0re - starting real part (pixel position)
   * @param {number} z0im - starting imaginary part (pixel position)
   * @param {number} max_iter
   * @param {number} bailout
   * @returns {[number, number]}
   */
  juliaIterate(z0re, z0im, max_iter, bailout) {
    const cRe = this.juliaRe
    const cIm = this.juliaIm
    let zr = z0re
    let zi = z0im
    let iter = -1
    let zrq = zr * zr
    let ziq = zi * zi
    let zq = zrq + ziq
    while (zq <= bailout) {
      zi = 2 * zr * zi + cIm
      zr = zrq - ziq + cRe
      if (iter++ === max_iter) {
        return [2, 0, 0, 0]
      }
      zrq = zr * zr
      ziq = zi * zi
      zq = zrq + ziq
    }
    return [iter + 4, zq, zr, zi]
  }

  mandelbrot(re, im, max_iter, bailout) {
    // Initialize z from provided z0 if present (for custom initial z support)
    let zr = this.z0Real !== undefined ? this.z0Real : 0.0
    let zi = this.z0Imag !== undefined ? this.z0Imag : 0.0
    let iter = -1
    // z0 != (0,0) の場合も正しく初期化する（バグ修正: 以前は常に 0 で初期化していたため
    // 第1反復目の zr 計算が zr = 0 - 0 + re = re になっていた）
    let zrq = zr * zr
    let ziq = zi * zi
    let zq = zrq + ziq
    while (zq <= bailout) {
      zi = 2 * zr * zi + im
      zr = zrq - ziq + re
      if (iter++ === max_iter) {
        return [2, 0, 0, 0]
      }
      zrq = zr * zr
      ziq = zi * zi
      zq = zrq + ziq
    }
    return [iter + 4, zq, zr, zi]
  }
}
