(() => {
    const CART_KEY = 'spiceCart';
    const UNMATCHED_CART_KEY = 'spiceCartUnmatched';
    let foods = [];
    let foodsRequest;

    function safe(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[character]);
    }

    function imageSource(value) {
        const source = String(value || '');
        return source.startsWith('/uploads/') || /^https:\/\//i.test(source) ? source : '';
    }

    function readCart() {
        try {
            const value = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
            return Array.isArray(value) ? value.filter((item) => item && Number(item.id) > 0 && Number(item.qty) > 0) : [];
        } catch {
            return [];
        }
    }

    function migrateCart(catalog) {
        let saved;
        try {
            saved = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
        } catch {
            return [];
        }
        if (!Array.isArray(saved)) return [];
        const byName = new Map(catalog.map((food) => [food.name.trim().toLowerCase(), food]));
        const cart = [];
        const unmatched = [];
        for (const item of saved) {
            if (!item || typeof item !== 'object') continue;
            const existing = Number(item.id) > 0
                ? catalog.find((food) => food.id === Number(item.id))
                : null;
            const food = existing || byName.get(String(item.name || item.food_name || item.title || '').trim().toLowerCase());
            const quantity = Number(item.qty || item.quantity || 1);
            if (!food || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
                unmatched.push(item);
                continue;
            }
            const entry = cart.find((line) => line.id === food.id);
            if (entry) entry.qty = Math.min(99, entry.qty + quantity);
            else cart.push({ id: food.id, name: food.name, price: food.price, qty: quantity, image_url: food.img });
        }
        try {
            localStorage.setItem(CART_KEY, JSON.stringify(cart));
            if (unmatched.length) {
                const archived = JSON.parse(localStorage.getItem(UNMATCHED_CART_KEY) || '[]');
                const previous = Array.isArray(archived) ? archived : [];
                localStorage.setItem(UNMATCHED_CART_KEY, JSON.stringify([...previous, ...unmatched]));
            }
        } catch {
            return unmatched;
        }
        updateCartCount();
        return unmatched;
    }

    async function loadFoods(options = {}) {
        if (options.includeUnavailable) {
            const result = await window.SpiceVillaAPI.request('/api/foods?includeUnavailable=1');
            return result.items.map(mapFood);
        }
        if (!foodsRequest) {
            foodsRequest = window.SpiceVillaAPI.request('/api/foods')
                .then((result) => {
                    foods = result.items.map(mapFood);
                    migrateCart(foods);
                    return foods;
                })
                .catch((error) => {
                    foodsRequest = null;
                    throw error;
                });
        }
        return foodsRequest;
    }

    function mapFood(food) {
        return {
            ...food,
            id: Number(food.id),
            price: Number(food.price),
            cat: food.category,
            desc: food.description,
            img: imageSource(food.image_url)
        };
    }

    function foodCard(food) {
        const detailPage = window.location.pathname.includes('/pages/') ? 'food.html' : 'pages/food.html';
        return `<article class="food-card">
            <img src="${safe(food.img)}" alt="${safe(food.name)}" loading="lazy">
            <div class="food-body"><span class="veg" aria-label="Vegetarian"></span>
                <div class="food-title"><h3><a href="${detailPage}?id=${Number(food.id)}">${safe(food.name)}</a></h3><b class="price">₹${food.price.toLocaleString('en-IN')}</b></div>
                <p>${safe(food.desc)}</p>
                <button class="btn btn-primary" type="button" data-add-food="${food.id}">Add to Cart</button>
            </div>
        </article>`;
    }

    async function renderFeatured() {
        const target = document.getElementById('featured');
        if (!target) return;
        try {
            const catalog = await loadFoods();
            target.innerHTML = catalog.slice(0, 4).map(foodCard).join('');
        } catch (error) {
            target.innerHTML = `<p class="menu-empty">${safe(error.message)}</p>`;
        }
    }

    function addToCart(food) {
        const cart = readCart();
        const existing = cart.find((item) => Number(item.id) === Number(food.id));
        if (existing) existing.qty += 1;
        else cart.push({
            id: Number(food.id),
            name: food.name,
            price: Number(food.price),
            qty: 1,
            image_url: food.img
        });
        try {
            localStorage.setItem(CART_KEY, JSON.stringify(cart));
            updateCartCount();
            toast(`${food.name} added to cart`);
        } catch {
            toast('Could not save your cart in this browser.');
        }
    }

    function updateCartCount() {
        const count = readCart().reduce((sum, item) => sum + Number(item.qty || 0), 0);
        document.querySelectorAll('.cart-count').forEach((node) => { node.textContent = String(count); });
        document.querySelectorAll('.cart-fab').forEach((node) => {
            node.setAttribute('aria-label', `Go to cart, ${count} ${count === 1 ? 'item' : 'items'}`);
        });
    }

    function toast(message) {
        const node = document.createElement('div');
        node.className = 'app-toast';
        node.setAttribute('role', 'status');
        node.textContent = message;
        document.body.appendChild(node);
        window.setTimeout(() => node.remove(), 2200);
    }

    async function submitReservation(event) {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;
        const button = form.querySelector('button[type="submit"]');
        const status = document.getElementById('reservationStatus');
        button.disabled = true;
        status.hidden = true;
        const values = new FormData(form);
        try {
            const result = await window.SpiceVillaAPI.request('/api/reservations', {
                method: 'POST',
                body: {
                    name: values.get('name'),
                    phone: values.get('phone'),
                    date: values.get('date'),
                    time: values.get('time'),
                    guests: Number(values.get('guests')),
                    notes: values.get('notes')
                }
            });
            status.classList.remove('is-error');
            status.textContent = `Reservation request ${result.reservation.id} saved. The restaurant will confirm your booking.`;
            status.hidden = false;
            form.reset();
        } catch (error) {
            status.classList.add('is-error');
            status.textContent = error.message;
            status.hidden = false;
        } finally {
            button.disabled = false;
        }
    }

    document.addEventListener('click', (event) => {
        const button = event.target.closest('[data-add-food]');
        if (!button) return;
        const item = foods.find((food) => food.id === Number(button.dataset.addFood));
        if (item) addToCart(item);
    });

    document.addEventListener('DOMContentLoaded', () => {
        updateCartCount();
        const toggle = document.querySelector('.menu-toggle');
        const navigation = document.querySelector('.site-header nav');
        if (toggle && navigation) {
            toggle.addEventListener('click', () => {
                const expanded = toggle.getAttribute('aria-expanded') !== 'true';
                toggle.setAttribute('aria-expanded', String(expanded));
                navigation.classList.toggle('show', expanded);
            });
        }
        const lightbox = document.getElementById('galleryLightbox');
        if (lightbox) {
            const preview = lightbox.querySelector('img');
            lightbox.querySelector('.gallery-close')?.addEventListener('click', () => lightbox.close());
            document.querySelectorAll('.gallery-image img').forEach((image) => {
                image.closest('.gallery-image').addEventListener('click', () => {
                    preview.src = image.src;
                    preview.alt = image.alt;
                    lightbox.showModal();
                });
            });
            lightbox.addEventListener('click', (event) => {
                if (event.target === lightbox) lightbox.close();
            });
        }
        const reservationForm = document.getElementById('reservationForm');
        if (reservationForm) reservationForm.addEventListener('submit', submitReservation);
        window.addEventListener('storage', (event) => {
            if (!event.key || event.key === CART_KEY) updateCartCount();
        });
    });

    window.getFoods = () => foods;
    window.loadFoods = loadFoods;
    window.migrateCart = migrateCart;
    window.foodCard = foodCard;
    window.renderFeatured = renderFeatured;
    window.addToCart = addToCart;
    window.updateCartCount = updateCartCount;
    window.toast = toast;
})();
