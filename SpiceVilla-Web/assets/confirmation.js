(() => {
    const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const safe = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);

    document.addEventListener('DOMContentLoaded', async () => {
        const status = document.getElementById('confirmationStatus');
        const id = Number(new URLSearchParams(window.location.search).get('id'));
        if (!Number.isSafeInteger(id) || id < 1) {
            status.textContent = 'This order confirmation link is invalid.';
            status.classList.add('is-error');
            return;
        }
        try {
            const result = await window.SpiceVillaAPI.request(`/api/orders/${id}`);
            const order = result.order;
            document.getElementById('confirmationIntro').textContent = `Order ${order.order_number} has been saved. You can follow its progress from your customer account.`;
            document.getElementById('confirmationMeta').textContent = `${order.order_type} · ${order.status} · ${new Date(order.created_at).toLocaleString('en-IN')}`;
            document.getElementById('confirmationItems').innerHTML = (order.items || []).map((item) => `
                <li><span>${safe(item.name)} × ${Number(item.qty)}</span><strong>${money(item.line_total)}</strong></li>
            `).join('') || '<li>Your order does not contain any items.</li>';
            document.getElementById('confirmationTotal').textContent = money(order.total);
            document.getElementById('confirmationPayment').textContent = `Payment: ${order.payment_method}. Payment is not processed online; the restaurant will confirm payment.`;
            document.getElementById('confirmationContent').hidden = false;
            status.hidden = true;
        } catch (error) {
            status.textContent = error.status === 401
                ? 'Sign in with the customer account used for this order to view its confirmation.'
                : error.message;
            status.classList.add('is-error');
        }
    });
})();
