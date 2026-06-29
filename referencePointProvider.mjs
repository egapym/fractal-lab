/**
 * @author Bert Baron
 * @modified
 */

import { mandelbrot_high_precision } from './sharedCalculations.mjs'

/**
 * 現在の参照点では解決できない位置に対して、新しい参照点を計算するクラスです。
 * 将来的には worker で非同期に計算する想定です。
 */
export class ReferencePointProvider {
  constructor() {
    this.referencePoints = []
  }

  /**
   * 次の計算条件で参照点プロバイダを初期化する。
   *
   */
  init(task) {
    this.task = task
    this.unresovolved = []
    this._updateCache(task)
    if (this.referencePoints.length === 0) {
      // 最初の参照点計算を始める
      const idx = Math.floor((task.w * task.h) / 2)
      this._calculateReferencePoint(idx)
    }
  }

  /**
   * 次の参照点を返す。必要なら計算も行う。
   *
   * @returns {Promise<void>}
   */
  async nextReferencePoint() {}

  /**
   * 指定されたインデックスのいずれかに対して、新しい参照点の非同期計算を始められる。
   *
   * @param {number} indices 現在の参照点では解決できない整数インデックス
   */
  unresolvedIndices(indices) {
    for (const element of indices) {
      this.unresovolved.push(element)
    }
  }

  _updateCache(task) {
    if (task.jobId !== this.jobId) {
      this.jobId = task.jobId
      if (this.paramHash !== task.paramHash || this.referencePoints.length === 0 || task.resetCaches) {
        this.paramHash = task.paramHash
        this.referencePoints = []
      } else {
        // ジョブ条件が同じなら、現在の表示範囲内に残る参照点だけを再利用する
        const oldReferencePoints = this.referencePoints
        this.referencePoints = []
        const oldPrecision = this.precision
        const newPrecision = task.precision
        if (newPrecision === oldPrecision) {
          // 暗黙スケールの調整は未対応だが、同一精度の点だけ残す
          for (const ref of oldReferencePoints) {
            if (
              ref.rr >= task.frameTopLeft[0].bigInt &&
              ref.rr <= task.frameBottomRight[0].bigInt &&
              ref.ri >= task.frameTopLeft[1].bigInt &&
              ref.ri <= task.frameBottomRight[1].bigInt
            ) {
              this.referencePoints.push(ref)
            }
          }
        } else {
          console.log(`Clearing caches because precision changed ${oldPrecision} -> ${newPrecision}`)
        }
      }
      this.precision = task.precision
    }
  }

  _calculateReferencePoint(idx) {
    const x = idx % this.task.w
    const y = Math.floor(idx / this.task.w)
    const task = this.task
    const rr = refr + BigInt(Math.trunc((x / w) * cWidth))
    const ri = refi + BigInt(Math.trunc((y / h) * cHeight))
    const maxIter = task.maxIter
    const bailout = task.smooth ? 128 : 4
    const scale = this.task.precision
    const bigScale = BigInt(scale)
    mandelbrot_high_precision(rr, ri, maxIter, bailout, bigScale, scale)

    const [iter, zq, seq] = this.mandelbrot_high_precision(rr, ri, this.max_iter, bailout, bigScale, scale)

    const iterations = seq.length
    const zBuffer = new Float32Array(iterations * 2)
    const zqErrorBoundBuffer = new Float32Array(iterations)

    seq.forEach(([zr, zi, zq], idx) => {
      zBuffer[idx * 2] = zr
      zBuffer[idx * 2 + 1] = zi
      zqErrorBoundBuffer[idx] = zq * 0.000001
    })
    const ref = {
      rr,
      ri,
      iter,
      zq,
      size: zqErrorBoundBuffer.length,
      zBuffer,
      zqErrorBoundBuffer,
    }

    this.referencePoints.push(ref)
  }
}
