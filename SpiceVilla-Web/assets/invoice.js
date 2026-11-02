(() => {
    const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const safe = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);

    document.addEventListener('DOMContentLoaded', async () => {
        const status = document.getElementById('invoiceStatus');
        const id = Number(new URLSearchParams(window.location.search).get('id'));
        if (!Number.isSafeInteger(id) || id < 1) {
            status.textContent = 'This invoice link is invalid.';
            status.classList.add('is-error');
            return;
        }
        try {
            const result = await window.SpiceVillaAPI.request(`/api/bills/${id}`);
            const bill = result.bill;
            document.title = `${bill.invoice_number} | SpiceVilla`;
            document.getElementById('invoiceNumber').textContent = bill.invoice_number;
            document.getElementById('invoiceDate').textContent = `Issued ${new Date(bill.issued_at).toLocaleString('en-IN')}`;
            document.getElementById('invoiceCustomer').textContent = `Bill to: ${bill.customer_name || 'Customer'}${bill.customer_email ? ` · ${bill.customer_email}` : ''}${bill.customer_phone ? ` · ${bill.customer_phone}` : ''}`;
            document.getElementById('invoiceOrder').textContent = `Order ${bill.order_number} · ${bill.order_type}`;
            document.getElementById('invoiceItems').innerHTML = (bill.items || []).map((item) => `
                <tr><td>${safe(item.name)}</td><td>${Number(item.qty)}</td><td>${money(item.price)}</td><td>${money(item.line_total)}</td></tr>
            `).join('');
            document.getElementById('invoiceTotals').innerHTML = [
                ['Subtotal', bill.subtotal],
                ['Discount', -Number(bill.discount_amount)],
                [`CGST (${Number(bill.cgst_rate).toFixed(2)}%)`, bill.cgst],
                [`SGST (${Number(bill.sgst_rate).toFixed(2)}%)`, bill.sgst],
                ['Invoice total', bill.total]
            ].map(([label, amount], index) => `
                <div class="invoice-total-line ${index === 4 ? 'is-grand' : ''}"><span>${label}</span><strong>${index === 1 && Number(amount) < 0 ? `−${money(-Number(amount))}` : money(amount)}</strong></div>
            `).join('');
            const paid = (bill.payments || []).filter((payment) => payment.status === 'completed')
                .reduce((sum, payment) => sum + Number(payment.amount), 0);
            document.getElementById('invoicePaymentStatus').textContent = `Payment status: ${paid >= Number(bill.total) ? 'Paid' : `Balance due ${money(Number(bill.total) - paid)}`}.`;
            document.getElementById('printInvoice').addEventListener('click', () => window.print());
            document.getElementById('invoiceContent').hidden = false;
            status.hidden = true;
        } catch (error) {
            status.textContent = error.status === 401
                ? 'Sign in to the customer account associated with this invoice.'
                : error.message;
            status.classList.add('is-error');
        }
    });
})();
