(() => {
    const bill = new Map();
    let foods = [];
    let idempotencyKey = createRequestKey();
    let savedOrderId = null;
    const itemGrid = document.getElementById('posItems');
    const billItems = document.getElementById('posBillItems');
    const message = document.getElementById('posMessage');
    const money = (amount) => `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const safe = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);

    function createRequestKey() {
        return window.crypto && window.crypto.randomUUID
            ? window.crypto.randomUUID()
            : `pos-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    async function loadMenu() {
        try {
            const result = await window.SpiceVillaAPI.request('/api/foods');
            foods = result.items.map((item) => ({
                id: Number(item.id),
                name: item.name,
                description: item.description,
                category: item.category,
                price: Number(item.price),
                image: String(item.image_url || '').startsWith('/uploads/') || String(item.image_url || '').startsWith('https://')
                    ? item.image_url : ''
            }));
            renderMenu();
        } catch (error) {
            itemGrid.innerHTML = `<p class="pos-empty">${safe(error.message)}</p>`;
        }
    }

    function renderMenu() {
        const query = document.getElementById('posSearch').value.trim().toLowerCase();
        const category = document.getElementById('posCategory').value;
        const items = foods.filter((food) =>
            (category === 'All' || food.category === category) &&
            `${food.name} ${food.description} ${food.category}`.toLowerCase().includes(query)
        );
        document.getElementById('posResults').textContent = `${items.length} ${items.length === 1 ? 'dish' : 'dishes'} available`;
        itemGrid.innerHTML = items.length ? items.map((food) => `
            <button class="pos-item" type="button" data-pos-add="${food.id}" aria-label="Add ${safe(food.name)}, ${money(food.price)}">
                <img src="${safe(food.image)}" alt="" loading="lazy">
                <span>${safe(food.name)}<b>${money(food.price)}</b></span>
            </button>`).join('') : '<p class="pos-empty">No menu items match. Try another search.</p>';
    }

    function renderBill() {
        const items = Array.from(bill.values());
        billItems.innerHTML = items.length ? items.map((item) => `
            <div class="bill-item">
                <span>${safe(item.name)}<br><small>${money(item.price)} each</small></span>
                <span class="bill-item-controls">
                    <button type="button" data-qty-change="${item.id}" data-amount="-1" aria-label="Remove one ${safe(item.name)}">−</button>
                    <b>${item.qty}</b>
                    <button type="button" data-qty-change="${item.id}" data-amount="1" aria-label="Add one ${safe(item.name)}">+</button>
                </span>
                <strong>${money(item.price * item.qty)}</strong>
            </div>`).join('') : '<p class="pos-empty">Choose dishes to start this bill.</p>';
        const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
        const cgst = Math.round((subtotal * 0.025 + Number.EPSILON) * 100) / 100;
        const sgst = Math.round((subtotal * 0.025 + Number.EPSILON) * 100) / 100;
        document.getElementById('posSubtotal').textContent = money(subtotal);
        document.getElementById('posCgst').textContent = money(cgst);
        document.getElementById('posSgst').textContent = money(sgst);
        document.getElementById('posTotal').textContent = money(subtotal + cgst + sgst);
        document.getElementById('createPosOrder').disabled = items.length === 0;
        if (savedOrderId) document.getElementById('createPosOrder').textContent = 'Retry invoice';
    }

    itemGrid.addEventListener('click', (event) => {
        const button = event.target.closest('[data-pos-add]');
        if (!button) return;
        const food = foods.find((item) => item.id === Number(button.dataset.posAdd));
        if (!food) return;
        const current = bill.get(food.id);
        if (current) current.qty += 1;
        else bill.set(food.id, { ...food, qty: 1 });
        message.textContent = `${food.name} added to this bill.`;
        renderBill();
    });

    billItems.addEventListener('click', (event) => {
        const button = event.target.closest('[data-qty-change]');
        if (!button) return;
        const item = bill.get(Number(button.dataset.qtyChange));
        if (!item) return;
        item.qty += Number(button.dataset.amount);
        if (item.qty <= 0) bill.delete(item.id);
        renderBill();
    });

    document.getElementById('posSearch').addEventListener('input', renderMenu);
    document.getElementById('posCategory').addEventListener('change', renderMenu);
    document.getElementById('clearBillButton').addEventListener('click', () => {
        if (savedOrderId && !window.confirm('An order has already been saved. Clear this bill without issuing its invoice?')) return;
        bill.clear();
        savedOrderId = null;
        idempotencyKey = createRequestKey();
        document.getElementById('createPosOrder').textContent = 'Save order & invoice';
        message.textContent = 'Current bill cleared.';
        renderBill();
    });

    document.getElementById('createPosOrder').addEventListener('click', async () => {
        const items = Array.from(bill.values());
        if (!items.length) return;
        const button = document.getElementById('createPosOrder');
        button.disabled = true;
        message.textContent = savedOrderId ? 'Retrying invoice creation…' : 'Saving order…';
        try {
            if (!savedOrderId) {
                const orderResult = await window.SpiceVillaAPI.request('/api/orders', {
                    method: 'POST',
                    body: {
                        idempotency_key: idempotencyKey,
                        customer_name: document.getElementById('posCustomer').value.trim() || 'Walk-in Customer',
                        order_type: document.getElementById('posOrderType').value,
                        table_label: document.getElementById('posTable').value,
                        payment_method: document.getElementById('posPayment').value,
                        items: items.map((item) => ({ food_id: item.id, quantity: item.qty }))
                    }
                });
                savedOrderId = orderResult.order.id;
            }
            const billResult = await window.SpiceVillaAPI.request('/api/bills', {
                method: 'POST',
                body: { order_id: savedOrderId, discount_type: 'amount', discount: 0 }
            });
            message.textContent = `Order ${billResult.bill.order_id} and invoice ${billResult.bill.invoice_number} saved.`;
            bill.clear();
            savedOrderId = null;
            idempotencyKey = createRequestKey();
            button.textContent = 'Save order & invoice';
            renderBill();
        } catch (error) {
            message.textContent = savedOrderId
                ? `Order is saved, but invoice creation failed: ${error.message}`
                : error.message;
        } finally {
            button.disabled = bill.size === 0;
        }
    });

    renderBill();
    void loadMenu();
})();
