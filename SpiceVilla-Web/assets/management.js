(() => {
    const api = window.SpiceVillaAPI;
    const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const safe = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
    const state = { orders: [], foods: [], categories: [], payments: [], customers: [], report: null };
    const transitions = {
        New: ['Accepted', 'Accept'],
        Accepted: ['Preparing', 'Start preparing'],
        Preparing: ['Ready', 'Mark ready'],
        Ready: ['Completed', 'Complete']
    };

    function notify(message, error = false) {
        const node = document.getElementById('managementMessage');
        if (!node) return;
        node.textContent = message;
        node.hidden = false;
        node.classList.toggle('is-error', error);
    }

    function dateText(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    }

    async function run(action) {
        try {
            await action();
        } catch (error) {
            notify(error.message, true);
        }
    }

    async function loadOrders() {
        const result = await api.request('/api/orders');
        state.orders = result.orders;
        renderOrders();
    }

    function renderOrders() {
        const filter = document.querySelector('[data-order-filter].active')?.dataset.orderFilter || 'All';
        const query = document.getElementById('orderSearch').value.trim().toLowerCase();
        const orders = state.orders.filter((order) =>
            (filter === 'All' || order.status === filter) &&
            `${order.order_number} ${order.customer_name || ''}`.toLowerCase().includes(query)
        );
        const body = document.getElementById('orderRows');
        if (!orders.length) {
            body.innerHTML = '<tr><td class="management-empty" colspan="7">No orders match this filter.</td></tr>';
            return;
        }
        body.innerHTML = orders.map((order) => {
            const next = transitions[order.status];
            const itemCount = (order.items || []).reduce((sum, item) => sum + Number(item.qty || 0), 0);
            return `<tr>
                <td><button class="management-link" type="button" data-order-detail="${Number(order.id)}">${safe(order.order_number)}</button><small class="management-subline">${safe(dateText(order.created_at))}</small></td>
                <td>${safe(order.customer_name || 'Guest customer')}</td><td>${itemCount} item(s)</td>
                <td>${safe(order.order_type)}</td><td><strong>${money(order.total)}</strong></td>
                <td><span class="management-status">${safe(order.status)}</span></td>
                <td><span class="management-actions">${next ? `<button class="btn btn-primary" type="button" data-order-update="${Number(order.id)}" data-next-status="${safe(next[0])}">${safe(next[1])}</button>` : ''}${order.status === 'New' ? `<button class="btn management-secondary" type="button" data-order-update="${Number(order.id)}" data-next-status="Cancelled">Cancel</button>` : ''}</span></td>
            </tr>`;
        }).join('');
    }

    async function setupOrders() {
        document.querySelectorAll('[data-order-filter]').forEach((button) => {
            button.addEventListener('click', () => {
                document.querySelectorAll('[data-order-filter]').forEach((item) => item.classList.toggle('active', item === button));
                renderOrders();
            });
        });
        document.getElementById('orderSearch').addEventListener('input', renderOrders);
        document.getElementById('orderRows').addEventListener('click', (event) => {
            const update = event.target.closest('[data-order-update]');
            const detail = event.target.closest('[data-order-detail]');
            if (update) {
                void run(async () => {
                    await api.request(`/api/orders/${update.dataset.orderUpdate}`, {
                        method: 'PATCH', body: { status: update.dataset.nextStatus }
                    });
                    notify(`Order updated to ${update.dataset.nextStatus}.`);
                    await loadOrders();
                });
            }
            if (detail) {
                void run(async () => {
                    const result = await api.request(`/api/orders/${detail.dataset.orderDetail}`);
                    const order = result.order;
                    document.getElementById('orderDetails').innerHTML = `
                        <span class="eyebrow">ORDER DETAILS</span><h2>${safe(order.order_number)}</h2>
                        <p><strong>${safe(order.customer_name)}</strong><br>${safe(order.customer_email || '')} ${safe(order.customer_phone || '')}</p>
                        <p>${safe(order.order_type)} · ${safe(order.payment_method)} · ${safe(dateText(order.created_at))}</p>
                        <p>Status: <strong>${safe(order.status)}</strong></p>
                        <div class="management-table-wrap"><table class="management-table"><thead><tr><th>Item</th><th>Quantity</th><th>Unit price</th><th>Line total</th></tr></thead><tbody>${(order.items || []).map((item) => `<tr><td>${safe(item.name)}</td><td>${Number(item.qty)}</td><td>${money(item.price)}</td><td>${money(item.line_total)}</td></tr>`).join('')}</tbody></table></div>
                        <p>Subtotal ${money(order.subtotal)} · GST ${money(Number(order.cgst) + Number(order.sgst))} · Total <strong>${money(order.total)}</strong></p>
                        ${order.notes ? `<p>Notes: ${safe(order.notes)}</p>` : ''}`;
                    document.getElementById('orderDialog').showModal();
                });
            }
        });
        document.querySelector('#orderDialog .dialog-close').addEventListener('click', () => document.getElementById('orderDialog').close());
        await loadOrders();
    }

    async function loadFoodData() {
        const [foodResult, categoryResult] = await Promise.all([
            api.request('/api/foods?includeUnavailable=1'),
            api.request('/api/categories')
        ]);
        state.foods = foodResult.items;
        state.categories = categoryResult.categories;
        renderCategories();
        renderFoods();
    }

    function renderCategories() {
        const select = document.getElementById('foodCategory');
        select.innerHTML = state.categories.map((category) => `<option value="${Number(category.id)}">${safe(category.name)}</option>`).join('');
        document.getElementById('categoryList').innerHTML = state.categories.map((category) => `
            <div class="category-row"><span>${safe(category.name)}</span><span class="management-actions">
                <button class="btn management-secondary" type="button" data-category-edit="${Number(category.id)}">Rename</button>
                <button class="btn management-secondary" type="button" data-category-delete="${Number(category.id)}" aria-label="Delete ${safe(category.name)}">Delete</button>
            </span></div>`).join('');
    }

    function renderFoods() {
        const query = document.getElementById('foodSearch').value.trim().toLowerCase();
        const items = state.foods.filter((food) =>
            `${food.name} ${food.category}`.toLowerCase().includes(query)
        );
        document.getElementById('foodRows').innerHTML = items.length ? items.map((food) => `
            <tr><td><strong>${safe(food.name)}</strong></td><td>${safe(food.category)}</td><td>${money(food.price)}</td>
            <td><span class="management-status ${food.is_available ? '' : 'is-muted'}">${food.is_available ? 'Available' : 'Unavailable'}</span></td>
            <td><span class="management-actions"><button class="btn management-secondary" type="button" data-food-edit="${Number(food.id)}">Edit</button><button class="btn management-secondary" type="button" data-food-delete="${Number(food.id)}">Delete</button></span></td></tr>`).join('')
            : '<tr><td class="management-empty" colspan="5">No menu items match this search.</td></tr>';
    }

    function resetFoodForm() {
        const form = document.getElementById('foodForm');
        form.reset();
        form.elements.id.value = '';
        document.getElementById('foodAvailable').checked = true;
        document.getElementById('foodFormTitle').textContent = 'New food item';
        document.getElementById('foodFormEyebrow').textContent = 'ADD TO THE MENU';
        document.getElementById('saveFoodButton').textContent = 'Add food item';
        document.getElementById('cancelFoodEdit').hidden = true;
    }

    async function imageData(file) {
        if (!file) return undefined;
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, or WebP image.');
        if (file.size > 2 * 1024 * 1024) throw new Error('Food image must be 2 MB or smaller.');
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Could not read the selected image.'));
            reader.readAsDataURL(file);
        });
    }

    async function setupFoods() {
        const form = document.getElementById('foodForm');
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            if (!form.reportValidity()) return;
            void run(async () => {
                const button = document.getElementById('saveFoodButton');
                button.disabled = true;
                try {
                    const file = form.elements.image.files[0];
                    const image = await imageData(file);
                    const payload = {
                        name: form.elements.name.value.trim(),
                        category_id: Number(form.elements.category_id.value),
                        price: Number(form.elements.price.value),
                        description: form.elements.description.value.trim(),
                        is_available: form.elements.is_available.checked
                    };
                    if (image) payload.image = image;
                    const id = form.elements.id.value;
                    await api.request(id ? `/api/foods/${id}` : '/api/foods', {
                        method: id ? 'PUT' : 'POST',
                        body: payload
                    });
                    notify(id ? 'Menu item updated.' : 'Menu item added.');
                    resetFoodForm();
                    await loadFoodData();
                } finally {
                    button.disabled = false;
                }
            });
        });
        document.getElementById('cancelFoodEdit').addEventListener('click', resetFoodForm);
        document.getElementById('foodSearch').addEventListener('input', renderFoods);
        document.getElementById('foodRows').addEventListener('click', (event) => {
            const edit = event.target.closest('[data-food-edit]');
            const remove = event.target.closest('[data-food-delete]');
            if (edit) {
                const food = state.foods.find((item) => Number(item.id) === Number(edit.dataset.foodEdit));
                if (!food) return;
                form.elements.id.value = food.id;
                form.elements.name.value = food.name;
                form.elements.category_id.value = food.category_id;
                form.elements.price.value = Number(food.price).toFixed(2);
                form.elements.description.value = food.description || '';
                form.elements.is_available.checked = Boolean(food.is_available);
                form.elements.image.value = '';
                document.getElementById('foodFormTitle').textContent = `Edit ${food.name}`;
                document.getElementById('foodFormEyebrow').textContent = 'UPDATE MENU ITEM';
                document.getElementById('saveFoodButton').textContent = 'Save changes';
                document.getElementById('cancelFoodEdit').hidden = false;
                form.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            if (remove) {
                const food = state.foods.find((item) => Number(item.id) === Number(remove.dataset.foodDelete));
                if (!food || !window.confirm(`Permanently remove "${food.name}" from the menu? Existing order history will be retained.`)) return;
                void run(async () => {
                    await api.request(`/api/foods/${food.id}`, { method: 'DELETE' });
                    notify(`${food.name} removed from the menu.`);
                    await loadFoodData();
                });
            }
        });
        document.getElementById('categoryForm').addEventListener('submit', (event) => {
            event.preventDefault();
            const categoryForm = event.currentTarget;
            if (!categoryForm.reportValidity()) return;
            void run(async () => {
                await api.request('/api/categories', { method: 'POST', body: { name: categoryForm.elements.name.value.trim() } });
                categoryForm.reset();
                notify('Food category added.');
                await loadFoodData();
            });
        });
        document.getElementById('categoryList').addEventListener('click', (event) => {
            const edit = event.target.closest('[data-category-edit]');
            const remove = event.target.closest('[data-category-delete]');
            if (edit) {
                const category = state.categories.find((item) => Number(item.id) === Number(edit.dataset.categoryEdit));
                const name = window.prompt('New category name:', category && category.name);
                if (name == null || !name.trim()) return;
                void run(async () => {
                    await api.request(`/api/categories/${category.id}`, { method: 'PUT', body: { name: name.trim() } });
                    notify('Category renamed.');
                    await loadFoodData();
                });
            }
            if (remove) {
                const category = state.categories.find((item) => Number(item.id) === Number(remove.dataset.categoryDelete));
                if (!category || !window.confirm(`Delete category "${category.name}"? It must not contain any food items.`)) return;
                void run(async () => {
                    await api.request(`/api/categories/${category.id}`, { method: 'DELETE' });
                    notify('Category deleted.');
                    await loadFoodData();
                });
            }
        });
        await loadFoodData();
    }

    async function loadPayments() {
        const result = await api.request('/api/payments');
        state.payments = result.payments;
        renderPayments();
    }

    function renderPayments() {
        const filter = document.querySelector('[data-payment-filter].active')?.dataset.paymentFilter || 'All';
        const query = document.getElementById('paymentSearch').value.trim().toLowerCase();
        const completed = state.payments.filter((item) => item.status === 'completed');
        const pending = state.payments.filter((item) => item.status === 'pending');
        document.getElementById('paymentCompleted').textContent = money(completed.reduce((sum, item) => sum + Number(item.amount), 0));
        document.getElementById('paymentPending').textContent = money(pending.reduce((sum, item) => sum + Number(item.amount), 0));
        document.getElementById('paymentCount').textContent = String(state.payments.length);
        const rows = state.payments.filter((item) =>
            (filter === 'All' || item.status === filter) &&
            `${item.invoice_number} ${item.order_number} ${item.customer_name} ${item.method}`.toLowerCase().includes(query)
        );
        document.getElementById('paymentRows').innerHTML = rows.length ? rows.map((item) => `
            <tr><td>${safe(dateText(item.created_at))}</td><td><strong>${safe(item.invoice_number)}</strong><small class="management-subline">${safe(item.order_number)}</small></td>
            <td>${safe(item.customer_name)}</td><td>${safe(item.method)}</td><td><strong>${money(item.amount)}</strong></td>
            <td><span class="management-status ${item.status === 'completed' ? 'is-paid' : item.status === 'pending' ? 'is-pending' : 'is-muted'}">${safe(item.status)}</span></td>
            <td>${item.status === 'pending' ? `<span class="management-actions"><button class="btn btn-primary" type="button" data-payment-update="${Number(item.id)}" data-payment-status="completed">Confirm received</button><button class="btn management-secondary" type="button" data-payment-update="${Number(item.id)}" data-payment-status="failed">Mark failed</button></span>` : '—'}</td></tr>`).join('')
            : '<tr><td class="management-empty" colspan="7">No payments match this filter.</td></tr>';
    }

    function setupPayments() {
        document.getElementById('paymentSearch').addEventListener('input', renderPayments);
        document.querySelectorAll('[data-payment-filter]').forEach((button) => {
            button.addEventListener('click', () => {
                document.querySelectorAll('[data-payment-filter]').forEach((item) => item.classList.toggle('active', item === button));
                renderPayments();
            });
        });
        document.getElementById('paymentRows').addEventListener('click', (event) => {
            const button = event.target.closest('[data-payment-update]');
            if (!button) return;
            const action = button.dataset.paymentStatus === 'completed' ? 'confirm receipt of this payment' : 'mark this payment failed';
            if (!window.confirm(`Are you sure you want to ${action}?`)) return;
            void run(async () => {
                await api.request(`/api/payments/${button.dataset.paymentUpdate}`, {
                    method: 'PATCH', body: { status: button.dataset.paymentStatus }
                });
                notify(`Payment marked ${button.dataset.paymentStatus}.`);
                await loadPayments();
            });
        });
        return loadPayments();
    }

    async function loadReport() {
        const period = document.getElementById('reportPeriod').value;
        state.report = await api.request(`/api/reports?period=${encodeURIComponent(period)}`);
        const { summary } = state.report;
        document.getElementById('reportRevenue').textContent = money(summary.gross_revenue);
        document.getElementById('reportOrders').textContent = String(summary.order_count);
        document.getElementById('reportPending').textContent = String(summary.pending_orders);
        document.getElementById('reportCancelled').textContent = money(summary.cancelled_value);
        const maxRevenue = Math.max(1, ...state.report.sales_by_day.map((item) => Number(item.revenue)));
        document.getElementById('reportChart').innerHTML = state.report.sales_by_day.length
            ? state.report.sales_by_day.map((item) => {
                const height = Math.max(4, Math.round(Number(item.revenue) / maxRevenue * 140));
                return `<div class="report-bar" title="${safe(dateText(item.day))}: ${money(item.revenue)}"><span style="height:${height}px"></span><strong>${money(item.revenue)}</strong><small>${safe(new Date(item.day).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }))}</small></div>`;
            }).join('')
            : '<p class="management-empty">No sales recorded in this period.</p>';
        document.getElementById('reportBestSellers').innerHTML = state.report.best_sellers.length
            ? state.report.best_sellers.map((item, index) => `<div class="report-rank-row"><span>${index + 1}</span><strong>${safe(item.name)}</strong><span>${Number(item.quantity)} sold<br>${money(item.revenue)}</span></div>`).join('')
            : '<p class="management-empty">No item sales recorded yet.</p>';
        document.getElementById('reportPayments').innerHTML = state.report.recent_payments.length
            ? state.report.recent_payments.map((item) => `<tr><td>${safe(dateText(item.created_at))}</td><td>${safe(item.invoice_number)}</td><td>${safe(item.order_number)}</td><td>${safe(item.method)}</td><td>${money(item.amount)}</td><td>${safe(item.status)}</td></tr>`).join('')
            : '<tr><td class="management-empty" colspan="6">No payment transactions in this period.</td></tr>';
    }

    function csvCell(value) {
        return `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
    }

    function downloadReport() {
        if (!state.report) return notify('Load a report before downloading it.', true);
        const lines = [
            ['Date', 'Orders', 'Revenue'],
            ...state.report.sales_by_day.map((item) => [item.day, item.order_count, item.revenue]),
            [],
            ['Best-selling item', 'Quantity', 'Revenue'],
            ...state.report.best_sellers.map((item) => [item.name, item.quantity, item.revenue])
        ];
        const blob = new Blob([lines.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `spicevilla-${state.report.period}-report.csv`;
        link.click();
        URL.revokeObjectURL(url);
    }

    function setupReports() {
        document.getElementById('reportPeriod').addEventListener('change', () => void run(loadReport));
        document.getElementById('downloadReport').addEventListener('click', downloadReport);
        return loadReport();
    }

    async function loadCustomers() {
        const result = await api.request('/api/customers');
        state.customers = result.customers;
        renderCustomers();
    }

    function renderCustomers() {
        const query = document.getElementById('customerSearch').value.trim().toLowerCase();
        const customers = state.customers.filter((customer) =>
            `${customer.name} ${customer.email} ${customer.phone || ''}`.toLowerCase().includes(query)
        );
        document.getElementById('customerCount').textContent = `${state.customers.length} registered customer(s)`;
        document.getElementById('customerRows').innerHTML = customers.length
            ? customers.map((customer) => `<tr><td><strong>${safe(customer.name)}</strong></td><td>${safe(customer.email)}<small class="management-subline">${safe(customer.phone || 'No phone provided')}</small></td><td>${Number(customer.order_count)}</td><td>${money(customer.lifetime_value)}</td><td>${safe(dateText(customer.created_at))}</td><td><button class="btn management-secondary" type="button" data-customer-detail="${Number(customer.id)}">View details</button></td></tr>`).join('')
            : '<tr><td class="management-empty" colspan="6">No registered customers match this search.</td></tr>';
    }

    function setupCustomers() {
        document.getElementById('customerSearch').addEventListener('input', renderCustomers);
        document.getElementById('customerRows').addEventListener('click', (event) => {
            const button = event.target.closest('[data-customer-detail]');
            if (!button) return;
            void run(async () => {
                const result = await api.request(`/api/customers/${button.dataset.customerDetail}`);
                const customer = result.customer;
                document.getElementById('customerDetails').innerHTML = `
                    <span class="eyebrow">CUSTOMER PROFILE</span><h2>${safe(customer.name)}</h2>
                    <p>${safe(customer.email)}<br>${safe(customer.phone || 'No phone provided')}<br>${safe(customer.address || 'No address saved')}</p>
                    <h3>Order history</h3>
                    <div class="management-table-wrap"><table class="management-table"><thead><tr><th>Order</th><th>Date</th><th>Type</th><th>Status</th><th>Total</th></tr></thead><tbody>${customer.orders.length ? customer.orders.map((order) => `<tr><td>${safe(order.order_number)}</td><td>${safe(dateText(order.created_at))}</td><td>${safe(order.order_type)}</td><td>${safe(order.status)}</td><td>${money(order.total)}</td></tr>`).join('') : '<tr><td colspan="5">No orders yet.</td></tr>'}</tbody></table></div>`;
                document.getElementById('customerDialog').showModal();
            });
        });
        document.querySelector('#customerDialog .dialog-close').addEventListener('click', () => document.getElementById('customerDialog').close());
        return loadCustomers();
    }

    const page = document.body.dataset.management;
    const initializers = {
        orders: setupOrders,
        foods: setupFoods,
        payments: setupPayments,
        reports: setupReports,
        customers: setupCustomers
    };
    if (initializers[page]) void run(initializers[page]);
})();
