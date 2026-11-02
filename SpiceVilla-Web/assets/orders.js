(() => {
    const api = window.SpiceVillaAPI;
    const CART_KEY = 'spiceCart';
    const transitions = {
        New: ['Accepted', 'Accept order'],
        Accepted: ['Preparing', 'Start preparing'],
        Preparing: ['Ready', 'Mark ready'],
        Ready: ['Completed', 'Complete order']
    };
    let orderRequestKey = createRequestKey();
    let kitchenFilter = 'Active';

    const safe = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
    const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const dateText = (value) => {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    };

    function createRequestKey() {
        return window.crypto && window.crypto.randomUUID
            ? window.crypto.randomUUID()
            : `customer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    function readCart() {
        try {
            const value = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
            return Array.isArray(value) ? value.filter((item) => item && Number(item.id) > 0 && Number(item.qty) > 0) : [];
        } catch {
            return [];
        }
    }

    function setStatus(node, message, error = false) {
        if (!node) return;
        node.textContent = message;
        node.classList.toggle('is-error', error);
        node.hidden = false;
    }

    async function run(action) {
        try {
            await action();
        } catch (error) {
            const status = document.getElementById('pageStatus')
                || document.getElementById('customerOrderStatus');
            if (status) setStatus(status, error.message, true);
            else console.error(error);
        }
    }

    function renderCart() {
        const list = document.getElementById('cartItems');
        const totalNode = document.getElementById('cartTotal');
        const placeButton = document.getElementById('placeOrderButton');
        if (!list || !totalNode || !placeButton) return;
        const cart = readCart();
        const total = cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
        list.innerHTML = cart.length ? cart.map((item) => `
            <div class="cart-order-line">
                <span>${safe(item.name)}<small> · ${money(item.price)} each</small></span>
                <span class="cart-line-actions"><button type="button" data-cart-change="${Number(item.id)}" data-amount="-1" aria-label="Remove one ${safe(item.name)}">−</button><b>${Number(item.qty)}</b><button type="button" data-cart-change="${Number(item.id)}" data-amount="1" aria-label="Add one ${safe(item.name)}">+</button><button type="button" data-cart-remove="${Number(item.id)}" aria-label="Remove ${safe(item.name)} from cart">Remove</button></span>
                <strong>${money(Number(item.price) * Number(item.qty))}</strong>
            </div>`).join('') : '<p class="cart-empty">Your cart is empty. Browse the menu to add dishes.</p>';
        totalNode.textContent = money(total);
        placeButton.disabled = cart.length === 0;
    }

    function renderCustomerOrders(orders) {
        const activeOrder = orders.find((order) => !['Completed', 'Cancelled'].includes(order.status)) || orders[0];
        const number = document.getElementById('customerCurrentOrderNumber');
        if (!number) return;
        const statusNode = document.getElementById('customerOrderStatus');
        const itemRows = document.getElementById('customerOrderItems');
        const currentStatus = document.getElementById('customerCurrentOrderStatus');
        const currentAmount = document.getElementById('customerCurrentOrderAmount');
        const currentEta = document.getElementById('customerCurrentOrderEta');
        if (!activeOrder) {
            number.textContent = '—';
            currentStatus.textContent = 'No active order';
            currentAmount.textContent = '₹0';
            currentEta.textContent = '—';
            itemRows.innerHTML = '<tr><td colspan="4">Your orders will appear here after you place one.</td></tr>';
            statusNode.hidden = true;
        } else {
            const timeline = {
                New: 'Your order has been sent to the restaurant.',
                Accepted: 'The restaurant accepted your order.',
                Preparing: 'Your dishes are being prepared.',
                Ready: 'Your order is ready.',
                Completed: 'This order is complete.',
                Cancelled: 'This order was cancelled.'
            };
            number.textContent = activeOrder.order_number;
            currentStatus.textContent = activeOrder.status;
            currentAmount.textContent = money(activeOrder.total);
            currentEta.textContent = activeOrder.status === 'Ready' ? 'Ready' : activeOrder.status === 'Completed' ? 'Done' : activeOrder.status === 'Cancelled' ? 'Cancelled' : 'In progress';
            itemRows.innerHTML = (activeOrder.items || []).map((item) => `
                <tr><td>${safe(item.name)}</td><td>${Number(item.qty)}</td><td>${money(item.line_total)}</td><td><span class="badge">${safe(activeOrder.status)}</span></td></tr>`).join('')
                || '<tr><td colspan="4">No items in this order.</td></tr>';
            setStatus(statusNode, `${activeOrder.order_number} · ${activeOrder.status} · ${timeline[activeOrder.status] || 'Status updated.'}`);
        }
        const history = document.getElementById('customerOrderHistory');
        if (history) {
            history.innerHTML = orders.length ? orders.map((order) => `
                <tr><td>${safe(order.order_number)}</td><td>${safe(dateText(order.created_at))}</td><td>${safe(order.order_type)}</td><td>${money(order.total)}</td>
                <td><span class="management-actions"><span class="management-status">${safe(order.status)}</span><button class="btn btn-primary" type="button" data-reorder="${Number(order.id)}">Reorder</button></span></td></tr>`).join('')
                : '<tr><td colspan="5">No previous orders.</td></tr>';
        }
        if (history) {
            history.onclick = (event) => {
                const button = event.target.closest('[data-reorder]');
                if (!button) return;
                const order = orders.find((item) => Number(item.id) === Number(button.dataset.reorder));
                if (!order) return;
                const cart = readCart();
                for (const item of order.items || []) {
                    const existing = cart.find((entry) => Number(entry.id) === Number(item.food_id));
                    if (existing) existing.qty += Number(item.qty);
                    else if (item.food_id) cart.push({ id: Number(item.food_id), name: item.name, price: Number(item.price), qty: Number(item.qty) });
                }
                localStorage.setItem(CART_KEY, JSON.stringify(cart));
                window.location.hash = 'cart';
                renderCart();
                setStatus(statusNode, 'Items from your previous order were added to your cart.');
            };
        }
    }

    async function loadCustomerOrders() {
        try {
            const result = await api.request('/api/orders');
            renderCustomerOrders(result.orders);
        } catch (error) {
            if (error.status === 401) {
                renderCustomerOrders([]);
                setStatus(document.getElementById('customerOrderStatus'), 'Sign in to track your orders and view order history.');
            } else {
                setStatus(document.getElementById('customerOrderStatus'), error.message, true);
                throw error;
            }
        }
    }

    async function loadCustomerBills() {
        const list = document.getElementById('customerBillsList');
        if (!list) return;
        try {
            const result = await api.request('/api/bills');
            list.innerHTML = result.bills.length ? result.bills.map((bill) => `
                <article class="customer-bill-card"><div class="customer-bill-heading"><div><strong>${safe(bill.invoice_number)}</strong><span>Order ${safe(bill.order_number)} · ${safe(bill.order_type)}</span></div>
                <span class="bill-payment-status ${Number(bill.paid_amount) >= Number(bill.total) ? 'is-paid' : ''}">${Number(bill.paid_amount) >= Number(bill.total) ? 'Paid' : 'Unpaid'}</span></div>
                <div class="customer-bill-tax"><span>Subtotal <b>${money(bill.subtotal)}</b></span><span>Discount <b>${money(bill.discount_amount)}</b></span><span>CGST <b>${money(bill.cgst)}</b></span><span>SGST <b>${money(bill.sgst)}</b></span></div>
                <div class="customer-bill-total"><span>Invoice total</span><strong>${money(bill.total)}</strong></div>
                <a class="btn btn-primary" href="invoice.html?id=${Number(bill.id)}">View invoice</a></article>`).join('')
                : '<div class="incoming-empty"><strong>No invoices yet</strong><span>Your invoices will appear here after the restaurant issues them.</span></div>';
            const count = document.getElementById('customerBillCount');
            if (count) count.textContent = `${result.bills.length} ${result.bills.length === 1 ? 'bill' : 'bills'}`;
        } catch (error) {
            list.innerHTML = `<div class="incoming-empty"><strong>${safe(error.status === 401 ? 'Sign in to view your bills' : 'Bills could not be loaded')}</strong><span>${safe(error.message)}</span></div>`;
        }
    }

    async function placeOrder(event) {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;
        const cart = readCart();
        if (!cart.length) return;
        const button = document.getElementById('placeOrderButton');
        const statusNode = document.getElementById('customerOrderStatus');
        button.disabled = true;
        try {
            const result = await api.request('/api/orders', {
                method: 'POST',
                body: {
                    idempotency_key: orderRequestKey,
                    customer_name: document.getElementById('orderCustomer').value.trim(),
                    order_type: document.getElementById('orderType').value,
                    payment_method: document.getElementById('orderPayment').value === 'Pay at restaurant'
                        ? 'Pay at restaurant' : document.getElementById('orderPayment').value.replace(' (demo)', ''),
                    items: cart.map((item) => ({ food_id: Number(item.id), quantity: Number(item.qty) }))
                }
            });
            localStorage.removeItem(CART_KEY);
            orderRequestKey = createRequestKey();
            renderCart();
            window.location.assign(`confirmation.html?id=${Number(result.order.id)}`);
        } catch (error) {
            setStatus(statusNode, error.status === 401
                ? 'Sign in or create a customer account before placing an order.'
                : error.message, true);
        } finally {
            button.disabled = readCart().length === 0;
        }
    }

    async function saveCustomerProfile(event) {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            const result = await api.request('/api/profile', {
                method: 'PATCH',
                body: {
                    name: form.elements.name.value.trim(),
                    phone: form.elements.phone.value.trim(),
                    address: form.elements.address.value.trim()
                }
            });
            document.querySelectorAll('[data-customer-name]').forEach((node) => { node.textContent = result.user.name; });
            setStatus(document.getElementById('pageStatus'), 'Your profile was saved.');
        } catch (error) {
            setStatus(document.getElementById('pageStatus'), error.message, true);
        } finally {
            button.disabled = false;
        }
    }

    async function loadProfile() {
        const form = document.getElementById('customerProfileForm');
        if (!form) return;
        try {
            const result = await api.request('/api/profile');
            form.elements.name.value = result.user.name || '';
            form.elements.email.value = result.user.email || '';
            form.elements.phone.value = result.user.phone || '';
            form.elements.address.value = result.user.address || '';
            form.hidden = false;
        } catch (error) {
            form.hidden = true;
            if (error.status === 401) {
                const profileStatus = document.getElementById('profileStatus');
                setStatus(profileStatus, 'Sign in or create an account to save your profile and address.');
            } else {
                setStatus(document.getElementById('pageStatus'), error.message, true);
            }
        }
    }

    function cartActions() {
        const list = document.getElementById('cartItems');
        if (!list) return;
        list.addEventListener('click', (event) => {
            const change = event.target.closest('[data-cart-change]');
            const remove = event.target.closest('[data-cart-remove]');
            const id = Number(change ? change.dataset.cartChange : remove && remove.dataset.cartRemove);
            if (!id) return;
            let cart = readCart();
            if (remove) cart = cart.filter((item) => Number(item.id) !== id);
            else {
                const item = cart.find((entry) => Number(entry.id) === id);
                if (!item) return;
                item.qty += Number(change.dataset.amount);
                if (item.qty <= 0) cart = cart.filter((entry) => Number(entry.id) !== id);
            }
            localStorage.setItem(CART_KEY, JSON.stringify(cart));
            renderCart();
        });
    }

    async function loadOwner() {
        const [dashboard, orderResult, billResult] = await Promise.all([
            api.request('/api/dashboard'),
            api.request('/api/orders'),
            api.request('/api/bills')
        ]);
        document.getElementById('ownerTodayRevenue').textContent = money(dashboard.today.revenue);
        document.getElementById('ownerTodayOrders').textContent = String(dashboard.today.orders);
        document.getElementById('ownerAverageOrder').textContent = money(dashboard.all_time.average_order);
        document.getElementById('ownerPendingOrders').textContent = String(dashboard.today.pending_orders);
        const best = dashboard.best_sellers[0];
        document.getElementById('ownerBestSeller').textContent = best ? best.name : '—';
        document.getElementById('ownerBestSellerCount').textContent = best ? String(best.quantity) : '0';
        const orders = orderResult.orders;
        const newCount = orders.filter((order) => order.status === 'New').length;
        const count = document.getElementById('incomingOrderCount');
        count.textContent = `${newCount} new`;
        count.classList.toggle('has-new-orders', newCount > 0);
        const incoming = orders.filter((order) => !['Completed', 'Cancelled'].includes(order.status));
        document.getElementById('incomingOrders').innerHTML = incoming.length ? incoming.map((order) => {
            const next = transitions[order.status];
            return `<article class="incoming-order${order.status === 'New' ? ' is-new' : ''}">
                <div class="incoming-order-head"><div><span class="incoming-order-id">Order ${safe(order.order_number)}</span><span class="incoming-order-time">${safe(dateText(order.created_at))}</span></div><span class="incoming-order-status">${safe(order.status)}</span></div>
                <div class="incoming-order-meta"><strong>${safe(order.customer_name)}</strong><span>${safe(order.order_type)} · ${safe(order.payment_method)}</span></div>
                <ul>${(order.items || []).map((item) => `<li>${safe(item.name)} <span>× ${Number(item.qty)}</span></li>`).join('')}</ul>
                <div class="incoming-order-foot"><strong>${money(order.total)}</strong>${next ? `<button class="btn btn-primary" type="button" data-owner-order="${Number(order.id)}" data-next-status="${safe(next[0])}">${safe(next[1])}</button>` : ''}</div>
            </article>`;
        }).join('') : '<div class="incoming-empty"><strong>No active orders</strong><span>Customer and POS orders appear here.</span></div>';
        document.getElementById('ownerRecentOrders').innerHTML = dashboard.recent_orders.length ? dashboard.recent_orders.map((order) => `
            <tr><td>${safe(order.order_number)}</td><td>${safe(order.customer_name)}</td><td>—</td><td>—</td><td>${money(order.total)}</td><td>—</td><td><span class="badge">${safe(order.status)}</span></td></tr>`).join('')
            : '<tr><td colspan="7">No orders have been placed.</td></tr>';
        renderOwnerBills(billResult.bills);
    }

    function renderOwnerBills(bills) {
        const paid = bills.filter((bill) => Number(bill.paid_amount) >= Number(bill.total));
        const unpaid = bills.filter((bill) => Number(bill.paid_amount) < Number(bill.total));
        document.getElementById('ownerBillCount').textContent = String(bills.length);
        document.getElementById('ownerUnpaidTotal').textContent = money(unpaid.reduce((sum, bill) => sum + Number(bill.total) - Number(bill.paid_amount || 0), 0));
        document.getElementById('ownerPaidTotal').textContent = money(paid.reduce((sum, bill) => sum + Number(bill.paid_amount || 0), 0));
        document.getElementById('ownerBillsList').innerHTML = bills.length ? bills.slice(0, 10).map((bill) => `
            <tr><td>${safe(bill.invoice_number)}</td><td>${safe(bill.order_number)}</td><td>${safe(bill.customer_name)}</td><td>Order ${safe(bill.order_number)}</td>
            <td>${money(bill.subtotal)}</td><td>${money(Number(bill.cgst) + Number(bill.sgst))}</td><td>${money(bill.total)}</td>
            <td>${Number(bill.paid_amount) >= Number(bill.total) ? 'Paid' : 'Unpaid'}</td><td><a class="btn btn-primary" href="billing.html">Manage</a></td></tr>`).join('')
            : '<tr><td colspan="9">No invoices yet. Create one from the billing workspace.</td></tr>';
    }

    function setupOwner() {
        const list = document.getElementById('incomingOrders');
        list.addEventListener('click', (event) => {
            const button = event.target.closest('[data-owner-order][data-next-status]');
            if (!button) return;
            void run(async () => {
                await api.request(`/api/orders/${button.dataset.ownerOrder}`, { method: 'PATCH', body: { status: button.dataset.nextStatus } });
                await loadOwner();
            });
        });
        void run(loadOwner);
        window.setInterval(() => { void run(loadOwner); }, 20000);
        window.addEventListener('focus', () => { void run(loadOwner); });
    }

    function renderKitchen(orders) {
        const active = orders.filter((order) => !['Completed', 'Cancelled'].includes(order.status));
        document.getElementById('kitchenActiveCount').textContent = `${active.length} active ${active.length === 1 ? 'ticket' : 'tickets'}`;
        const visible = active.filter((order) => kitchenFilter === 'Active' || order.status === kitchenFilter);
        document.getElementById('kitchenOrders').innerHTML = visible.length ? visible.map((order) => {
            const next = transitions[order.status];
            return `<article class="order-card"><h3>Order ${safe(order.order_number)}</h3>
                <p><b>${safe(order.order_type)}</b> · ${safe(order.customer_name)}${order.table_label ? ` · ${safe(order.table_label)}` : ''}</p>
                <p>Received ${safe(dateText(order.created_at))}</p><span class="kitchen-status">${safe(order.status)}</span>
                <ul>${(order.items || []).map((item) => `<li>${safe(item.name)} × ${Number(item.qty)}</li>`).join('')}</ul>
                ${next ? `<button class="btn btn-primary" type="button" data-kitchen-order="${Number(order.id)}" data-next-status="${safe(next[0])}">${safe(next[1])}</button>` : ''}</article>`;
        }).join('') : `<div class="kitchen-empty">${active.length ? 'No orders in this filter.' : 'No active tickets. New customer and POS orders will show here.'}</div>`;
    }

    async function loadKitchen() {
        const result = await api.request('/api/orders');
        renderKitchen(result.orders);
    }

    function setupKitchen() {
        document.querySelectorAll('[data-kitchen-filter]').forEach((button) => {
            button.addEventListener('click', () => {
                kitchenFilter = button.dataset.kitchenFilter;
                document.querySelectorAll('[data-kitchen-filter]').forEach((filter) => {
                    filter.classList.toggle('active', filter === button);
                    filter.setAttribute('aria-pressed', String(filter === button));
                });
                void run(loadKitchen);
            });
        });
        document.getElementById('kitchenOrders').addEventListener('click', (event) => {
            const button = event.target.closest('[data-kitchen-order][data-next-status]');
            if (!button) return;
            void run(async () => {
                await api.request(`/api/orders/${button.dataset.kitchenOrder}`, { method: 'PATCH', body: { status: button.dataset.nextStatus } });
                await loadKitchen();
            });
        });
        void run(loadKitchen);
        window.setInterval(() => { void run(loadKitchen); }, 15000);
        window.addEventListener('focus', () => { void run(loadKitchen); });
    }

    function initCustomer() {
        renderCart();
        cartActions();
        document.getElementById('placeOrderForm')?.addEventListener('submit', placeOrder);
        document.getElementById('customerProfileForm')?.addEventListener('submit', saveCustomerProfile);
        document.getElementById('dismissCartMigration')?.addEventListener('click', () => {
            if (!window.confirm('Remove the saved items that could not be matched to the current menu?')) return;
            localStorage.removeItem('spiceCartUnmatched');
            document.getElementById('cartMigrationStatus').hidden = true;
            document.getElementById('dismissCartMigration').hidden = true;
        });
        void run(async () => {
            await window.loadFoods();
            let unmatched = [];
            try {
                unmatched = JSON.parse(localStorage.getItem('spiceCartUnmatched') || '[]');
            } catch {
                setStatus(document.getElementById('cartMigrationStatus'),
                    'Some saved cart data could not be read. It has been left in this browser; please check your cart before placing an order.', true);
            }
            renderCart();
            if (unmatched.length) {
                setStatus(document.getElementById('cartMigrationStatus'),
                    `${unmatched.length} saved cart item(s) could not be matched to the current menu. They are preserved in this browser; please add those dishes again from the menu.`);
                document.getElementById('dismissCartMigration').hidden = false;
            }
            await Promise.all([loadCustomerOrders(), loadCustomerBills(), loadProfile()]);
        });
        window.setInterval(() => {
            void run(loadCustomerOrders);
            void loadCustomerBills();
        }, 20000);
    }

    if (document.getElementById('customerLoginForm') === null && document.getElementById('placeOrderForm')) initCustomer();
    if (document.getElementById('incomingOrders')) setupOwner();
    if (document.getElementById('kitchenOrders')) setupKitchen();
})();
