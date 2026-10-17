// Shared hooks so feature modules can react when a city loads without importing app.js.

/** @typedef {{ data: any, city: any, showFile: (path: string) => void }} LoadApi */

/** @type {Array<(api: LoadApi) => void>} */
export const onLoad = [];
