export type Role = 'owner' | 'manager' | 'cashier';
export interface User { id: number; name: string; email: string; role: Role }

export interface Product {
  id: number; sku: string; barcode: string | null; name: string; category_id: number | null; category: string | null;
  unit: string; sell_price: number; cost_price?: number; reorder_level: number; active: number; on_hand: number;
}
export interface Category { id: number; name: string; products: number }
export interface SaleSummary {
  id: number; receipt_no: string; customer_name: string | null; payment_method: string; total: number;
  status: 'completed' | 'voided'; created_at: string; cashier: string; items: number;
}
export interface Sale extends Omit<SaleSummary, 'items'> {
  subtotal: number; discount: number; amount_paid: number; change_due: number; void_reason: string | null;
  voided_by_name: string | null; voided_at: string | null; user_id: number;
  items: { product_id: number; name: string; qty: number; unit_price: number; line_total: number }[];
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: { field: string; message: string }[]) {
    super(message);
  }
}

/** JSON fetch wrapper. The session lives in an HttpOnly cookie, so no token handling here. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(res.status, data?.message ?? `Request failed (${res.status})`, data?.details);
  }
  return data as T;
}

const ngn = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 2 });
const ngnShort = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', notation: 'compact', maximumFractionDigits: 1 });

/** Format kobo as naira. */
export const money = (kobo: number) => ngn.format(kobo / 100);
export const moneyShort = (kobo: number) => ngnShort.format(kobo / 100);
/** Parse a naira string typed by the user into kobo. */
export const toKobo = (naira: string) => Math.round(Number(naira.replace(/[,₦\s]/g, '')) * 100);

/** SQLite UTC timestamp → local display. */
export const when = (sqlUtc: string) =>
  new Date(sqlUtc.replace(' ', 'T') + 'Z').toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
export const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toLocaleDateString('en-CA');
