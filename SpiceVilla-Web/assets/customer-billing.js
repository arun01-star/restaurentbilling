(() => {
    const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
    const safe = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
    const dateText = (value) => {
        const date = new Date(value);
        return Number.isNaN(date.getTime())
            ? 'Date unavailable'
            : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    function showMessage(message, error = false) {
        const node = document.getElementById('customerBillingMessage');
        node.textContent = message;
        node.classList.toggle('is-error', error);
        node.hidden = false;
    }

    function renderBills(bills) {
        const total = bills.reduce((sum, bill) => sum + Number(bill.total), 0);
        const paid = bills.reduce((sum, bill) => sum + Math.min(Number(bill.total), Number(bill.paid_amount || 0)), 0);
        const due = Math.max(0, total - paid);
        document.getElementById('customerInvoiceCount').textContent = String(bills.length);
        document.getElementById('customerInvoiceTotal').textContent = money(total);
        document.getElementById('customerInvoicePaid').textContent = money(paid);
        document.getElementById('customerInvoiceDue').textContent = money(due);

        const list = document.getElementById('customerBillingList');
        list.innerHTML = bills.length ? bills.map((bill) => {
            const isPaid = Number(bill.paid_amount || 0) >= Number(bill.total);
            const balance = Math.max(0, Number(bill.total) - Number(bill.paid_amount || 0));
            return `<article class="customer-invoice-card">
                <div class="customer-invoice-identity">
                    <strong>${safe(bill.invoice_number)}</strong>
                    <span>Order ${safe(bill.order_number)} · ${safe(bill.order_type)}</span>
                </div>
                <div class="customer-invoice-data"><span>Issued</span><strong>${safe(dateText(bill.issued_at))}</strong></div>
                <div class="customer-invoice-data"><span>${isPaid ? 'Paid' : 'Balance due'}</span><strong>${money(isPaid ? bill.paid_amount : balance)}</strong></div>
                <span class="customer-invoice-status${isPaid ? ' is-paid' : ''}">${isPaid ? 'Paid' : balance < Number(bill.total) ? 'Partially paid' : 'Unpaid'}</span>
                <a class="btn btn-primary" href="invoice.html?id=${Number(bill.id)}">View invoice</a>
            </article>`;
        }).join('') : '<div class="customer-billing-empty"><strong>No invoices yet</strong>Invoices issued for your orders will appear here.</div>';
        document.getElementById('customerBillingSummary').hidden = false;
        document.getElementById('customerBillingMessage').hidden = true;
    }

    document.addEventListener('DOMContentLoaded', async () => {
        try {
            const profile = await window.SpiceVillaAPI.request('/api/profile');
            if (profile.user.role !== 'customer') {
                showMessage('This billing page is for customer accounts. Open the owner billing workspace from the owner dashboard.', true);
                return;
            }
            document.getElementById('customerBillingSignIn').hidden = true;
            document.getElementById('customerBillingLogout').hidden = false;
            document.getElementById('customerBillingLogout').addEventListener('click', async (event) => {
                event.preventDefault();
                try {
                    await window.SpiceVillaAPI.request('/api/auth/logout', { method: 'POST', body: {} });
                    window.location.replace('login.html');
                } catch (error) {
                    showMessage(error.message, true);
                }
            });
            const result = await window.SpiceVillaAPI.request('/api/bills');
            renderBills(result.bills);
        } catch (error) {
            if (error.status === 401) {
                showMessage('Sign in to view the invoices associated with your customer account.');
            } else {
                showMessage(error.message, true);
            }
        }
    });
})();
