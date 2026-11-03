// Small fetch helper shared by the newer screens. Errors carry the server's message and code.
export const api = async (url, { method = 'GET', body } = {}) => {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const err = new Error(data?.error?.message || 'Request failed.'); err.code = data?.error?.code; err.status = response.status; throw err; }
  return data;
};
export const rupees = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// Multipart upload (photos). Do not set Content-Type: the browser adds the boundary.
export const upload = async (url, files, field = 'files') => {
  const form = new FormData();
  for (const f of files) form.append(field, f);
  const response = await fetch(url, { method: 'POST', body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const err = new Error(data?.error?.message || 'Upload failed.'); err.code = data?.error?.code; err.status = response.status; throw err; }
  return data;
};
