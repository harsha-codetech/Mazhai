// Flood reports live in this browser only. To share them between phones, replace
// loadReports and saveReports with calls to a small backend.
const KEY = 'mazhai.reports.v1';

export function loadReports() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? [];
  } catch {
    return [];
  }
}

/** Returns false if the browser refused to store them (usually a full quota). */
export function saveReports(reports) {
  try {
    localStorage.setItem(KEY, JSON.stringify(reports));
    return true;
  } catch {
    return false;
  }
}

/** Shrinks a photo so a handful of reports fit in localStorage. */
export function shrinkPhoto(file, maxSize = 640) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    image.src = url;
  });
}
