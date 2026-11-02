(() => {
    let orders = [];
    let bills = [];
    let activeFilter = 'All';
    const money = (amount) => `₹${Number(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const safe = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);

    function showMessage(message, isError = false, node = document.getElementById('billingMessage')) {
        node.textContent = message;
        node.classList.toggle('is-error', isError);
        node.hidden = false;
    }

    function billFor(order) {
        return bills.find((bill) => Number(bill.order_id) === Number(order.id));
    }

    function paymentState(order, bill) {
        if (!bill) return 'Unbilled';
        return Number(bill.paid_amount || 0) >= Number(bill.total) ? 'Paid' : 'Unpaid';
    }

    async function refresh() {
        const [orderResult, billResult] = await Promise.all([
            window.SpiceVillaAPI.request('/api/orders'),
            window.SpiceVillaAPI.request('/api/bills')
        ]);
        orders = orderResult.orders;
        bills = billResult.bills;
        render();
    }

    function render() {
        const paid = bills.filter((bill) => Number(bill.paid_amount || 0) >= Number(bill.total));
        const due = bills.filter((bill) => Number(bill.paid_amount || 0) < Number(bill.total));
        document.getElementById('billingInvoiceCount').textContent = String(bills.length);
        document.getElementById('billingTotal').textContent = money(bills.reduce((sum, bill) => sum + Number(bill.total), 0));
        document.getElementById('billingPaid').textContent = money(paid.reduce((sum, bill) => sum + Number(bill.paid_amount || 0), 0));
        document.getElementById('billingDue').textContent = money(due.reduce((sum, bill) => sum + Number(bill.total) - Number(bill.paid_amount || 0), 0));
        document.getElementById('billingDueCount').textContent = `${due.length} unpaid ${due.length === 1 ? 'invoice' : 'invoices'}`;
        renderRows();
    }

    function renderRows() {
        const query = document.getElementById('billingSearch').value.trim().toLowerCase();
        const rows = orders.filter((order) => {
            const bill = billFor(order);
            const status = paymentState(order, bill);
            if (activeFilter !== 'All' && activeFilter !== status) return false;
            return `${order.order_number} ${order.customer_name || ''} ${bill ? bill.invoice_number : ''} ${order.order_type || ''}`
                .toLowerCase().includes(query);
        });
        document.getElementById('billingResultCount').textContent = `${rows.length} ${rows.length === 1 ? 'record' : 'records'}`;
        const body = document.getElementById('billingRows');
        if (!rows.length) {
            body.innerHTML = '<tr><td class="billing-empty" colspan="7">No billing records match this view. Place an order from POS or adjust your filters.</td></tr>';
            return;
        }
        body.innerHTML = rows.map((order) => {
            const bill = billFor(order);
            const status = paymentState(order, bill);
            const statusClass = status === 'Paid' ? 'is-paid' : status === 'Unbilled' ? 'is-unbilled' : '';
            const date = new Date(bill ? bill.issued_at : order.created_at);
            const formattedDate = Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
            const action = bill
                ? `<button class="btn billing-action-secondary" type="button" data-billing-action="print" data-order-id="${safe(order.id)}">View / Print</button>${status !== 'Paid' ? `<button class="btn btn-primary" type="button" data-billing-action="payment" data-order-id="${safe(order.id)}">Record payment</button>` : ''}`
                : `<button class="btn btn-primary" type="button" data-billing-action="invoice" data-order-id="${safe(order.id)}">Issue invoice</button>`;
            return `<tr>
                <td class="billing-order-cell"><strong>${safe(order.order_number)}</strong><small>${bill ? safe(bill.invoice_number) : 'Invoice not issued'}</small></td>
                <td>${safe(order.customer_name || 'Guest customer')}</td>
                <td>${safe(formattedDate)}</td>
                <td>${safe(order.order_type || 'Takeaway')}</td>
                <td><strong>${money(bill ? bill.total : order.total)}</strong></td>
                <td><span class="billing-status ${statusClass}">${safe(status)}</span></td>
                <td><span class="billing-actions">${action}</span></td>
            </tr>`;
        }).join('');
    }

    function openInvoiceDialog(order) {
        const form = document.getElementById('invoiceForm');
        form.elements.order_id.value = order.id;
        form.elements.discount.value = '0';
        form.querySelector('.billing-dialog-status').hidden = true;
        document.getElementById('invoiceDialog').showModal();
    }

    function openPaymentDialog(order) {
        const bill = billFor(order);
        if (!bill) return;
        const form = document.getElementById('paymentForm');
        form.elements.bill_id.value = bill.id;
        form.elements.amount.value = (Number(bill.total) - Number(bill.paid_amount || 0)).toFixed(2);
        form.elements.transaction_reference.value = '';
        form.querySelector('.billing-dialog-status').hidden = true;
        document.getElementById('paymentDialog').showModal();
    }

    function printInvoice(order, bill) {
        const printWindow = window.open('', '_blank', 'width=850,height=900');
        if (!printWindow) throw new Error('Allow pop-ups to view or print this invoice.');
        const items = Array.isArray(order.items) ? order.items : [];
        const lines = items.map((item) => `<tr><td>${safe(item.name)}</td><td>${Number(item.qty) || 1}</td><td>${money(item.price)}</td><td>${money(item.line_total)}</td></tr>`).join('');
        const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${safe(bill.invoice_number)} · SpiceVilla</title><style>
            *{box-sizing:border-box}body{max-width:850px;margin:32px auto;padding:24px;color:#243b46;font:14px/1.5 Arial,sans-serif}header{display:flex;justify-content:space-between;gap:20px;padding-bottom:18px;border-bottom:3px solid #1d5e66}.brand{font-size:26px;font-weight:800;color:#1d5e66}.tag{padding:6px 10px;border-radius:20px;background:#e8f4f1;color:#1d5e66;font-weight:bold}h1{color:#172a3a}.details{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:20px 0}.box{padding:14px;border:1px solid #dfe7ea;border-radius:8px}.box strong{display:block;color:#1d5e66}table{width:100%;margin:22px 0;border-collapse:collapse;font-size:12px}th,td{padding:9px 7px;border:1px solid #dfe7ea;text-align:left}th{background:#1d5e66;color:white}.totals{width:min(360px,100%);margin-left:auto}.total{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e7edef}.grand{font-size:18px;font-weight:bold;color:#1d5e66}.note{margin-top:24px;padding:12px;background:#f2f5f7;color:#71818a;font-size:11px}@media print{body{margin:0;padding:12mm}}</style></head><body>
            <header><div><div class="brand">SpiceVilla</div><div>Jabalpur, Madhya Pradesh, India</div><div>GSTIN not configured (demo)</div></div><div style="text-align:right"><span class="tag">GST INVOICE · DEMO</span><p>${safe(bill.invoice_number)}<br>${new Date(bill.issued_at).toLocaleDateString('en-IN')}</p></div></header>
            <h1>Tax Invoice</h1><div class="details"><div class="box"><strong>Bill to</strong>${safe(order.customer_name)}<br>${safe(order.customer_email || '')}<br>${safe(order.customer_phone || '')}</div><div class="box"><strong>Order</strong>${safe(order.order_number)}<br>${safe(order.order_type)} · ${safe(order.payment_method)}<br>Place of supply: Madhya Pradesh</div></div>
            <table><thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Line value</th></tr></thead><tbody>${lines}</tbody></table>
            <div class="totals"><div class="total"><span>Subtotal</span><strong>${money(bill.subtotal)}</strong></div><div class="total"><span>Discount</span><strong>− ${money(bill.discount_amount)}</strong></div><div class="total"><span>CGST @ ${Number(bill.cgst_rate)}%</span><strong>${money(bill.cgst)}</strong></div><div class="total"><span>SGST @ ${Number(bill.sgst_rate)}%</span><strong>${money(bill.sgst)}</strong></div><div class="total grand"><span>Total</span><strong>${money(bill.total)}</strong></div><div class="total"><span>Payment status</span><strong>${Number(bill.paid_amount || 0) >= Number(bill.total) ? 'Paid' : 'Unpaid'}</strong></div></div><p class="note">Demo invoice only. GST registration and rates are not configured. Validate tax rules before production use. No payment is processed.</p><script>window.onload=()=>window.print()</script></body></html>`;
        printWindow.document.write(page);
        printWindow.document.close();
    }

    document.getElementById('billingSearch').addEventListener('input', renderRows);
    document.querySelectorAll('[data-billing-filter]').forEach((button) => {
        button.addEventListener('click', () => {
            activeFilter = button.dataset.billingFilter;
            document.querySelectorAll('[data-billing-filter]').forEach((filterButton) => {
                const selected = filterButton === button;
                filterButton.classList.toggle('active', selected);
                filterButton.setAttribute('aria-pressed', String(selected));
            });
            renderRows();
        });
    });

    document.getElementById('billingRows').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-billing-action][data-order-id]');
        if (!button) return;
        const order = orders.find((item) => Number(item.id) === Number(button.dataset.orderId));
        if (!order) return showMessage('This order is no longer available. Refresh and try again.', true);
        try {
            if (button.dataset.billingAction === 'invoice') openInvoiceDialog(order);
            if (button.dataset.billingAction === 'payment') openPaymentDialog(order);
            if (button.dataset.billingAction === 'print') {
                const bill = billFor(order);
                const [orderResult, billResult] = await Promise.all([
                    window.SpiceVillaAPI.request(`/api/orders/${order.id}`),
                    window.SpiceVillaAPI.request(`/api/bills/${bill.id}`)
                ]);
                printInvoice(orderResult.order, billResult.bill);
            }
        } catch (error) {
            showMessage(error.message, true);
        }
    });

    document.getElementById('invoiceForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('[type="submit"]');
        button.disabled = true;
        try {
            const result = await window.SpiceVillaAPI.request('/api/bills', {
                method: 'POST',
                body: {
                    order_id: Number(form.elements.order_id.value),
                    discount_type: form.elements.discount_type.value,
                    discount: Number(form.elements.discount.value)
                }
            });
            document.getElementById('invoiceDialog').close();
            showMessage(`Invoice ${result.bill.invoice_number} issued.`);
            await refresh();
        } catch (error) {
            showMessage(error.message, true, form.querySelector('.billing-dialog-status'));
        } finally {
            button.disabled = false;
        }
    });

    document.getElementById('paymentForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('[type="submit"]');
        button.disabled = true;
        try {
            const billId = Number(form.elements.bill_id.value);
            const result = await window.SpiceVillaAPI.request(`/api/bills/${billId}/payments`, {
                method: 'POST',
                body: {
                    method: form.elements.method.value,
                    amount: Number(form.elements.amount.value),
                    transaction_reference: form.elements.transaction_reference.value.trim()
                }
            });
            document.getElementById('paymentDialog').close();
            showMessage(result.message);
            await refresh();
        } catch (error) {
            showMessage(error.message, true, form.querySelector('.billing-dialog-status'));
        } finally {
            button.disabled = false;
        }
    });

    document.querySelectorAll('[data-close-dialog]').forEach((button) => {
        button.addEventListener('click', () => document.getElementById(button.dataset.closeDialog).close());
    });

    document.getElementById('refreshBilling').addEventListener('click', async (event) => {
        event.currentTarget.disabled = true;
        try {
            await refresh();
            showMessage('Billing records refreshed.');
        } catch (error) {
            showMessage(error.message, true);
        } finally {
            event.currentTarget.disabled = false;
        }
    });

    window.addEventListener('focus', () => { void refresh().catch((error) => showMessage(error.message, true)); });
    void refresh().catch((error) => showMessage(error.message, true));
    window.setInterval(() => { void refresh().catch((error) => showMessage(error.message, true)); }, 30000);
})();
