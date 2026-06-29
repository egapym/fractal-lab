/**
 * @author Bert Baron
 * @modified
 */

import * as fxp from './fxp.mjs'

/**
 * スムーズカラーリング用の bailout 値です。
 * 反復回数補間の式に使うため、やや大きめの値を使います。
 */
export const BAILOUT_SMOOTH = 128

/**
 * 通常カラーリング用の bailout 値です。
 * 脱出半径 2 に対応します。
 */
export const BAILOUT_MIN = 0

/**
 * @param {BigInt} re
 * @param {BigInt} im
 * @param {number} max_iter
 * @param {number} bailout
 * @param {BigInt} bigScale
 * @param {number} scale
 * @returns {[number, BigInt, [number, number, zq][]]} [反復回数, zq, 軌道列]。軌道列は [zr, zi, zq] の配列
 */
export function mandelbrot_high_precision(re, im, max_iter, bailout, bigScale, scale) {
  const scale_1 = bigScale - 1n
  // 固定小数点の右シフトを四捨五入方向に丸めるための半値（0.5 ULP）
  // >> bigScale は切り捨てなので、正の二乗値に対して halfBigScale を足すことで
  // 丸め誤差の系統的な偏りを除去し、摂動計算の参照軌道精度を向上させる
  const halfBigScale = 1n << scale_1
  let zr = 0n
  let zi = 0n
  let iter = -1
  let zrq = 0n
  let ziq = 0n
  let zq = 0
  const seq = []
  while (zq <= bailout) {
    if (iter++ === max_iter) {
      return [2, 0, seq]
    }
    zi = ((zr * zi) >> scale_1) + im
    zr = zrq - ziq + re
    // zr*zr は常に非負なので halfBigScale を加算した四捨五入が安全に適用できる
    zrq = (zr * zr + halfBigScale) >> bigScale
    ziq = (zi * zi + halfBigScale) >> bigScale
    const z_real = fxp.toNumber(zr, scale)
    const z_imag = fxp.toNumber(zi, scale)
    zq = z_real * z_real + z_imag * z_imag
    seq.push([z_real, z_imag, zq])
  }
  zi = ((zr * zi) >> scale_1) + im
  zr = zrq - ziq + re
  const z_real = fxp.toNumber(zr, scale)
  const z_imag = fxp.toNumber(zi, scale)
  seq.push([z_real, z_imag, z_real * z_real + z_imag * z_imag])
  return [iter + 4, zq, seq]
}
