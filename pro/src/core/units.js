// Units used throughout the Workbench core.
//
//   geometry   integer database units, 1 DBU = 1 nm, y up
//   PSF radius nm
//   alpha/beta nm (shown as nm / µm)
//   dose       µC/cm²
//   energy     keV

export const DBU_M = 1e-9;          // metres per database unit
export const NM_PER_UM = 1000;

export const umToNm = (um) => um * NM_PER_UM;
export const nmToUm = (nm) => nm / NM_PER_UM;

// Round a length in nm to the integer grid. Geometry is stored as Int32 in nm, which spans
// ±2.147 m: anything a teaching chip (or a wafer) needs.
export const toDbu = (nm) => Math.round(nm);

export const INT32_MAX = 2147483647;

export function assertDbu(v) {
  if (!Number.isInteger(v) || v > INT32_MAX || v < -INT32_MAX - 1) {
    throw new RangeError(`coordinate ${v} is not an int32 nm value`);
  }
  return v;
}
