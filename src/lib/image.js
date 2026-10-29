// ضغط الصورة في المتصفح قبل حفظها (الحد الأقصى ~640px و~140KB) كي تبقى سريعة على الموبايل وتُخزَّن مع السجل مباشرة.
export function compressImage(file, { max = 640, quality = 0.75, maxBytes = 140000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) return reject(new Error('اختر ملف صورة'));
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, max / Math.max(img.width, img.height)); const w = Math.round(img.width * k), h = Math.round(img.height * k);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
      let q = quality, out = cv.toDataURL('image/jpeg', q);
      while (out.length * 0.75 > maxBytes && q > 0.4) { q -= 0.1; out = cv.toDataURL('image/jpeg', q); }
      if (out.length * 0.75 > 800000) return reject(new Error('الصورة كبيرة جداً'));
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('تعذّر قراءة الصورة')); };
    img.src = url;
  });
}
