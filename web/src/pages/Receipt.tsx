import { money, when, type Sale } from '../api';
import { useSession } from '../App';

/** 80mm thermal-printer style receipt. Prints on its own via print CSS. */
export function Receipt({ sale }: { sale: Sale }) {
  const { businessName } = useSession();
  return (
    <div>
      <div className="receipt" id="receipt">
        <div className="r-center"><b>{businessName}</b><div>Sales receipt</div></div>
        <div className="r-row"><span>{sale.receipt_no}</span><span>{when(sale.created_at)}</span></div>
        <div className="r-row"><span>Cashier: {sale.cashier}</span></div>
        {sale.customer_name && <div className="r-row"><span>Customer: {sale.customer_name}</span></div>}
        <hr />
        {sale.items.map((i) => (
          <div key={i.product_id}>
            <div>{i.name}</div>
            <div className="r-row"><span>{i.qty} × {money(i.unit_price)}</span><span>{money(i.line_total)}</span></div>
          </div>
        ))}
        <hr />
        <div className="r-row"><span>Subtotal</span><span>{money(sale.subtotal)}</span></div>
        {sale.discount > 0 && <div className="r-row"><span>Discount</span><span>−{money(sale.discount)}</span></div>}
        <div className="r-row r-total"><span>TOTAL</span><span>{money(sale.total)}</span></div>
        <div className="r-row"><span>Paid ({sale.payment_method})</span><span>{money(sale.amount_paid)}</span></div>
        {sale.change_due > 0 && <div className="r-row"><span>Change</span><span>{money(sale.change_due)}</span></div>}
        {sale.status === 'voided' && <div className="r-center r-void">VOIDED — {sale.void_reason}</div>}
        <hr />
        <div className="r-center">Thank you for shopping with us</div>
      </div>
      <div className="row end no-print"><button className="btn btn-primary" onClick={() => window.print()}>Print receipt</button></div>
    </div>
  );
}
